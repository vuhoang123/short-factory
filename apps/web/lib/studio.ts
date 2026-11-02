import { z } from 'zod';
import { postSchema } from './contracts';

export const lifecycleStates = ['DISCOVERED', 'SELECTED', 'SCRIPTING', 'RENDERING', 'REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'CANCELLED'] as const;
export const lifecycleLabels: Record<typeof lifecycleStates[number], string> = {
  DISCOVERED: 'Mới khám phá', SELECTED: 'Đã chọn', SCRIPTING: 'Kịch bản', RENDERING: 'Đang dựng video', REVIEW: 'Cần duyệt', APPROVED: 'Đã duyệt', SCHEDULED: 'Đang chờ đăng', PUBLISHED: 'Đã đăng', FAILED: 'Cần xử lý lỗi', CANCELLED: 'Đã hủy',
};
export const studioItemSchema = z.object({
  id: z.string().uuid(),
  post: postSchema.extend({ channel: z.object({ id: z.string(), name: z.string(), language: z.string(), minimumCandidateScore: z.number() }).nullable() }),
  candidate: z.object({ id: z.string().uuid(), status: z.string(), score: z.number().nullable(), minimumScore: z.number(), reasoning: z.string().nullable() }).nullable(),
  run: z.object({ id: z.string().uuid(), storyProjectId: z.string().uuid(), status: z.string(), currentStage: z.string().nullable(), errorCode: z.string().nullable(), progress: z.number() }).nullable(),
  video: z.object({ id: z.string().uuid(), title: z.string(), reviewStatus: z.string(), assetId: z.string().uuid().nullable() }).nullable(),
  lifecycle: z.object({ state: z.enum(lifecycleStates), blockedReason: z.string().nullable(), nextAction: z.string(), simulated: z.boolean() }),
});
export const studioItemsSchema = z.object({ items: z.array(studioItemSchema), nextCursor: z.string().uuid().nullable() });
export type StudioItem = z.infer<typeof studioItemSchema>;
export const studioOverviewSchema = z.object({
  counts: z.object({ discovered: z.number(), selected: z.number(), scripting: z.number(), rendering: z.number(), review: z.number(), approved: z.number(), failed: z.number(), scheduled: z.number(), published: z.number() }),
  recent: z.array(z.object({ id: z.string().uuid(), status: z.string(), currentStage: z.string().nullable(), errorCode: z.string().nullable(), createdAt: z.string(), story: z.object({ sourcePostId: z.string().uuid(), post: z.object({ title: z.string().nullable() }) }), videos: z.array(z.object({ id: z.string().uuid(), reviewStatus: z.string(), mediaAsset: z.object({ id: z.string().uuid() }).nullable() })) })),
  publishing: z.string(),
});
export function studioLink(input: { postIds?: string[]; runId?: string; videoId?: string }) {
  const params = new URLSearchParams();
  if (input.postIds?.length) params.set('posts', input.postIds.join(','));
  if (input.runId) params.set('run', input.runId);
  if (input.videoId) params.set('video', input.videoId);
  return `/studio${params.size ? `?${params}` : ''}`;
}
export function studioSelection(params: Record<string, string | string[] | undefined>) {
  const single = (key: string) => typeof params[key] === 'string' ? params[key] : undefined;
  return z.object({ postIds: z.array(z.string().uuid()).max(12), runId: z.string().uuid().optional(), videoId: z.string().uuid().optional() }).parse({
    postIds: [...new Set(single('posts')?.split(',').filter(Boolean) ?? [])], runId: single('run'), videoId: single('video'),
  });
}
export function humanStage(stage: string | null) {
  if (stage === 'SPEECH_CALIBRATION') return 'Đo tốc độ giọng đọc';
  if (stage === 'DURATION_FIT') return 'Cân thời lượng lời đọc';
  const labels: Record<string, string> = { SCRIPT_GENERATION: 'Soạn kịch bản', SCRIPT_VALIDATION: 'Kiểm tra nội dung', SCRIPT_READY: 'Kịch bản sẵn sàng', TTS_GENERATION: 'Tạo lời đọc', AUDIO_ALIGNMENT: 'Căn lời đọc', AUDIO_READY: 'Lời đọc sẵn sàng', ASSET_PREPARATION: 'Chuẩn bị hình ảnh', SUBTITLE_GENERATION: 'Tạo phụ đề', MANIFEST_CREATION: 'Chuẩn bị bố cục', VIDEO_RENDER: 'Dựng video', MEDIA_VALIDATION: 'Kiểm tra video', STORAGE_UPLOAD: 'Lưu kết quả', READY_FOR_REVIEW: 'Sẵn sàng để duyệt' };
  return stage ? labels[stage] ?? 'Đang xử lý' : 'Đang chờ đến lượt';
}

export function mediaFailureMessage(code: string) {
  if (code === 'DURATION_TARGET_UNREACHABLE') return 'Lời đọc chưa vừa thời lượng đã chọn. Mở kịch bản để rút gọn hoặc thêm câu đầy đủ, rồi dựng lại; hệ thống không cắt câu hay kéo giọng quá mức.';
  if (code === 'SCRIPT_SENTENCE_TOO_LONG') return 'Một câu quá dài để xử lý an toàn. Chia thành các câu ngắn hơn trong nội dung nhập hoặc kịch bản.';
  if (code === 'AUDIO_ALIGNMENT_FAILED' || code === 'AUDIO_ALIGNMENT_INVALID') return 'Chưa căn được lời đọc với phụ đề. Kiểm tra dịch vụ local và chia đoạn dài thành các câu dưới 30 giây trước khi thử lại.';
  return code.replaceAll('_', ' ');
}
