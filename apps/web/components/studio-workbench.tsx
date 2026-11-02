'use client';

import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { studioItemsSchema, studioLink, studioOverviewSchema, humanStage } from '../lib/studio';
import { useResource } from '../lib/use-resource';
import { ContentDetail } from './content-detail';
import { EmptyState, ErrorNotice } from './feedback';
import { LocalExport } from './local-export';
import { StoryStudio } from './story-studio';

const seedSchema = z.object({ sourcePostId: z.string().uuid().optional(), story: z.object({ post: z.object({ id: z.string().uuid() }) }).nullable().optional() });

export function StudioWorkbench({ postIds, runId, videoId, importMode }: { postIds: string[]; runId?: string; videoId?: string; importMode: boolean }) {
  const [active, setActive] = useState(postIds[0] ?? '');
  return <><div className="page-heading"><div><span className="eyebrow">02 / STUDIO</span><h1>Studio</h1><p>{importMode ? 'Dán link cùng nội dung được phép sử dụng để tạo video local.' : 'Soạn kịch bản → nghe lời đọc → tạo MP4 → duyệt và tải về.'}</p></div><Link className="button secondary" href={importMode ? '/studio' : '/studio?mode=import'}>{importMode ? 'Về bàn biên tập' : '+ Nhập bài mới'}</Link></div>
    {!importMode && <ol className="workflow-steps" aria-label="Các bước tạo video">{['Nội dung & quyền', 'Kịch bản & lời đọc', 'Dựng & xem trước', 'Duyệt & tải về'].map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>}
    {importMode ? <LocalExport embedded /> : active ? <><nav className="studio-queue" aria-label="Hàng đợi biên tập">{postIds.map((id, index) => <button className={`button ${active === id ? '' : 'secondary'} small`} key={id} onClick={() => setActive(id)} aria-pressed={active === id}>Bài {index + 1}</button>)}</nav><SelectedStudio key={`${active}:${runId ?? ''}:${videoId ?? ''}`} postId={active} runId={active === postIds[0] ? runId : undefined} videoId={active === postIds[0] ? videoId : undefined} /></> : runId || videoId ? <SeededStudio runId={runId} videoId={videoId} /> : <StudioHome />}
  </>;
}

function SeededStudio({ runId, videoId }: { runId?: string; videoId?: string }) {
  const seed = useResource(runId ? `/production-runs/${runId}` : `/videos/${videoId}`, seedSchema);
  const postId = seed.data?.sourcePostId ?? seed.data?.story?.post.id;
  if (seed.error) return <ErrorNotice message={seed.error} retry={seed.reload} />;
  if (!seed.data) return <p role="status">Đang tìm nội dung của video…</p>;
  if (!postId) return <EmptyState title="Không còn nguồn nội dung">Bài gốc có thể đã được gỡ. Mở Discover để chọn nội dung khác.</EmptyState>;
  return <SelectedStudio key={postId} postId={postId} runId={runId} videoId={videoId} />;
}

function SelectedStudio({ postId, runId, videoId }: { postId: string; runId?: string; videoId?: string }) {
  const detail = useResource(`/studio/content/${postId}`, studioItemsSchema);
  const item = detail.data?.items[0];
  if (detail.error) return <ErrorNotice message={detail.error} retry={detail.reload} />;
  if (!item) return <p role="status">Đang mở đúng bài được chọn…</p>;
  return <><details className="studio-context" open={item.candidate?.status !== 'APPROVED' || Boolean(item.lifecycle.blockedReason)}><summary>{item.post.title || 'Nội dung đang biên tập'} · nguồn, bình luận và quyền</summary><ContentDetail item={item} onChanged={detail.reload} showStudioLink={false} /></details><StoryStudio key={postId} source={item} initialRunId={runId ?? item.run?.id} initialVideoId={videoId} embedded /></>;
}

function StudioHome() {
  const recent = useResource('/studio/overview', studioOverviewSchema);
  return <><div className="studio-start-grid"><Link className="panel studio-start" href="/discover"><span className="eyebrow">CHỌN TỪ THƯ VIỆN</span><h2>Tìm một câu chuyện hay →</h2><p>Xem điểm tiềm năng, bình luận và quyền sử dụng trong Discover.</p></Link><Link className="panel studio-start" href="/studio?mode=import"><span className="eyebrow">FACEBOOK / THREADS</span><h2>Dán link bài viết →</h2><p>Nhập nội dung bạn có quyền sử dụng để chạy luồng export local hiện có.</p></Link></div><section className="panel"><div className="panel-heading"><div><h2>Đang làm gần đây</h2><p>Mở lại đúng bài và lượt đã lưu.</p></div><Link href="/export" className="text-button">Lịch sử, hủy & phục hồi →</Link></div>{recent.error && <ErrorNotice message={recent.error} retry={recent.reload} />}{recent.loading && !recent.data ? <p role="status">Đang tải công việc…</p> : recent.data?.recent.length ? <div className="recent-list">{recent.data.recent.map((run) => <Link className="recent-item" key={run.id} href={studioLink({ postIds: [run.story.sourcePostId], runId: run.id })}><div><strong>{run.story.post.title || 'Bài chưa có tiêu đề'}</strong><p>{humanStage(run.currentStage)}</p></div><span aria-hidden="true">→</span></Link>)}</div> : <EmptyState title="Bàn biên tập đã sẵn sàng">Chọn nội dung hoặc nhập bài viết để bắt đầu.</EmptyState>}</section></>;
}
