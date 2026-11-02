export type ContentLifecycle = 'DISCOVERED' | 'SELECTED' | 'SCRIPTING' | 'RENDERING' | 'REVIEW' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';

export function contentLifecycle(input: {
  candidateStatus?: string; score?: number | null; minimumScore?: number; rightsStatus?: string; unsafe?: boolean;
  run?: { status: string; currentStage: string | null; errorCode: string | null } | null;
  video?: { reviewStatus: string; publication?: { status: string; remotePostId: string | null } | null } | null;
}): { state: ContentLifecycle; blockedReason: string | null; nextAction: string; simulated: boolean } {
  const result = (state: ContentLifecycle, nextAction: string, blockedReason: string | null = null, simulated = false) => ({ state, nextAction, blockedReason, simulated });
  if (input.unsafe) return result('DISCOVERED', 'Kiểm tra nội dung nhạy cảm', 'Nội dung cần xử lý cờ an toàn trước khi sử dụng.');
  if (input.rightsStatus !== 'APPROVED') return result('DISCOVERED', 'Duyệt quyền sử dụng', 'Chưa có quyền sử dụng được duyệt hiện hành.');
  const run = input.run;
  if (run?.status.startsWith('FAILED') || run?.status.startsWith('BLOCKED')) return result('FAILED', 'Kiểm tra lỗi và thử lại', run.errorCode ?? 'Lượt xử lý chưa hoàn tất.');
  if (run?.status === 'CANCELLED') return result('CANCELLED', 'Tạo một lượt mới');
  if (run && ['QUEUED', 'RUNNING'].includes(run.status)) return result(['VIDEO_RENDER', 'MEDIA_VALIDATION', 'STORAGE_UPLOAD', 'READY_FOR_REVIEW'].includes(run.currentStage ?? '') ? 'RENDERING' : 'SCRIPTING', 'Theo dõi tiến độ trong Studio');
  if (input.video && ['REJECTED', 'BLOCKED'].includes(input.video.reviewStatus)) return result('FAILED', 'Chỉnh sửa và render lại', 'Video chưa được người duyệt chấp thuận.');
  if (input.video?.reviewStatus === 'APPROVED') {
    const publication = input.video.publication;
    if (publication?.status === 'PUBLISHED') return publication.remotePostId ? result('PUBLISHED', 'Xem hiệu quả', null, publication.remotePostId.startsWith('mock:')) : result('FAILED', 'Kiểm tra lần đăng', 'Chưa có mã bài đăng để xác minh kết quả.');
    if (publication && ['SCHEDULED', 'QUEUED', 'UPLOADING', 'PROCESSING'].includes(publication.status)) return result('SCHEDULED', 'Xem trạng thái đăng');
    if (publication?.status.startsWith('FAILED') || publication?.status.startsWith('BLOCKED') || publication?.status === 'NEEDS_ACTION') return result('FAILED', 'Kiểm tra lần đăng', 'Lần đăng cần được xử lý trước khi thử lại.');
    return result('APPROVED', 'Tải video hoặc mở Publish');
  }
  if (input.video) return result('REVIEW', 'Xem và duyệt video');
  if (run?.status === 'SUCCEEDED') return result('SCRIPTING', 'Chỉnh kịch bản rồi render video');
  if (input.score !== null && input.score !== undefined && input.score < (input.minimumScore ?? 0)) return result('DISCOVERED', 'Kiểm tra điểm và chính sách kênh', `Điểm ${input.score} thấp hơn ngưỡng ${input.minimumScore}.`);
  if (input.candidateStatus === 'APPROVED') return result('SELECTED', 'Mở Studio để tạo kịch bản');
  if (['REJECTED', 'BLOCKED_SAFETY', 'BLOCKED_RIGHTS', 'DUPLICATE', 'BELOW_THRESHOLD'].includes(input.candidateStatus ?? '')) return result('DISCOVERED', 'Kiểm tra trạng thái bài', `Bài đang bị chặn: ${input.candidateStatus}.`);
  return result('DISCOVERED', input.candidateStatus ? 'Xác nhận chọn bài' : 'Chờ chấm điểm');
}
