'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { mayReview, unknownResponseSchema } from '../lib/contracts';
import { getOperationKey, type OperationKeys } from '../lib/local-export';
import { lifecycleLabels, studioLink, type StudioItem } from '../lib/studio';
import { useSession } from './app-shell';
import { ErrorNotice } from './feedback';
import { PostInspector } from './workspace-page';

export function ContentDetail({ item, onChanged, showStudioLink = true }: { item: StudioItem; onChanged: () => void; showStudioLink?: boolean }) {
  const { role } = useSession();
  const [reviewed, setReviewed] = useState(false);
  const [editingRights, setEditingRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useRef<OperationKeys>({});
  const right = item.post.rights[0];
  const eligible = Boolean(item.candidate && item.candidate.score !== null && item.candidate.score >= item.candidate.minimumScore && !['REJECTED', 'BLOCKED_SAFETY', 'BLOCKED_RIGHTS', 'BELOW_THRESHOLD', 'DUPLICATE'].includes(item.candidate.status));
  async function review(kind: 'rights' | 'candidate') {
    if (!reviewed || !mayReview(role)) return;
    setBusy(true); setError('');
    const path = kind === 'rights' ? `/posts/${item.id}/rights/review` : `/candidates/${item.candidate?.id}/review`;
    try {
      const body = { decision: 'APPROVED' };
      const idempotencyKey = await getOperationKey(keys.current, `${kind}:${item.id}`, { path, body });
      await api(path, unknownResponseSchema, { method: 'POST', body, idempotencyKey });
      onChanged();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <article className="content-detail panel" aria-label="Chi tiết nội dung">
    <div className="panel-heading"><div><h2>{item.post.title || 'Bài chưa có tiêu đề'}</h2><a className="text-button" href={item.post.canonicalUrl} target="_blank" rel="noreferrer">Mở bài gốc ↗</a></div><span className="badge neutral">{item.lifecycle.simulated ? 'Mô phỏng · ' : ''}{lifecycleLabels[item.lifecycle.state]}</span></div>
    <p className="source-body">{item.post.body}</p>
    <details open><summary>Bình luận ({item.post._count?.comments ?? item.post.comments?.length ?? 0})</summary><ol className="comment-list">{item.post.comments?.map((comment) => <li key={comment.id}>{comment.body}</li>)}</ol><p className="field-help">Xem tối đa 100 bình luận; chọn các trích dẫn trong Studio.</p></details>
    <div className="content-review-strip"><div><small>Quyền sử dụng</small><strong>{right?.reviewStatus === 'APPROVED' ? 'Đã duyệt' : 'Cần kiểm tra'}</strong><p>{right?.basis ?? 'UNKNOWN'} · {right?.territory ?? 'Chưa có lãnh thổ'}</p></div><div><small>Điểm tiềm năng</small><strong>{item.candidate?.score ?? '—'} <small>/ {item.candidate?.minimumScore ?? '—'} tối thiểu</small></strong><p>Ước tính từ bộ chấm điểm hiện có, không bảo đảm hiệu quả.</p></div></div>
    <details><summary>Bằng chứng và lý do chấm điểm</summary><p>{right?.evidence || 'Chưa cung cấp bằng chứng.'}</p><p>Nền tảng cho phép: {right?.allowedPlatforms.join(', ') || 'Chưa có'}</p><p>{item.candidate?.reasoning || 'Đang chờ kết quả chấm điểm.'}</p></details>
    {error && <ErrorNotice message={error} />}
    {item.lifecycle.blockedReason && <div className="notice warning">{item.lifecycle.blockedReason}</div>}
    {item.candidate?.status !== 'APPROVED' && <><label className="checkbox-label"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>Tôi đã kiểm tra bài, bình luận và bằng chứng; xác nhận quyền sử dụng cho video.</span></label><div className="phase5-actions">
      {right?.reviewStatus !== 'APPROVED' && <button className="button secondary" disabled={busy || !reviewed || !mayReview(role) || !right || right.basis === 'UNKNOWN'} onClick={() => void review('rights')}>Duyệt quyền sử dụng</button>}
      {right?.reviewStatus === 'APPROVED' && <button className="button" disabled={busy || !reviewed || !mayReview(role) || !eligible} onClick={() => void review('candidate')}>Chọn nội dung này</button>}
    </div>{!mayReview(role) && <p className="field-help">Cần OWNER, ADMIN hoặc REVIEWER để duyệt quyền và chọn bài.</p>}</>}
    <div className="phase5-actions"><button className="text-button" onClick={() => setEditingRights((value) => !value)}>Chỉnh thông tin quyền</button>{showStudioLink && item.candidate?.status === 'APPROVED' && <Link className="button" href={studioLink({ postIds: [item.id] })}>Tiếp tục trong Studio →</Link>}{item.run && <Link className="text-button" href={studioLink({ postIds: [item.id], runId: item.run.id })}>Mở lượt đang có</Link>}</div>
    {editingRights && <PostInspector post={item.post} reviewMode onClose={() => setEditingRights(false)} onChanged={() => { setEditingRights(false); onChanged(); }} />}
  </article>;
}
