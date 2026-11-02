'use client';

import { z } from 'zod';
import { commentPlanSchema, type CommentMode } from '../lib/comment-selection';
import { useResource } from '../lib/use-resource';
import { ErrorNotice } from './feedback';

const commentsSchema = z.object({ items: z.array(z.object({ id: z.string(), body: z.string(), likes: z.number().nullable().optional(), sensitiveFlags: z.array(z.string()).optional() })) });
export function CommentPicker({ postId, duration, mode, selectedIds, onMode, onSelection, locked = false }: {
  postId: string; duration: number; mode: CommentMode; selectedIds: string[]; onMode: (mode: CommentMode) => void; onSelection: (ids: string[]) => void; locked?: boolean;
}) {
  const plan = useResource(`/posts/${postId}/comment-selection?duration=${duration}`, commentPlanSchema);
  const saved = useResource(`/posts/${postId}/comments?limit=100`, commentsSchema);
  const automatic = mode === 'TOP_REACTIONS';
  const ids = automatic ? plan.data?.items.map((comment) => comment.id) ?? [] : selectedIds;
  const comments = automatic ? plan.data?.items ?? [] : saved.data?.items ?? [];
  return <section className="comment-picker"><label>Chọn bình luận<select value={mode} disabled={locked} onChange={(event) => { const next = event.target.value as CommentMode; if (next === 'MANUAL') onSelection(plan.data?.items.map((comment) => comment.id) ?? []); onMode(next); }}><option value="TOP_REACTIONS">Tự chọn theo react và thời lượng</option><option value="MANUAL">Tôi chọn thủ công</option></select></label>
    {plan.error && <ErrorNotice message={plan.error} retry={plan.reload} />}{saved.error && !automatic && <ErrorNotice message={saved.error} retry={saved.reload} />}
    {plan.data && <p className="field-help">Mục tiêu {duration}s: ưu tiên {plan.data.targetCount} bình luận; có {plan.data.availableCount} bình luận đủ điều kiện đã lưu. Bình luận dài được trích đoạn khi soạn kịch bản.</p>}
    {automatic && plan.data?.selectionBasis === 'PARTIAL_OR_MISSING_REACTIONS' && <p className="notice warning">Thiếu số react ở một số bình luận. Bài có số liệu được ưu tiên; phần còn lại giữ thứ tự ổn định. Chưa thể xác nhận đây là top react của bài trên mạng xã hội.</p>}
    {plan.loading && !plan.data && <p role="status">Đang chọn bình luận…</p>}
    <div className="studio-comments">{comments.map((comment) => <label className="checkbox-label studio-comment" key={comment.id}><input type="checkbox" aria-label={comment.body} aria-describedby={`comment-reacts-${postId}-${comment.id}`} checked={ids.includes(comment.id)} disabled={locked} onChange={(event) => { onMode('MANUAL'); onSelection(event.target.checked ? [...ids, comment.id].filter((id, index, all) => all.indexOf(id) === index).slice(0, 10) : ids.filter((id) => id !== comment.id)); }} /><span>{comment.body}<small className="field-help" id={`comment-reacts-${postId}-${comment.id}`}> · {comment.likes === null || comment.likes === undefined ? 'Chưa có số react' : `${comment.likes} react đã lưu`}{comment.sensitiveFlags?.length ? ' · Cần xử lý dữ liệu nhạy cảm' : ''}</small></span></label>)}</div>
    {!comments.length && !plan.loading && <p className="field-help">Chưa có bình luận khả dụng. Nhập cả khối hoặc file dữ liệu có quyền sử dụng; ứng dụng không tự bịa thêm bình luận.</p>}
    {!automatic && <p className="field-help">Chọn tối đa 10 bình luận trong số 100 bình luận đang hiển thị.</p>}
  </section>;
}
