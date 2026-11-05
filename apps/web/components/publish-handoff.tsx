'use client';

import Link from 'next/link';
import { z } from 'zod';
import { useResource } from '../lib/use-resource';
import { studioLink } from '../lib/studio';
import { EmptyState, ErrorNotice } from './feedback';

const videosSchema = z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), reviewStatus: z.string(), mediaAssetId: z.string().nullable() })) });
const accountsSchema = z.object({ items: z.array(z.object({ id: z.string(), displayName: z.string(), platform: z.string(), status: z.string() })) });
export function PublishHandoff() {
  const videos = useResource('/videos', videosSchema);
  const accounts = useResource('/automation/accounts', accountsSchema);
  const ready = videos.data?.items.filter((video) => video.reviewStatus === 'APPROVED' && video.mediaAssetId) ?? [];
  return <><div className="page-heading"><div><h1>Bàn giao video</h1><p>Video đã duyệt và bàn giao để đăng thủ công.</p></div><span className="badge neutral">BLOCKED_EXTERNAL</span></div><section className="panel form-panel"><h2>Kết nối nền tảng</h2><p>Chưa có kết nối đăng bài được xác minh. YouTube, Facebook, Threads và TikTok cần quyền API, tài khoản và chấp thuận phù hợp trước khi bật đăng hoặc lên lịch.</p><div className="notice"><strong>Đăng thủ công từ MP4</strong><span>Tải bản đã duyệt, kiểm tra ghi nguồn và phạm vi quyền rồi đăng bằng tài khoản của bạn. Mốc này chưa tạo lịch đăng hoặc thực hiện OAuth.</span></div></section>
    <section className="panel form-panel"><h2>Tài khoản trong workspace</h2>{accounts.error && <ErrorNotice message={accounts.error} retry={accounts.reload} />}{accounts.data?.items.length ? <ul>{accounts.data.items.map((account) => <li key={account.id}><strong>{account.displayName}</strong> · {account.platform} · {account.status === 'MOCK_ONLY' ? 'Tài khoản mô phỏng local' : account.status}</li>)}</ul> : <p className="muted">{accounts.loading ? 'Đang kiểm tra tài khoản…' : 'Chưa có tài khoản đã lưu.'}</p>}<p className="field-help">Danh sách này chỉ đọc. Một bản ghi tài khoản chưa xác nhận khả năng đăng bằng API.</p></section>
    <section className="panel"><div className="panel-heading"><div><h2>Sẵn sàng bàn giao</h2><p>Chỉ liệt kê video có bản MP4 và đã được người duyệt chấp thuận; quyền hiện hành tiếp tục được kiểm tra khi truy cập media.</p></div><button className="text-button" onClick={videos.reload}>Làm mới</button></div>{videos.error && <ErrorNotice message={videos.error} retry={videos.reload} />}{videos.loading && !videos.data ? <p role="status">Đang tải video…</p> : ready.length ? <div className="recent-list">{ready.map((video) => <div className="recent-item" key={video.id}><div><strong>{video.title}</strong><p>Đã duyệt · kiểm tra quyền và ghi nguồn trước khi đăng</p></div><div className="phase5-actions"><Link className="text-button" href={studioLink({ videoId: video.id })}>Xem trong Studio</Link><a className="button small" href={`/api/v1/media/${video.mediaAssetId}?download=1`}>Tải MP4</a></div></div>)}</div> : <EmptyState title="Chưa có video đã duyệt">Mở video trong Studio để xem và duyệt trước khi bàn giao.</EmptyState>}</section></>;
}
