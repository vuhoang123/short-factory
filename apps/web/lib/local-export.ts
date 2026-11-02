import { z } from 'zod';

const referenceUrl = z.string().trim().url().max(2048).refine((value) => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password &&
    ['facebook.com', 'threads.com', 'threads.net'].some((domain) => host === domain || host.endsWith(`.${domain}`));
}, 'Dùng link HTTPS của Facebook hoặc Threads, không chứa thông tin đăng nhập.').transform((value, context) => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
    if (['/permalink.php', '/story.php'].includes(path)) {
      const owner = url.searchParams.get('id') ?? '';
      const story = url.searchParams.get('story_fbid') ?? '';
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(owner) || !/^[A-Za-z0-9_-]{1,200}$/.test(story) || url.searchParams.getAll('id').length !== 1 || url.searchParams.getAll('story_fbid').length !== 1) {
        context.addIssue({ code: 'custom', message: 'Link Facebook thiếu mã bài hoặc chủ bài hợp lệ. Hãy mở bài và sao chép link trực tiếp.' });
        return z.NEVER;
      }
      url.hostname = 'www.facebook.com';
      url.pathname = `/${owner}/posts/${story}`;
    } else if (path === '/' || ['/photo.php', '/photo', '/watch'].includes(path)) {
      context.addIssue({ code: 'custom', message: 'Link này chưa xác định được bài nguồn. Hãy mở bài và sao chép link dạng /posts/ hoặc /permalink/ có mã bài.' });
      return z.NEVER;
    }
  } else if (path === '/') {
    context.addIssue({ code: 'custom', message: 'Cần link tới bài Threads cụ thể, không dùng link trang chủ.' });
    return z.NEVER;
  }
  url.search = ''; url.hash = '';
  return url.toString();
});

const draftSchema = z.object({
  canonicalUrl: referenceUrl, title: z.string().trim().max(300), body: z.string().trim().min(1).max(50_000),
  comments: z.string().max(80_008), channelId: z.string().uuid(),
  basis: z.enum(['OWNED', 'LICENSED', 'CONSENTED']), evidence: z.string().trim().max(4000),
  territory: z.string().trim().min(1).max(100).refine((value) => value !== 'UNSPECIFIED', 'Cần phạm vi lãnh thổ.'),
  allowedPlatforms: z.array(z.enum(['YOUTUBE', 'FACEBOOK', 'TIKTOK'])).min(1).max(3),
  commercialAllowed: z.literal(true), attributionRequired: z.boolean(), attributionText: z.string().trim().max(2000), attested: z.literal(true),
}).strict().superRefine((input, context) => {
  if (input.basis !== 'OWNED' && !input.evidence) context.addIssue({ code: 'custom', path: ['evidence'], message: 'Cần bằng chứng giấy phép hoặc đồng ý của chủ nội dung.' });
  if (input.attributionRequired && !input.attributionText) context.addIssue({ code: 'custom', path: ['attributionText'], message: 'Cần nội dung ghi công.' });
});

export function createLocalImport(raw: unknown) {
  const input = draftSchema.parse(raw);
  const comments = z.array(z.string().trim().min(1).max(10_000)).max(8, 'Tối đa 8 bình luận trong một video.').parse(input.comments.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return {
    platform: 'MANUAL' as const, canonicalUrl: input.canonicalUrl, title: input.title || undefined, body: input.body, channelId: input.channelId,
    comments: comments.map((body, index) => ({ externalId: `c${index + 1}`, body })),
    rights: { basis: input.basis, attested: input.attested, commercialAllowed: input.commercialAllowed,
      allowedPlatforms: [...new Set(input.allowedPlatforms)], territory: input.territory,
      ...(input.evidence ? { evidence: input.evidence } : {}), attributionRequired: input.attributionRequired,
      ...(input.attributionText ? { attributionText: input.attributionText } : {}),
    },
  };
}

export type OperationKeys = Record<string, { fingerprint: string; key: string }>;
export async function getOperationKey(keys: OperationKeys, operation: string, payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (keys[operation]?.fingerprint !== fingerprint) keys[operation] = { fingerprint, key: crypto.randomUUID() };
  return keys[operation]!.key;
}

const id = z.string().uuid();
export const exportProgressSchema = z.object({
  postId: id.optional(), runId: id.optional(), videoId: id.optional(), channelId: id.optional(), voiceProfileId: z.string().max(100).optional(),
  duration: z.number().int().min(10).max(120).optional(), commentIds: z.array(id).max(8).optional(),
  keys: z.record(z.string(), z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), key: id }).strict()).default({}),
}).strict();
export type ExportProgress = z.infer<typeof exportProgressSchema>;

export function localExportBlockers(input: {
  canEdit: boolean; reviewedSource: boolean; hasVoice: boolean; hasChannel: boolean; sourceUnsafe: boolean;
  rightsStatus: string | undefined; candidate: { status: string; score: number | null; minimumScore: number } | null;
}) {
  const reasons: string[] = [];
  if (!input.canEdit) reasons.push('Cần vai trò OWNER, ADMIN hoặc EDITOR để tạo video.');
  if (!input.reviewedSource) reasons.push('Tích xác nhận “Tôi đã đọc bản lưu” ở bước 2.');
  if (input.rightsStatus !== 'APPROVED') reasons.push('Quyền sử dụng bản lưu chưa được duyệt. Hoàn tất bước “Duyệt quyền bản lưu”.');
  if (!input.candidate) reasons.push('Đang chờ chấm điểm bài. Nếu chờ lâu, kiểm tra discovery worker rồi tải lại trạng thái bài.');
  else if (input.candidate.score === null) reasons.push('Bài chưa có điểm hợp lệ. Kiểm tra kết quả chấm điểm tại thư viện bài.');
  else if (input.candidate.score < input.candidate.minimumScore) {
    reasons.push(`Bài đạt ${input.candidate.score} điểm, thấp hơn ngưỡng ${input.candidate.minimumScore} của kênh. Bài chưa đủ điều kiện để chọn và tạo video.`);
  } else if (['REJECTED', 'BLOCKED_RIGHTS', 'BLOCKED_SAFETY', 'DUPLICATE', 'BELOW_THRESHOLD'].includes(input.candidate.status)) reasons.push(`Bài đang bị chặn (${input.candidate.status}). Kiểm tra trạng thái tại thư viện bài trước khi tạo video.`);
  else if (input.candidate.status !== 'APPROVED') reasons.push('Bài chưa được chọn. Hoàn tất “Xác nhận chọn bài” ở bước 2 sau khi duyệt quyền và nội dung.');
  if (input.sourceUnsafe) reasons.push('Bài hoặc bình luận có cờ dữ liệu nhạy cảm; cần xử lý tại thư viện bài.');
  if (!input.hasChannel) reasons.push('Chưa có kênh nội dung khả dụng. Kiểm tra kênh trong Channels.');
  if (!input.hasVoice) reasons.push('Chưa có giọng đọc local phù hợp ngôn ngữ của kênh.');
  return reasons;
}
