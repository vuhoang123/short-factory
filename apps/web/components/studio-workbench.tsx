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
import { StudioVideoLibrary } from './studio-video-library';

const seedSchema = z.object({ sourcePostId: z.string().uuid().optional(), story: z.object({ post: z.object({ id: z.string().uuid() }) }).nullable().optional() });

export function StudioWorkbench({ postIds, runId, videoId, importMode, videosView = false }: { postIds: string[]; runId?: string; videoId?: string; importMode: boolean; videosView?: boolean }) {
  const [active, setActive] = useState(postIds[0] ?? '');
  const importing = importMode || !active && !runId && !videoId && !videosView;
  return <><div className="page-heading"><div><h1>{videosView ? 'Video của bạn' : importing ? 'Bắt đầu một video mới' : 'Biên tập video'}</h1><p>{videosView ? 'Xem bản MP4, duyệt và tải video về máy.' : importing ? 'Mang bài viết và những bình luận hay vào video của bạn.' : 'Chỉnh lời đọc, chọn nền và xem video trong cùng một nơi.'}</p></div><Link className="button secondary" href={videosView ? '/studio' : '/studio?view=videos'}>{videosView ? 'Tạo video mới' : 'Video đã tạo & duyệt'}</Link></div>
    {videosView ? <StudioHome /> : importing ? <LocalExport embedded /> : active ? <><nav className="studio-queue" aria-label="Hàng đợi biên tập">{postIds.length > 1 && postIds.map((id, index) => <button className={`button ${active === id ? '' : 'secondary'} small`} key={id} onClick={() => setActive(id)} aria-pressed={active === id}>Bài {index + 1}</button>)}</nav><SelectedStudio key={`${active}:${runId ?? ''}:${videoId ?? ''}`} postId={active} runId={active === postIds[0] ? runId : undefined} videoId={active === postIds[0] ? videoId : undefined} /></> : <SeededStudio runId={runId} videoId={videoId} />}
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
  return <><StudioVideoLibrary /><section className="panel"><div className="panel-heading"><div><h2>Đang làm gần đây</h2><p>Mở lại đúng bài và lượt đã lưu.</p></div><Link href="/export" className="text-button">Lịch sử, hủy & phục hồi →</Link></div>{recent.error && <ErrorNotice message={recent.error} retry={recent.reload} />}{recent.loading && !recent.data ? <p role="status">Đang tải công việc…</p> : recent.data?.recent.length ? <div className="recent-list">{recent.data.recent.map((run) => <Link className="recent-item" key={run.id} href={studioLink({ postIds: [run.story.sourcePostId], runId: run.id })}><div><strong>{run.story.post.title || 'Bài chưa có tiêu đề'}</strong><p>{humanStage(run.currentStage)}</p></div><span aria-hidden="true">→</span></Link>)}</div> : <EmptyState title="Chưa có công việc đang làm">Tạo một video mới từ link bài viết hoặc chọn nội dung trong thư viện.</EmptyState>}</section></>;
}
