'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { sourceImageMetadataSchema } from '@shorts-factory/media/contracts';
import { ApiError, api, errorMessage } from '../lib/api';
import { useSession } from './app-shell';

const queuedSchema = z.object({ id: z.string().uuid(), status: z.string() });
const openedSchema = z.object({ opened: z.literal(true) });
const captureSchema = queuedSchema.extend({ errorCode: z.string().nullable(), output: z.object({ postId: z.string().uuid(), warnings: z.array(z.string()), scannedComments: z.number(), capturedComments: z.number() }).nullable() });
const imagesSchema = z.object({ items: z.array(z.object({ id: z.string().uuid(), metadata: sourceImageMetadataSchema })) });

export function BrowserCapture({ channelId, disabled, onImported }: { channelId: string; disabled: boolean; onImported: (postId: string) => void }) {
  const { session } = useSession();
  const storageKey = `sf:capture:${session.activeWorkspaceId}:${session.user.id}`;
  const [url, setUrl] = useState('');
  const [id, setId] = useState('');
  const [run, setRun] = useState<z.infer<typeof captureSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const [revision, setRevision] = useState(0);
  const callback = useRef(onImported);
  callback.current = onImported;
  const requestKey = useRef({ payload: '', key: '' });
  useEffect(() => { try { const saved = sessionStorage.getItem(storageKey); if (saved && z.string().uuid().safeParse(saved).success) setId(saved); } catch { /* A live capture can still run without session storage. */ } }, [storageKey]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api(`/source-captures/${id}`, captureSchema, { signal: controller.signal });
        if (!active) return;
        setRun(result);
        if (result.status === 'SUCCEEDED' && result.output) { try { sessionStorage.removeItem(storageKey); } catch { /* Result is also durable on the server. */ } callback.current(result.output.postId); }
        else if (['QUEUED', 'RUNNING'].includes(result.status)) timer = setTimeout(() => { void poll(); }, 2500);
      } catch (failure) { if (active) { setError(errorMessage(failure)); if (failure instanceof ApiError && failure.status === 404) { setId(''); setRun(null); try { sessionStorage.removeItem(storageKey); } catch { /* No cached job remains in memory. */ } } } }
    };
    void poll();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [id, revision, storageKey]);
  const running = Boolean(id && (!run || ['QUEUED', 'RUNNING'].includes(run.status)));
  async function open() {
    setBusy(true); setError('');
    try { await api('/source-captures/browser', openedSchema, { method: 'POST', body: { url } }); setOpened(true); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function capture() {
    setBusy(true); setError('');
    try {
      const body = { url, channelId }; const payload = JSON.stringify(body);
      if (requestKey.current.payload !== payload || run && ['FAILED', 'CANCELLED'].includes(run.status)) requestKey.current = { payload, key: crypto.randomUUID() };
      const result = await api('/source-captures', queuedSchema, { method: 'POST', body, idempotencyKey: requestKey.current.key });
      setRun(null); setId(result.id); setRevision(value => value + 1);
      try { sessionStorage.setItem(storageKey, result.id); } catch { /* The server still records the job. */ }
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section className="panel form-panel studio-setup"><h2>1. Chụp bài và bình luận gốc</h2><p>Dán link → mở trình duyệt riêng → đăng nhập, mở đầy đủ bài/bình luận → bấm chụp. Tự chọn 5–10 bình luận theo số react trong phần đã tải được.</p>
    <label>Link để chụp ảnh gốc<input type="url" value={url} onChange={event => { setUrl(event.target.value); setOpened(false); }} placeholder="https://www.facebook.com/share/p/.../" disabled={running || busy} /></label>
    <div className="phase5-actions"><button className="button secondary" disabled={disabled || busy || running || !url} onClick={() => void open()}>Mở trình duyệt đăng nhập</button><button className="button" disabled={disabled || busy || running || !opened || !channelId} onClick={() => void capture()}>Đã đăng nhập · Chụp bài và bình luận</button></div>
    {opened && <p role="status">Đăng nhập trực tiếp trong cửa sổ vừa mở. Có thể mở bài, bấm “Xem thêm” và tải bình luận trước khi chụp.</p>}
    {error && <div role="alert" className="notice error">{error}<button className="text-button" onClick={() => setRevision(value => value + 1)}>Tải lại lượt chụp</button></div>}
    {running && <p role="status">{run?.status === 'RUNNING' ? 'Đang đọc nội dung và chụp ảnh gốc…' : 'Đã xếp hàng chụp ảnh…'} Có thể tải lại trang để tiếp tục.<button className="text-button" disabled={busy || disabled} onClick={() => { setBusy(true); void api(`/source-captures/${id}/cancel`, queuedSchema, { method: 'POST', body: {} }).then(() => setRevision(value => value + 1)).catch(failure => setError(errorMessage(failure))).finally(() => setBusy(false)); }}>Hủy chụp</button></p>}
    {run?.status === 'FAILED' && <div role="alert" className="notice error">Chụp chưa thành công: {run.errorCode}. Kiểm tra cửa sổ đăng nhập và mở đúng bài rồi thử lại.</div>}
    <p className="field-help">Ảnh có thể chứa thông tin cá nhân. Bạn sẽ xem bản gốc/bản che tên và duyệt quyền trước khi tạo video. Không tự đăng lên mạng xã hội.</p>
  </section>;
}

export function SourceImagePreview({ postId, anonymized }: { postId: string; anonymized: boolean }) {
  const [images, setImages] = useState<z.infer<typeof imagesSchema>['items'] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setImages(null); setError('');
    void api(`/posts/${postId}/source-images`, imagesSchema, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setImages(result.items); }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [postId]);
  if (error) return <p role="alert">Không tải được ảnh nguồn: {error}</p>;
  if (!images?.length) return null;
  const variant = anonymized ? 'ANONYMIZED' : 'ORIGINAL';
  const selected = images.filter(image => image.metadata.variant === variant);
  const refs = new Set(images.map(image => image.metadata.sourceRef));
  const missing = [...refs].filter(ref => !selected.some(image => image.metadata.sourceRef === ref));
  return <div><h3>Ảnh giao diện gốc · {anonymized ? 'Đã che tên/avatar' : 'Nguyên bản'}</h3><p className="field-help">Giữ nguyên nội dung và số react trên ảnh. Bản che tên/avatar không che tên xuất hiện trong nội dung bài/bình luận; hãy kiểm tra từng ảnh.</p>{missing.length > 0 && <p role="alert" className="notice warning">Thiếu {missing.length} ảnh ở chế độ này. Video sẽ bị chặn nếu chọn nguồn thiếu ảnh.</p>}<div className="source-image-grid">{selected.map(image => <a key={image.id} href={`/api/v1/media/${image.id}`} target="_blank" rel="noreferrer"><img src={`/api/v1/media/${image.id}`} alt={image.metadata.sourceRef.startsWith('post:') ? 'Ảnh chụp bài gốc' : 'Ảnh chụp bình luận gốc'} loading="lazy" /></a>)}</div></div>;
}
