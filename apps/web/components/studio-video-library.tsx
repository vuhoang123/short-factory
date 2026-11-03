'use client';

import Link from 'next/link';
import { z } from 'zod';
import { useResource } from '../lib/use-resource';
import { studioLink } from '../lib/studio';
import { EmptyState, ErrorNotice } from './feedback';

const videosSchema = z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), reviewStatus: z.string(), mediaAssetId: z.string().nullable() })) });

export function StudioVideoLibrary() {
  const videos = useResource('/videos', videosSchema);
  const items = [...(videos.data?.items ?? [])].sort((a, b) => Number(b.reviewStatus === 'PENDING' && b.status === 'READY_FOR_REVIEW') - Number(a.reviewStatus === 'PENDING' && a.status === 'READY_FOR_REVIEW'));
  return <section className="panel studio-video-list" id="studio-videos" aria-labelledby="studio-videos-heading">
    <div className="panel-heading"><div><h2 id="studio-videos-heading">Video đã tạo & duyệt</h2><p>Mở bản MP4 để xem, duyệt và tải về. Hiển thị tối đa 50 video gần đây trong workspace.</p></div><button className="text-button" onClick={videos.reload} disabled={videos.loading}>Làm mới video</button></div>
    {videos.error && <ErrorNotice message={videos.error} retry={videos.reload} />}
    {videos.loading && !videos.data ? <p role="status" className="loading-state">Đang tải video…</p> : items.length ? <div className="recent-list">{items.map(video => {
      const ready = video.status === 'READY_FOR_REVIEW' && video.reviewStatus === 'PENDING' && Boolean(video.mediaAssetId);
      const label = ready ? 'Chờ duyệt' : video.reviewStatus === 'APPROVED' ? 'Đã duyệt' : video.reviewStatus === 'REJECTED' ? 'Không duyệt' : video.mediaAssetId ? 'Bản MP4 đã lưu' : 'Chưa có MP4';
      return <div className="recent-item" key={video.id}><div><strong>{video.title}</strong><p><span className={`badge ${ready ? 'warning' : 'neutral'}`}>{label}</span></p></div><Link className={`button ${ready ? '' : 'secondary'} small`} href={`${studioLink({ videoId: video.id })}#video-review`}>{ready ? 'Xem & duyệt' : 'Mở video'}</Link></div>;
    })}</div> : !videos.error && <EmptyState title="Chưa có video để duyệt">Sau khi bấm Tạo video MP4 và dựng xong, video sẽ xuất hiện ở đây.</EmptyState>}
  </section>;
}
