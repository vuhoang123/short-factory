'use client';

import Link from 'next/link';
import { z } from 'zod';
import { studioLink, studioOverviewSchema, humanStage } from '../lib/studio';
import { useResource } from '../lib/use-resource';
import { EmptyState, ErrorNotice } from './feedback';

const performanceSchema = z.object({ summary: z.object({ produced: z.number(), published: z.number(), views: z.number().nullable(), engagementRate: z.number().nullable() }), freshness: z.object({ stale: z.boolean(), lastSyncedAt: z.string().nullable() }) });

export function ProductOverview() {
  const overview = useResource('/studio/overview', studioOverviewSchema, 10000);
  const performance = useResource('/analytics/overview', performanceSchema);
  const data = overview.data;
  return <><div className="page-heading"><div><h1>Tổng quan</h1><p>Từ một ý tưởng hay đến video sẵn sàng để duyệt.</p></div><Link href="/studio?mode=import" className="button">+ Tạo video từ bài viết</Link></div>
    {overview.error && <ErrorNotice message={overview.error} retry={overview.reload} />}
    {!data ? <p role="status">Đang tải tổng quan…</p> : <><section className="overview-counts">{[{ label: 'Nội dung đã lưu', value: data.counts.discovered, href: '/discover' }, { label: 'Bài đã chọn', value: data.counts.selected, href: '/discover' }, { label: 'Đang soạn / dựng', value: data.counts.scripting + data.counts.rendering, href: '/studio' }, { label: 'Video cần duyệt', value: data.counts.review, href: '/studio' }, { label: 'Video đã duyệt', value: data.counts.approved, href: '/publish' }, { label: 'Lượt cần xử lý', value: data.counts.failed, href: '/export' }].map((metric) => <Link key={metric.label} href={metric.href}><strong>{metric.value}</strong><span>{metric.label}</span></Link>)}</section>
    <div className="overview-grid"><section className="panel"><div className="panel-heading"><div><h2>Tiếp tục công việc</h2><p>Các lượt xử lý gần nhất trong workspace.</p></div><Link className="text-button" href="/export">Toàn bộ lịch sử →</Link></div>{data.recent.length ? <div className="recent-list">{data.recent.map((run) => <Link className="recent-item" key={run.id} href={studioLink({ postIds: [run.story.sourcePostId], runId: run.id })}><span className="post-glyph" aria-hidden="true">▶</span><div><strong>{run.story.post.title || 'Bài chưa có tiêu đề'}</strong><p>{humanStage(run.currentStage)} · {new Date(run.createdAt).toLocaleDateString('vi-VN')}</p></div><span className={`badge ${run.status.startsWith('FAILED') || run.status.startsWith('BLOCKED') ? 'negative' : 'neutral'}`}>{run.status === 'SUCCEEDED' ? 'Hoàn tất lượt' : run.status === 'CANCELLED' ? 'Đã hủy' : run.status.startsWith('FAILED') || run.status.startsWith('BLOCKED') ? 'Cần xử lý' : 'Đang xử lý'}</span></Link>)}</div> : <EmptyState title="Bắt đầu với bài viết đầu tiên">Dán link và nội dung bạn có quyền sử dụng hoặc chọn bài từ Discover.</EmptyState>}</section>
    <section className="next-step"><h2>Chọn bài. Sửa lời. Dựng video.</h2><p>Kiểm tra quyền và nội dung, soạn bản nháp trong Studio rồi chủ động tạo MP4.</p><Link className="button secondary" href="/discover">Khám phá nội dung →</Link><div className="next-step-note"><strong>Đăng bài: chờ cấp phép</strong><span>{data.counts.published} bài đăng thực tế · {data.counts.scheduled} lượt đang chờ. Chưa kết nối API đăng bài trong mốc này.</span></div></section></div></>}
    <section className="panel form-panel performance-summary"><div className="panel-heading"><div><h2>Hiệu quả nội dung</h2><p>Số liệu từ Analytics hiện có. Chưa có quan sát sẽ hiển thị “—”.</p></div><Link href="/analytics" className="text-button">Xem Analytics →</Link></div>{performance.error && <ErrorNotice message={performance.error} retry={performance.reload} />}{performance.data ? <div className="card-metrics"><span>Video: <b>{performance.data.summary.produced}</b></span><span>Lượt xem: <b>{performance.data.summary.views?.toLocaleString('vi-VN') ?? '—'}</b></span><span>Tương tác: <b>{performance.data.summary.engagementRate === null ? '—' : `${(performance.data.summary.engagementRate * 100).toFixed(1)}%`}</b></span><span>{performance.data.freshness.stale ? 'Cần cập nhật số liệu' : 'Đã cập nhật'}</span></div> : !performance.error && <p role="status">Đang tải hiệu quả…</p>}</section>
  </>;
}
