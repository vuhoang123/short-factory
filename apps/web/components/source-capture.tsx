'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { sourceImageMetadataSchema } from '@shorts-factory/media/contracts';
import { ApiError, api, errorMessage } from '../lib/api';
import { browserCaptureMessageSchema, browserCaptureUrlSchema, captureResumeFromSearch, captureUrlFromSearch, decodeCapturePng, pendingBrowserCaptureSchema } from '../lib/browser-capture';
import { useSession } from './app-shell';

const queuedSchema = z.object({ id: z.string().uuid(), status: z.string() });
const openedSchema = z.object({ opened: z.literal(true) });
const captureSchema = queuedSchema.extend({ errorCode: z.string().nullable(), output: z.object({ postId: z.string().uuid(), warnings: z.array(z.string()), scannedComments: z.number(), capturedComments: z.number() }).nullable(), browserRequest: z.object({ url: browserCaptureUrlSchema }).nullable().optional() });
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
  const [dedicatedOpened, setDedicatedOpened] = useState(false);
  const [extensionReady, setExtensionReady] = useState(false);
  const [pending, setPending] = useState<z.infer<typeof pendingBrowserCaptureSchema> | null>(null);
  const [transfer, setTransfer] = useState('');
  const [revision, setRevision] = useState(0);
  const callback = useRef(onImported);
  callback.current = onImported;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const runRef = useRef(run); runRef.current = run;
  const pingRef = useRef('');
  const transfers = useRef(new Set<string>());
  const requestKey = useRef({ payload: '', key: '' });
  const resumeRequest = useRef<z.infer<typeof pendingBrowserCaptureSchema> | null>(null);
  useEffect(() => {
    const prefilled = captureUrlFromSearch(window.location.search);
    if (prefilled) setUrl(prefilled);
    const resume = captureResumeFromSearch(window.location.search);
    if (resume) { resumeRequest.current = resume; setId(resume.id); return; }
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && z.string().uuid().safeParse(saved).success) setId(saved);
      else if (saved) {
        const parsed = pendingBrowserCaptureSchema.safeParse(JSON.parse(saved));
        if (parsed.success) { setPending(parsed.data); setId(parsed.data.id); setUrl(parsed.data.url); setOpened(true); }
      }
    } catch { /* A live capture can still run without session storage. */ }
  }, [storageKey]);
  useEffect(() => {
    const controller = new AbortController();
    const postMessage = (message: Record<string, unknown>) => window.postMessage({ source: 'shorts-factory', ...message }, window.location.origin);
    const handle = async (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const parsed = browserCaptureMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'PONG') { if (message.requestId === pingRef.current) setExtensionReady(true); return; }
      const active = pendingRef.current;
      if (!active || active.id !== message.jobId || active.requestId !== message.requestId) return;
      if (message.type === 'PREPARED') { setExtensionReady(true); setOpened(true); return; }
      if (message.type === 'CAPTURE_CANCELLED' || message.type === 'CAPTURE_ERROR' && message.error === 'CAPTURE_CANCELLED') {
        try {
          const result = await api(`/source-captures/${active.id}/cancel`, queuedSchema, { method: 'POST', body: {}, idempotencyKey: `capture-cancel:${active.id}`, signal: controller.signal });
          if (!controller.signal.aborted) { setRun({ ...result, errorCode: null, output: null }); setTransfer('Đã hủy lượt chụp từ extension.'); setRevision(value => value + 1); }
        } catch (failure) { if (!controller.signal.aborted) setError(errorMessage(failure)); }
        return;
      }
      if (message.type === 'CAPTURE_ERROR') { setTransfer(''); setError(`Chụp tab chưa thành công: ${message.error}`); return; }
      const imageId = message.type === 'CAPTURE_IMAGE' ? message.imageId : undefined;
      const acknowledge = (ok: boolean, error?: string) => postMessage({ type: 'CAPTURE_ACK', requestId: active.requestId, jobId: active.id, ...(imageId ? { imageId } : {}), ok, ...(error ? { error } : {}) });
      if (runRef.current && !['WAITING_BROWSER', 'QUEUED', 'RUNNING'].includes(runRef.current.status)) { acknowledge(false, 'Lượt chụp đã kết thúc.'); return; }
      const transferKey = `${active.id}:${imageId ?? 'result'}`;
      if (transfers.current.has(transferKey)) return;
      transfers.current.add(transferKey);
      try {
        setError(''); setTransfer(imageId ? 'Đang nhận ảnh chụp từ tab bài viết…' : 'Đang lưu bài và bình luận từ tab hiện tại…');
        if (message.type === 'CAPTURE_IMAGE') {
          const bytes = decodeCapturePng(message.pngBase64);
          const response = await fetch(`/api/v1/source-captures/${active.id}/images/${message.imageId}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/png', 'Idempotency-Key': `capture-image:${active.id}:${message.imageId}` }, body: bytes, signal: controller.signal });
          if (!response.ok) {
            const body = z.object({ message: z.string() }).safeParse(await response.json().catch(() => null));
            throw new Error(body.success ? body.data.message : 'Không lưu được ảnh chụp.');
          }
        } else {
          const result = await api(`/source-captures/${active.id}/result`, queuedSchema, { method: 'POST', body: { post: message.post }, idempotencyKey: `capture-result:${active.id}`, signal: controller.signal });
          if (!controller.signal.aborted) { setRun({ ...result, errorCode: null, output: null }); setRevision(value => value + 1); setTransfer(''); }
        }
        if (!controller.signal.aborted && pendingRef.current?.id === active.id) acknowledge(true);
      } catch (failure) {
        if (!controller.signal.aborted) { const description = failure instanceof Error ? failure.message : errorMessage(failure); setError(description); setTransfer(''); acknowledge(false, description); }
      } finally { transfers.current.delete(transferKey); }
    };
    const listener = (event: MessageEvent<unknown>) => { void handle(event); };
    window.addEventListener('message', listener);
    pingRef.current = crypto.randomUUID();
    postMessage({ type: 'PING', requestId: pingRef.current });
    const timer = setTimeout(() => postMessage({ type: 'PING', requestId: pingRef.current }), 500);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener('message', listener); };
  }, [storageKey]);
  useEffect(() => {
    if (!pending || !extensionReady || run?.status !== 'WAITING_BROWSER') return;
    window.postMessage({ source: 'shorts-factory', type: 'PREPARE_CAPTURE', requestId: pending.requestId, jobId: pending.id, url: pending.url }, window.location.origin);
  }, [pending, extensionReady, run?.status]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api(`/source-captures/${id}`, captureSchema, { signal: controller.signal });
        if (!active) return;
        runRef.current = result; setRun(result);
        const resume = resumeRequest.current;
        if (resume?.id === result.id) {
          resumeRequest.current = null;
          if (result.status === 'WAITING_BROWSER' && result.browserRequest?.url === resume.url) {
            pendingRef.current = resume; setPending(resume); setUrl(resume.url); setOpened(true); setError('');
            try { sessionStorage.setItem(storageKey, JSON.stringify(resume)); } catch { /* The server still records the job. */ }
          } else if (result.status === 'WAITING_BROWSER') setError('Lượt chụp đã hết hạn hoặc không khớp bài đã chọn. Hủy lượt này rồi mở bài lại từ Studio.');
        }
        if (!['WAITING_BROWSER', 'QUEUED', 'RUNNING'].includes(result.status)) {
          pendingRef.current = null; setPending(null);
          try { sessionStorage.removeItem(storageKey); } catch { /* Result is also durable on the server. */ }
        }
        if (result.status === 'SUCCEEDED' && result.output) callback.current(result.output.postId);
        else if (['WAITING_BROWSER', 'QUEUED', 'RUNNING'].includes(result.status)) timer = setTimeout(() => { void poll(); }, 2500);
      } catch (failure) { if (active) { setError(errorMessage(failure)); if (failure instanceof ApiError && failure.status === 404) { resumeRequest.current = null; pendingRef.current = null; setPending(null); setId(''); setRun(null); try { sessionStorage.removeItem(storageKey); } catch { /* No cached job remains in memory. */ } } } }
    };
    void poll();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [id, revision, storageKey]);
  const running = Boolean(id && (!run || ['WAITING_BROWSER', 'QUEUED', 'RUNNING'].includes(run.status)));
  function openCurrent() {
    const parsed = browserCaptureUrlSchema.safeParse(url);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Kiểm tra link bài viết.'); return; }
    if (extensionReady) { void capture('CURRENT'); return; }
    window.open(parsed.data, '_blank', 'noopener,noreferrer');
    setUrl(parsed.data); setOpened(true); setError('');
  }
  async function openDedicated() {
    setBusy(true); setError('');
    try { await api('/source-captures/browser', openedSchema, { method: 'POST', body: { url } }); setDedicatedOpened(true); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function capture(browser: 'CURRENT' | 'DEDICATED') {
    setBusy(true); setError(''); setTransfer('');
    try {
      const body = { url: browserCaptureUrlSchema.parse(url), channelId, ...(browser === 'CURRENT' ? { browser } : {}) }; const payload = JSON.stringify(body);
      if (requestKey.current.payload !== payload || run && ['FAILED', 'CANCELLED'].includes(run.status)) requestKey.current = { payload, key: crypto.randomUUID() };
      const result = await api('/source-captures', queuedSchema, { method: 'POST', body, idempotencyKey: requestKey.current.key });
      const current = browser === 'CURRENT' ? { id: result.id, requestId: crypto.randomUUID(), url: body.url, browser } : null;
      setPending(current); setRun({ ...result, errorCode: null, output: null }); setId(result.id); setRevision(value => value + 1);
      try { sessionStorage.setItem(storageKey, current ? JSON.stringify(current) : result.id); } catch { /* The server still records the job. */ }
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section className="panel form-panel studio-setup source-capture-panel" data-capture-job={pending?.id} data-capture-request={pending?.requestId} data-capture-status={run?.status}><h2>1. Chụp bài và bình luận gốc</h2><p>Mở bài trong Chrome/Edge đang dùng, mở đủ nội dung và bình luận rồi bấm extension để gửi ảnh về Studio.</p>
    <label>Link để chụp ảnh gốc<input type="url" value={url} onChange={event => { setUrl(event.target.value); setOpened(false); setDedicatedOpened(false); }} placeholder="https://www.facebook.com/share/p/.../" disabled={running || busy} /></label>
    <div className="phase5-actions"><button className="button" disabled={disabled || busy || running || !url || !channelId} onClick={openCurrent}>Mở bài trong trình duyệt hiện tại</button></div>
    {opened && <p role="status">Bài được mở ở tab mới trong chính trình duyệt này. Mở đủ nội dung và bình luận cần lấy, rồi bấm extension Shorts Factory trên tab bài viết để chụp. Nếu chưa cài extension, tab chỉ dùng để xem bài.</p>}
    <p className="field-help" role="status">{extensionReady ? 'Đã kết nối extension Shorts Factory.' : 'Chưa kết nối extension Shorts Factory. Mở bài vẫn dùng được; cần cài extension một lần để chụp bằng phiên đăng nhập hiện tại.'}</p>
    {!extensionReady && <details><summary>Cài extension cho Chrome / Edge</summary><ol><li>Chạy <code>pnpm local:capture:setup</code> trong thư mục dự án nếu chưa thiết lập.</li><li>Mở <code>chrome://extensions</code> hoặc <code>edge://extensions</code>, bật Developer mode.</li><li>Chọn Load unpacked và thư mục <code>.data/source-capture/extension</code> trong dự án.</li><li>Tải lại trang Studio. Extension chỉ chụp khi bạn chủ động bấm trên tab bài viết.</li></ol></details>}
    {error && <div role="alert" className="notice error">{error}<button className="text-button" onClick={() => setRevision(value => value + 1)}>Tải lại lượt chụp</button></div>}
    {transfer && <p role="status">{transfer}</p>}
    {running && <p role="status">{run?.status === 'WAITING_BROWSER' ? 'Sẵn sàng nhận ảnh. Chuyển sang tab bài viết, bấm extension Shorts Factory rồi chọn chụp bài và bình luận.' : run?.status === 'RUNNING' ? 'Đang đọc nội dung và lưu ảnh gốc…' : 'Đã xếp hàng lưu ảnh chụp…'} Có thể tải lại trang để tiếp tục.<button className="text-button" disabled={busy || disabled} onClick={() => { setBusy(true); if (pending) window.postMessage({ source: 'shorts-factory', type: 'CANCEL_CAPTURE', requestId: pending.requestId, jobId: pending.id }, window.location.origin); void api(`/source-captures/${id}/cancel`, queuedSchema, { method: 'POST', body: {}, idempotencyKey: `capture-cancel:${id}` }).then(() => { setTransfer(''); setRevision(value => value + 1); }).catch(failure => setError(errorMessage(failure))).finally(() => setBusy(false)); }}>Hủy chụp</button></p>}
    {run?.status === 'FAILED' && <div role="alert" className="notice error">Chụp chưa thành công: {run.errorCode}. Kiểm tra cửa sổ đăng nhập và mở đúng bài rồi thử lại.</div>}
    <details><summary>Tùy chọn: dùng cửa sổ chụp riêng</summary><p>Dùng khi không cài extension. Cửa sổ này có phiên đăng nhập riêng; không dùng phiên Chrome/Edge hiện tại.</p><div className="phase5-actions"><button className="button secondary" disabled={disabled || busy || running || !url} onClick={() => void openDedicated()}>Mở cửa sổ chụp riêng</button><button className="button secondary" disabled={disabled || busy || running || !dedicatedOpened || !channelId} onClick={() => void capture('DEDICATED')}>Đã đăng nhập · Chụp bằng cửa sổ riêng</button></div></details>
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
  return <div className="source-image-preview"><h3>Ảnh giao diện gốc · {anonymized ? 'Đã che tên/avatar' : 'Nguyên bản'}</h3><p className="field-help">Giữ nguyên nội dung và số react trên ảnh. Bản che tên/avatar không che tên xuất hiện trong nội dung bài/bình luận; hãy kiểm tra từng ảnh.</p>{missing.length > 0 && <p role="alert" className="notice warning">Thiếu {missing.length} ảnh ở chế độ này. Video sẽ bị chặn nếu chọn nguồn thiếu ảnh.</p>}<div className="source-image-grid">{selected.map(image => <a key={image.id} href={`/api/v1/media/${image.id}`} target="_blank" rel="noreferrer"><img src={`/api/v1/media/${image.id}`} alt={image.metadata.sourceRef.startsWith('post:') ? 'Ảnh chụp bài gốc' : 'Ảnh chụp bình luận gốc'} loading="lazy" /></a>)}</div></div>;
}
