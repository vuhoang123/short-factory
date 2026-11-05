'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { mayReview, unknownResponseSchema } from '../lib/contracts';
import { getOperationKey, type OperationKeys } from '../lib/local-export';
import { lifecycleLabels, studioItemsSchema, studioLink, type StudioItem } from '../lib/studio';
import { useResource } from '../lib/use-resource';
import { useSession } from './app-shell';
import { ContentDetail } from './content-detail';
import { EmptyState, ErrorNotice } from './feedback';

export function Discover() {
  const { role } = useSession();
  const [filters, setFilters] = useState('');
  const [cursors, setCursors] = useState<string[]>(['']);
  const cursor = cursors.at(-1) ?? '';
  const feed = useResource(`/studio/content?limit=12${filters}${cursor ? `&cursor=${cursor}` : ''}`, studioItemsSchema);
  const [selected, setSelected] = useState<Record<string, StudioItem>>({});
  const [detailId, setDetailId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState('');
  const keys = useRef<OperationKeys>({});
  const chosen = Object.values(selected);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const params = new URLSearchParams();
    for (const key of ['q', 'platform', 'topic', 'minScore', 'minLikes']) { const value = String(form.get(key) ?? '').trim(); if (value) params.set(key, value); }
    for (const key of ['from', 'to']) { const value = String(form.get(key) ?? ''); if (value) params.set(key, `${value}T${key === 'from' ? '00:00:00.000' : '23:59:59.999'}Z`); }
    setFilters(params.size ? `&${params}` : ''); setCursors(['']); setSelected({}); setConfirmed(false); setResults([]); setDetailId('');
  }
  async function approveSelected() {
    if (!confirmed || !mayReview(role) || busy) return;
    setBusy(true); setResults([]); const messages: string[] = [];
    try {
      for (const item of chosen) {
        try {
          const path = `/candidates/${item.candidate?.id}/review`; const body = { decision: 'APPROVED' };
          await api(path, unknownResponseSchema, { method: 'POST', body, idempotencyKey: await getOperationKey(keys.current, item.id, { path, body }) });
          messages.push(`${item.post.title || item.id}: đã chọn.`);
        } catch (failure) { messages.push(`${item.post.title || item.id}: ${errorMessage(failure)}`); }
      }
      setResults(messages); setSelected({}); setConfirmed(false); feed.reload();
    } finally { setBusy(false); }
  }
  const bulkEligible = chosen.length > 0 && chosen.every((item) => item.candidate && ['PENDING_REVIEW', 'NEEDS_RIGHTS_REVIEW'].includes(item.candidate.status) && item.candidate.score !== null && item.candidate.score >= item.candidate.minimumScore && item.post.rights[0]?.reviewStatus === 'APPROVED' && !item.lifecycle.blockedReason);
  return <><div className="page-heading"><div><h1>Thư viện nội dung</h1><p>Tìm nội dung đáng kể. Kiểm tra nguồn trước khi đưa vào Studio.</p></div><Link href="/studio?mode=import" className="button">+ Nhập bài viết</Link></div>
    <form className="discover-filters panel" onSubmit={filter}><label className="discover-search">Tìm nội dung<input name="q" maxLength={200} placeholder="Từ khóa trong tiêu đề hoặc bài viết…" /></label><label>Nền tảng<select name="platform"><option value="">Tất cả</option>{['FACEBOOK', 'THREADS', 'REDDIT', 'MANUAL'].map((platform) => <option key={platform}>{platform}</option>)}</select></label><label>Chủ đề<input name="topic" maxLength={80} placeholder="Tên thẻ chủ đề" /></label><details className="filter-advanced"><summary>Bộ lọc nâng cao</summary><div className="filter-fields"><label>Điểm tối thiểu<input name="minScore" type="number" min={0} max={100} /></label><label>Lượt thích tối thiểu<input name="minLikes" type="number" min={0} max={2147483647} /></label><label>Ngày thêm từ (UTC)<input name="from" type="date" /></label><label>Đến ngày (UTC)<input name="to" type="date" /></label></div><p className="field-help">Lượt thích dựa trên snapshot đã lưu; không tự lấy số liệu từ link.</p></details><button className="button secondary" disabled={busy}>Tìm bài</button></form>
    <div className="feed-toolbar"><p>{chosen.length ? `${chosen.length}/12 bài đang chọn` : 'Nội dung đã nhập và kết quả khám phá đã lưu'}</p><button className="text-button" disabled={busy} onClick={feed.reload}>Làm mới</button></div>
    {feed.error && <ErrorNotice message={feed.error} retry={feed.reload} />}{error && <ErrorNotice message={error} />}
    {chosen.length > 0 && <section className="bulk-bar panel" aria-label="Thao tác hàng loạt"><div className="phase5-actions"><Link className="button" href={studioLink({ postIds: chosen.map((item) => item.id) })}>Mở {chosen.length} bài trong Studio</Link><button className="text-button" disabled={busy} onClick={() => { setSelected({}); setConfirmed(false); }}>Bỏ chọn</button></div><p className="field-help">Mở hàng đợi biên tập; từng bài vẫn cần duyệt trước khi tạo video.</p>{mayReview(role) && <><label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!bulkEligible || busy} /><span>Tôi đã kiểm tra từng bài được chọn và quyền sử dụng hiện hành.</span></label><button className="button secondary small" disabled={!bulkEligible || !confirmed || busy} onClick={() => void approveSelected()}>{busy ? 'Đang chọn bài…' : 'Duyệt chọn các bài đủ điều kiện'}</button>{!bulkEligible && <p className="field-help">Chỉ duyệt hàng loạt các bài đã chấm điểm đạt ngưỡng, không có cờ chặn và có quyền đã duyệt.</p>}</>}</section>}
    {results.length > 0 && <ul className="notice" role="status">{results.map((message, index) => <li key={index}>{message}</li>)}</ul>}
    {feed.loading && !feed.data ? <p role="status">Đang tải nội dung…</p> : feed.data?.items.length ? <div className="discover-grid">{feed.data.items.map((item) => <article className="panel discover-card" key={item.id}><div className="card-topline"><label className="checkbox-label"><input type="checkbox" aria-label={`Chọn ${item.post.title || 'bài viết'}`} checked={Boolean(selected[item.id])} disabled={busy || (!selected[item.id] && chosen.length >= 12)} onChange={(event) => { const checked = event.target.checked; setSelected((previous) => { const next = { ...previous }; if (checked) next[item.id] = item; else delete next[item.id]; return next; }); setConfirmed(false); }} /></label></div><span className="badge neutral">{item.lifecycle.simulated ? 'Mô phỏng · ' : ''}{lifecycleLabels[item.lifecycle.state]}</span><h2><button className="card-title" onClick={() => { setDetailId(item.id); setError(''); }}>{item.post.title || 'Bài chưa có tiêu đề'}</button></h2><p className="card-excerpt">{item.post.body}</p>{item.post.comments?.[0] && <blockquote className="discover-comment">“{item.post.comments[0].body}”</blockquote>}<div className="card-metrics"><span>♥ {item.post.metricSnapshots?.[0]?.likes ?? '—'}</span><span>☏ {item.post._count?.comments ?? 0}</span><span>Điểm <b>{item.candidate?.score ?? '—'}</b></span></div><div className="card-tags">{item.post.topicTags?.map((tag) => <span className="badge neutral" key={tag}>{tag}</span>)}</div><p className="field-help">{item.lifecycle.blockedReason || item.lifecycle.nextAction}</p><div className="phase5-actions"><button className="text-button" onClick={() => setDetailId(item.id)}>Xem chi tiết →</button><Link className="button secondary small" href={studioLink({ postIds: [item.id] })}>Mở Studio</Link></div></article>)}</div> : !feed.error && <EmptyState title="Chưa có nội dung phù hợp">Điều chỉnh bộ lọc hoặc nhập link cùng nội dung bạn có quyền sử dụng.</EmptyState>}
    <div className="phase5-actions pagination"><button className="button secondary small" disabled={busy || feed.loading || cursors.length === 1} onClick={() => { setCursors((current) => current.slice(0, -1)); setDetailId(''); }}>Trang trước</button><button className="button secondary small" disabled={busy || feed.loading || !feed.data?.nextCursor} onClick={() => { if (feed.data?.nextCursor) setCursors((current) => [...current, feed.data!.nextCursor!]); setDetailId(''); }}>Trang tiếp</button></div>
    {detailId && <DetailPanel key={detailId} id={detailId} onClose={() => setDetailId('')} onChanged={feed.reload} />}
  </>;
}

function DetailPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useResource(`/studio/content/${id}`, studioItemsSchema);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; const opener = document.activeElement; element?.showModal(); return () => { element?.close(); if (opener instanceof HTMLElement) opener.focus(); }; }, []);
  return <dialog ref={dialog} className="detail-drawer" aria-label="Nội dung đang xem" onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="detail-drawer-heading"><h2>Chi tiết bài viết</h2><button className="button secondary small" onClick={onClose}>Đóng chi tiết</button></div>{detail.error && <ErrorNotice message={detail.error} retry={detail.reload} />}{detail.data?.items[0] ? <ContentDetail item={detail.data.items[0]} onChanged={() => { detail.reload(); onChanged(); }} /> : <p role="status">Đang tải chi tiết…</p>}</dialog>;
}
