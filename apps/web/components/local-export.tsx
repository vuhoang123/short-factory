'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ApiError, api, errorMessage } from '../lib/api';
import { candidateSchema, channelSchema, commentSchema, mayAdmin, mayEdit, mayReview, paginated, postSchema } from '../lib/contracts';
import { createLocalImport, exportProgressSchema, getOperationKey, localExportBlockers, type ExportProgress } from '../lib/local-export';
import { useSession } from './app-shell';
import { EmptyState, ErrorNotice } from './feedback';

const channelsSchema = paginated(channelSchema);
const commentsSchema = paginated(commentSchema.extend({ sensitiveFlags: z.array(z.string()).optional() }));
const candidatesSchema = paginated(candidateSchema);
const profilesSchema = z.object({ items: z.array(z.object({
  id: z.string(), name: z.string(), provider: z.enum(['local', 'openai', 'mock']), language: z.string(), requiresCredentials: z.boolean(),
})) });
const importResultSchema = z.object({ postId: z.string().uuid(), deduplicated: z.boolean(), warnings: z.array(z.string()) });
const rightsResultSchema = z.object({ postId: z.string(), reviewStatus: z.string() });
const candidateResultSchema = z.object({ id: z.string(), status: z.string() });
const produceResultSchema = z.object({ runId: z.string().uuid(), storyProjectId: z.string().uuid(), status: z.string() });
const retryResultSchema = z.object({ runId: z.string(), status: z.string() });
const cancelResultSchema = z.object({ runId: z.string().uuid(), status: z.literal('CANCELLED') });
const runSettingsSchema = z.object({ channelId: z.string().uuid(), voiceProfileId: z.string(), targetDurationSec: z.number().int().min(10).max(120), commentIds: z.array(z.string().uuid()).max(8) });
const runSchema = z.object({
  id: z.string(), status: z.string(), attempts: z.number().int().nonnegative(), currentStage: z.string().nullable(), errorCode: z.string().nullable(),
  stages: z.array(z.object({ name: z.string(), status: z.string(), errorCode: z.string().nullable() })),
  renderJob: z.object({ progress: z.number() }).nullable(),
  videos: z.array(z.object({ id: z.string().uuid(), mediaAsset: z.object({ id: z.string() }).nullable() })),
  input: runSettingsSchema.optional(), sourcePostId: z.string().uuid().optional(), channelId: z.string().uuid().nullable().optional(),
});
const runSummarySchema = z.object({
  id: z.string().uuid(), storyProjectId: z.string().uuid(), sourcePostId: z.string().uuid(), channelId: z.string().uuid().nullable(), title: z.string().nullable(),
  status: z.string(), currentStage: z.string().nullable(), attempts: z.number().int().nonnegative(), errorCode: z.string().nullable(),
  createdAt: z.string(), startedAt: z.string().nullable(), completedAt: z.string().nullable(),
  renderJob: z.object({ progress: z.number(), status: z.string() }).nullable(),
  videos: z.array(z.object({ id: z.string().uuid(), reviewStatus: z.string(), mediaAsset: z.object({ id: z.string(), mimeType: z.string() }).nullable() })),
});
const runHistorySchema = z.object({ items: z.array(runSummarySchema), nextCursor: z.string().uuid().nullable() });
type RunSummary = z.infer<typeof runSummarySchema>;
const cancellableStatuses = new Set(['QUEUED', 'RUNNING', 'FAILED_RETRYABLE']);
function runErrorExplanation(code: string | null, status: string) {
  if (status === 'CANCELLED') return 'Lượt tạo đã bị hủy; không tự chạy lại.';
  if (code === 'MEDIA_RENDER_TIMEOUT') return 'Render vượt thời gian cho phép. Người quản trị có thể thử lại sau khi kiểm tra tài nguyên.';
  if (code === 'WORKER_LEASE_LOST') return 'Worker mất quyền xử lý. Hệ thống sẽ phục hồi từ trạng thái đã lưu khi phù hợp.';
  return code ? `Mã lỗi: ${code}` : null;
}

function RenderHistory({ revision, onOpen, busy }: { revision: number; onOpen: (run: RunSummary) => void; busy: boolean }) {
  const [history, setHistory] = useState<z.infer<typeof runHistorySchema> | null>(null);
  const [status, setStatus] = useState('');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setLoading(true); setError('');
    const load = async () => {
      try {
        const query = new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}), ...(status ? { status } : {}) });
        const result = await api(`/production-runs?${query}`, runHistorySchema, { signal: controller.signal });
        if (!active) return;
        setHistory(result); setLoading(false);
        if (result.items.some((item) => item.status === 'QUEUED' || item.status === 'RUNNING')) timer = setTimeout(() => { void load(); }, 4000);
      } catch (failure) { if (active) { setError(describeError(failure)); setLoading(false); } }
    };
    void load();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [cursor, status, refresh, revision]);
  return <section className="panel form-panel studio-video-list"><div className="panel-heading"><div><h2>Lịch sử tạo video</h2><p>Các lượt đã lưu trong workspace, kể cả khi mở tab hoặc phiên trình duyệt mới.</p></div><button className="text-button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>Làm mới lịch sử</button></div>
    <label htmlFor="export-run-status">Trạng thái lượt tạo</label><select id="export-run-status" value={status} onChange={(event) => { setStatus(event.target.value); setCursors([undefined]); }}><option value="">Tất cả trạng thái</option>{['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'CANCELLED', 'BLOCKED_RIGHTS', 'BLOCKED_EXTERNAL'].map((value) => <option key={value} value={value}>{value}</option>)}</select>
    {loading && <p role="status" className="loading-state">Đang tải lịch sử…</p>}
    {error && <ErrorNotice message={error} retry={() => setRefresh((value) => value + 1)} />}
    {!loading && !error && (history?.items.length ? <div className="table-scroll"><table><caption className="sr-only">Lịch sử render của workspace hiện tại</caption><thead><tr><th>Bài / ngày tạo</th><th>Trạng thái</th><th>Tiến độ / lỗi</th><th>Thao tác</th></tr></thead><tbody>{history.items.map((item) => <tr key={item.id}><td>{item.title || 'Bài không có tiêu đề'}<br /><time className="field-help" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('vi-VN')}</time><br /><span className="field-help">Lần xử lý: {item.attempts}</span></td><td><span className="badge neutral">{item.status}</span></td><td>{Math.round(Math.max(0, Math.min(1, item.renderJob?.progress ?? 0)) * 100)}%<br />{item.currentStage?.replaceAll('_', ' ')}{runErrorExplanation(item.errorCode, item.status) && <p className="field-help">{runErrorExplanation(item.errorCode, item.status)}</p>}</td><td><button className="text-button" onClick={() => onOpen(item)} disabled={busy || loading}>Mở lượt tạo</button></td></tr>)}</tbody></table></div> : <EmptyState title="Chưa có lượt tạo phù hợp">Nhập bài mới hoặc chọn trạng thái khác để xem các lượt đã lưu.</EmptyState>)}
    <div className="phase5-actions"><button className="button secondary small" disabled={loading || cursors.length < 2} onClick={() => setCursors((values) => values.slice(0, -1))}>Lượt mới hơn</button><button className="button secondary small" disabled={loading || !history?.nextCursor} onClick={() => { if (history?.nextCursor) setCursors((values) => [...values, history.nextCursor ?? undefined]); }}>Lượt cũ hơn</button></div>
  </section>;
}
const videoSchema = z.object({
  id: z.string(), title: z.string(), status: z.string(), reviewStatus: z.string(), durationMs: z.number().nullable(),
  mediaAsset: z.object({ id: z.string(), mimeType: z.string() }).nullable(),
});
const videoReviewSchema = z.object({ videoId: z.string(), status: z.string(), reviewStatus: z.string() });

function describeError(failure: unknown) {
  if (failure instanceof z.ZodError) return failure.issues[0]?.message ?? 'Kiểm tra lại dữ liệu đã nhập.';
  return failure instanceof ApiError ? errorMessage(failure) : 'Không kết nối được API. Kiểm tra dịch vụ local rồi thử lại.';
}

export function LocalExport() {
  const { session, role } = useSession();
  const canEdit = mayEdit(role);
  const canReview = mayReview(role);
  const storageKey = `shorts-factory:local-export:${session.user.id}:${session.activeWorkspaceId}`;
  const progressRef = useRef<ExportProgress>({ keys: {} });
  const [progress, setProgress] = useState<ExportProgress>({ keys: {} });
  const [restored, setRestored] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [channels, setChannels] = useState<z.infer<typeof channelsSchema>['items']>([]);
  const [profiles, setProfiles] = useState<z.infer<typeof profilesSchema>['items']>([]);
  const [loading, setLoading] = useState(true);
  const [configRevision, setConfigRevision] = useState(0);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [runRevision, setRunRevision] = useState(0);
  const [videoRevision, setVideoRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [confirmCancellation, setConfirmCancellation] = useState(false);
  const [post, setPost] = useState<z.infer<typeof postSchema> | null>(null);
  const [comments, setComments] = useState<z.infer<typeof commentsSchema>['items']>([]);
  const [candidate, setCandidate] = useState<z.infer<typeof candidateSchema> | null>(null);
  const [run, setRun] = useState<z.infer<typeof runSchema> | null>(null);
  const [video, setVideo] = useState<z.infer<typeof videoSchema> | null>(null);
  const [waitingTooLong, setWaitingTooLong] = useState(false);
  const [reviewedSource, setReviewedSource] = useState(false);
  const [reviewedVideo, setReviewedVideo] = useState(false);
  const [basis, setBasis] = useState('');
  const [attributionRequired, setAttributionRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const saveProgress = useCallback((patch: Partial<ExportProgress>) => {
    const next = { ...progressRef.current, ...patch };
    progressRef.current = next;
    setProgress(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { setStorageUnavailable(true); }
  }, [storageKey]);

  useEffect(() => {
    let restoredProgress: ExportProgress = { keys: {} };
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = exportProgressSchema.safeParse(JSON.parse(stored));
        if (parsed.success) restoredProgress = parsed.data;
      }
    } catch { setStorageUnavailable(true); }
    progressRef.current = restoredProgress;
    setProgress(restoredProgress); setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([api('/channels?limit=100', channelsSchema, { signal: controller.signal }), api('/voice-profiles', profilesSchema, { signal: controller.signal })])
      .then(([channelData, profileData]) => { if (active) { setChannels(channelData.items); setProfiles(profileData.items.filter((profile) => !profile.requiresCredentials && profile.provider !== 'openai')); } })
      .catch((failure: unknown) => { if (active) setError(describeError(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [configRevision]);

  useEffect(() => {
    if (!restored || !progress.postId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const controller = new AbortController();
    const postId = progress.postId;
    setWaitingTooLong(false);
    const load = async () => {
      try {
        const [savedPost, savedComments, candidates] = await Promise.all([
          api(`/posts/${postId}`, postSchema, { signal: controller.signal }), api(`/posts/${postId}/comments?limit=100`, commentsSchema, { signal: controller.signal }),
          api(`/candidates?sourcePostId=${encodeURIComponent(postId)}&limit=1`, candidatesSchema, { signal: controller.signal }),
        ]);
        if (!active) return;
        setPost(savedPost); setComments(savedComments.items);
        const nextCandidate = candidates.items.find((item) => item.post.id === postId) ?? null;
        setCandidate(nextCandidate);
        if (progressRef.current.commentIds === undefined) saveProgress({ commentIds: savedComments.items.slice(0, 8).map((comment) => comment.id) });
        if (!nextCandidate && ++polls < 30) timer = setTimeout(() => { void load(); }, 2000);
        else if (!nextCandidate) setWaitingTooLong(true);
      } catch (failure) { if (active) setError(describeError(failure)); }
    };
    void load();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [restored, progress.postId, sourceRevision, saveProgress]);

  useEffect(() => {
    if (!restored || !progress.runId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const next = await api(`/production-runs/${progress.runId}`, runSchema, { signal: controller.signal });
        if (!active) return;
        setRun(next);
        if (next.input) {
          const settings = next.input;
          const current = progressRef.current;
          if (current.channelId !== settings.channelId || current.voiceProfileId !== settings.voiceProfileId || current.duration !== settings.targetDurationSec || JSON.stringify(current.commentIds) !== JSON.stringify(settings.commentIds)) {
            saveProgress({ channelId: settings.channelId, voiceProfileId: settings.voiceProfileId, duration: settings.targetDurationSec, commentIds: settings.commentIds });
          }
        }
        const output = next.videos.find((item) => item.mediaAsset);
        if (output && progressRef.current.videoId !== output.id) saveProgress({ videoId: output.id });
        if (!['SUCCEEDED', 'CANCELLED'].includes(next.status) && !next.status.startsWith('FAILED') && !next.status.startsWith('BLOCKED')) timer = setTimeout(() => { void poll(); }, 1600);
      } catch (failure) { if (active) setError(describeError(failure)); }
    };
    void poll();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [restored, progress.runId, runRevision, saveProgress]);

  useEffect(() => {
    if (!restored || !progress.videoId) return;
    let active = true;
    const controller = new AbortController();
    void api(`/videos/${progress.videoId}`, videoSchema, { signal: controller.signal }).then((value) => { if (active) setVideo(value); }).catch((failure: unknown) => { if (active) setError(describeError(failure)); });
    return () => { active = false; controller.abort(); };
  }, [restored, progress.videoId, run?.status, videoRevision]);

  const channelId = progress.channelId ?? channels[0]?.id ?? '';
  const channel = channels.find((item) => item.id === channelId);
  const compatibleVoices = profiles.filter((profile) => profile.language === 'multilingual' || profile.language.toLowerCase() === channel?.language.slice(0, 2).toLowerCase());
  const voice = compatibleVoices.find((item) => item.id === progress.voiceProfileId) ?? compatibleVoices[0];
  const right = post?.rights[0];
  const sourceUnsafe = Boolean(post?.sensitiveFlags?.length || comments.some((comment) => comment.sensitiveFlags?.length));
  const candidateEligible = Boolean(candidate && candidate.score !== null && candidate.score >= candidate.minimumScore && !['REJECTED', 'BLOCKED_SAFETY', 'BLOCKED_RIGHTS', 'BELOW_THRESHOLD', 'DUPLICATE'].includes(candidate.status));
  const productionBlockers = localExportBlockers({ canEdit, reviewedSource, hasVoice: Boolean(voice), hasChannel: Boolean(channel), sourceUnsafe, rightsStatus: right?.reviewStatus, candidate });

  async function mutate<T extends z.ZodTypeAny>(operation: string, path: string, schema: T, body: unknown) {
    const idempotencyKey = await getOperationKey(progressRef.current.keys, operation, { path, body });
    saveProgress({ keys: { ...progressRef.current.keys } });
    return api(path, schema, { method: 'POST', body, idempotencyKey });
  }

  async function action(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (failure) { setError(describeError(failure)); } finally { setBusy(false); }
  }

  async function importPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action(async () => {
      const input = createLocalImport({
        canonicalUrl: String(form.get('canonicalUrl') ?? ''), title: String(form.get('title') ?? ''), body: String(form.get('body') ?? ''), comments: String(form.get('comments') ?? ''), channelId,
        basis: String(form.get('basis')), evidence: String(form.get('evidence') ?? ''), territory: String(form.get('territory') ?? ''),
        allowedPlatforms: form.getAll('platforms').map(String), commercialAllowed: form.has('commercialAllowed'),
        attributionRequired: form.has('attributionRequired'), attributionText: String(form.get('attributionText') ?? ''), attested: form.has('attested'),
      });
      const result = await mutate('import', '/imports/manual', importResultSchema, input);
      saveProgress({ postId: result.postId, channelId, commentIds: undefined });
      setReviewedSource(false);
      setNotice(result.deduplicated ? 'Bài đã tồn tại. Nội dung, bình luận và quyền cũ được giữ nguyên. Hãy đọc bản lưu bên dưới trước khi duyệt; dữ liệu bạn vừa dán không ghi đè bản cũ.' : 'Đã lưu bài và bình luận. Hãy đọc bản lưu, duyệt quyền rồi chọn bài để tạo video.');
    });
  }

  async function approveRights() {
    if (!post || !reviewedSource) return;
    await action(async () => {
      await mutate(`rights:${post.id}`, `/posts/${post.id}/rights/review`, rightsResultSchema, { decision: 'APPROVED' });
      setNotice('Đã duyệt quyền của bản nội dung đang hiển thị. Tiếp theo xác nhận chọn bài để tạo video.');
      setSourceRevision((value) => value + 1);
    });
  }

  async function approveCandidate() {
    if (!candidate || !reviewedSource || !candidateEligible) return;
    await action(async () => {
      await mutate(`candidate:${candidate.id}`, `/candidates/${candidate.id}/review`, candidateResultSchema, { decision: 'APPROVED' });
      setNotice('Đã chọn bài sau khi duyệt quyền và nội dung. Bạn có thể tạo video local.');
      setSourceRevision((value) => value + 1);
    });
  }

  async function produce() {
    if (!candidate || !voice || !channel || !reviewedSource) return;
    await action(async () => {
      const result = await mutate(`produce:${candidate.id}`, `/candidates/${candidate.id}/produce`, produceResultSchema, {
        channelId: channel.id, commentIds: progressRef.current.commentIds ?? [], voiceProfileId: voice.id, language: channel.language,
        targetDurationSec: progress.duration ?? 40, templateId: 'SocialCommentary',
      });
      saveProgress({ runId: result.runId, voiceProfileId: voice.id });
      setHistoryRevision((value) => value + 1);
      setNotice('Đã xếp hàng tạo video. Giữ dịch vụ discovery/media local hoạt động; tải lại trang vẫn theo dõi được lượt này.');
    });
  }

  async function retryRun() {
    if (!run || !progress.runId) return;
    await action(async () => {
      await mutate(`retry:${run.id}:${run.attempts}`, `/production-runs/${run.id}/retry`, retryResultSchema, {});
      setRunRevision((value) => value + 1);
      setHistoryRevision((value) => value + 1);
    });
  }

  async function cancelRun() {
    if (!run || !canEdit || !confirmCancellation || !cancellableStatuses.has(run.status)) return;
    await action(async () => {
      await mutate(`cancel:${run.id}`, `/production-runs/${run.id}/cancel`, cancelResultSchema, {});
      setConfirmCancellation(false); setRunRevision((value) => value + 1); setHistoryRevision((value) => value + 1);
      setNotice('Đã hủy lượt tạo. Worker sẽ dừng xử lý và không tạo thêm video từ lượt này.');
    });
  }

  function openHistory(item: RunSummary) {
    if (busy) return;
    setPost(null); setComments([]); setCandidate(null); setRun(null); setVideo(null);
    setReviewedSource(false); setReviewedVideo(false); setConfirmCancellation(false); setError('');
    saveProgress({ postId: item.sourcePostId, channelId: item.channelId ?? undefined, runId: item.id,
      videoId: item.videos.find((output) => output.mediaAsset)?.id, voiceProfileId: undefined, duration: undefined, commentIds: undefined });
    setSourceRevision((value) => value + 1); setRunRevision((value) => value + 1); setVideoRevision((value) => value + 1);
    setNotice('Đã mở lượt tạo đã lưu. Xem tiến độ hoặc video bên dưới; thao tác này không tạo lượt mới và không tự duyệt quyền.');
  }

  async function approveVideo() {
    if (!video || !reviewedVideo) return;
    await action(async () => {
      await mutate(`video-review:${video.id}`, `/videos/${video.id}/reviews`, videoReviewSchema, { decision: 'APPROVED' });
      setVideoRevision((value) => value + 1); setNotice('Đã duyệt video. Tải MP4 về máy; không có thao tác đăng mạng xã hội.');
    });
  }

  function newExport() {
    progressRef.current = { keys: {} }; setProgress({ keys: {} });
    try { sessionStorage.removeItem(storageKey); } catch { setStorageUnavailable(true); }
    setPost(null); setCandidate(null); setComments([]); setRun(null); setVideo(null);
    setReviewedSource(false); setReviewedVideo(false); setNotice(''); setError(''); setWaitingTooLong(false);
    setConfirmCancellation(false);
  }

  const runPanel = progress.runId && <div className="studio-run-content"><p className="field-help">Mã lượt tạo: {progress.runId}</p>{run ? <><div className="studio-run-status"><span className={`badge ${run.status === 'SUCCEEDED' ? 'positive' : run.status.startsWith('FAILED') || run.status.startsWith('BLOCKED') ? 'negative' : 'neutral'}`}>{run.status}</span><span>{run.currentStage?.replaceAll('_', ' ') ?? 'Đang chờ worker'}</span></div><progress max={1} value={run.renderJob?.progress ?? 0} aria-label="Tiến độ tạo video" /><ol className="stage-list">{run.stages.map((stage) => <li key={stage.name} className={stage.status === 'SUCCEEDED' ? 'done' : stage.status === 'RUNNING' ? 'active' : ''}><span>{stage.name.replaceAll('_', ' ')}</span><span>{stage.status}</span></li>)}</ol>{runErrorExplanation(run.errorCode, run.status) && <div className="notice error">{runErrorExplanation(run.errorCode, run.status)}</div>}{mayAdmin(role) && run.status.startsWith('FAILED') && <button className="button secondary small" onClick={() => void retryRun()} disabled={busy}>Thử lại lượt tạo lỗi</button>}{canEdit && cancellableStatuses.has(run.status) && (confirmCancellation ? <div className="notice warning"><p>Hủy lượt này sẽ dừng xử lý. Video đang làm dở sẽ không được hoàn tất từ lượt này.</p><div className="phase5-actions"><button className="button secondary small" onClick={() => void cancelRun()} disabled={busy}>Xác nhận hủy</button><button className="text-button" onClick={() => setConfirmCancellation(false)} disabled={busy}>Giữ lượt tạo</button></div></div> : <button className="button secondary small" onClick={() => setConfirmCancellation(true)} disabled={busy}>Hủy lượt tạo</button>)}</> : <p role="status">Đang tải lượt tạo…</p>}<button className="text-button" onClick={() => setRunRevision((value) => value + 1)}>Tải lại tiến độ</button></div>;

  return <>
    <div className="page-heading"><div><span className="eyebrow">LOCAL · FACEBOOK / THREADS</span><h1>Xuất video về máy</h1><p>Dán link nguồn, thêm nội dung được phép sử dụng, duyệt rồi tải video MP4.</p></div>{progress.postId && <button className="button secondary small" onClick={newExport} disabled={busy}>Bắt đầu bài khác</button>}</div>
    <div className="notice"><span>Link chỉ dùng để lưu nguồn tham chiếu. Bản local chưa tự lấy nội dung Facebook/Threads; bạn cần dán bài và bình luận. Video được tạo bằng nội dung đã cung cấp, không đăng lên mạng xã hội.</span></div>
    {error && <ErrorNotice message={error} retry={() => { setError(''); setConfigRevision((value) => value + 1); setSourceRevision((value) => value + 1); setRunRevision((value) => value + 1); setVideoRevision((value) => value + 1); }} />}
    {notice && <div className="notice success" role="status">{notice}</div>}
    {storageUnavailable && <div className="notice warning">Không đọc hoặc lưu được tiến độ phiên trong trình duyệt. Giữ trang đang mở, ghi lại mã lượt tạo để người quản trị kiểm tra; video hoàn thành vẫn có trong Studio.</div>}
    {(!canEdit || !canReview) && <div className="notice warning">Vai trò hiện tại: {role}. Editor có thể nhập/tạo video; Reviewer có thể duyệt. OWNER hoặc ADMIN có thể thực hiện toàn bộ luồng. Các bước thiếu quyền cần người có vai trò phù hợp xử lý trong Library/Studio.</div>}
    <RenderHistory revision={historyRevision} onOpen={openHistory} busy={busy} />
    {loading || !restored ? <p className="loading-state" role="status">Đang tải cấu hình local…</p> : !channels.length ? <section className="panel form-panel"><EmptyState title="Chưa có kênh nội dung">Tạo một kênh với ngôn ngữ và ngưỡng chọn bài phù hợp trước khi nhập.</EmptyState><Link className="button" href="/channels">Tạo kênh nội dung</Link></section> : <>
      {!progress.postId && <section className="panel form-panel studio-setup"><h2>1. Nhập bài và quyền sử dụng</h2><p className="muted">Không cần JSON. Mỗi dòng bình luận là một bình luận riêng, tối đa 8.</p>
        <form className="form-stack" onSubmit={importPost}>
          <label>Link bài Facebook/Threads<input name="canonicalUrl" type="url" required maxLength={2048} placeholder="https://www.threads.com/@.../post/..." /></label>
          <label>Tiêu đề<input name="title" maxLength={300} /></label>
          <label>Nội dung bài<textarea name="body" required maxLength={50_000} rows={6} /></label>
          <label>Bình luận được phép sử dụng<textarea name="comments" maxLength={80_008} rows={4} placeholder="Mỗi dòng một bình luận; có thể để trống." /></label>
          <label>Kênh nội dung<select value={channelId} onChange={(event) => saveProgress({ channelId: event.target.value })}>{channels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.language} · ngưỡng {item.minimumCandidateScore ?? 55}</option>)}</select></label>
          <p className="field-help">Bài vẫn phải đạt ngưỡng và kiểm tra an toàn của kênh. Chọn ngưỡng phù hợp tại <Link className="text-button" href="/channels">Kênh nội dung</Link> trước khi nhập.</p>
          <div className="studio-form-row"><label>Cơ sở quyền sử dụng<select name="basis" value={basis} onChange={(event) => setBasis(event.target.value)} required><option value="">Chọn cơ sở quyền</option><option value="OWNED">Tôi sở hữu bài và bình luận</option><option value="LICENSED">Có giấy phép</option><option value="CONSENTED">Được chủ nội dung đồng ý</option></select></label><label>Phạm vi lãnh thổ<input name="territory" required maxLength={100} placeholder="Ví dụ: VN hoặc Worldwide theo giấy phép" /></label></div>
          <label>Bằng chứng giấy phép hoặc đồng ý<input name="evidence" maxLength={4000} required={Boolean(basis && basis !== 'OWNED')} placeholder="Mã hợp đồng hoặc tham chiếu chứng cứ; không nhập secret." /></label>
          <fieldset className="phase5-fieldset"><legend>Nền tảng được giấy phép cho phép tái sử dụng</legend><p className="field-help">Chọn đúng phạm vi quyền. Đây không phải thao tác đăng bài.</p>{['FACEBOOK', 'YOUTUBE', 'TIKTOK'].map((platform) => <label key={platform} className="checkbox-label"><input type="checkbox" name="platforms" value={platform} /><span>{platform}</span></label>)}</fieldset>
          <label className="checkbox-label"><input type="checkbox" name="attributionRequired" checked={attributionRequired} onChange={(event) => setAttributionRequired(event.target.checked)} /><span>Giấy phép yêu cầu ghi công tác giả</span></label>
          <label>Nội dung ghi công<input name="attributionText" maxLength={2000} required={attributionRequired} /></label>
          <label className="checkbox-label"><input type="checkbox" name="commercialAllowed" required /><span>Quyền sử dụng cho phép tạo video và sử dụng thương mại theo chính sách hiện tại của dự án.</span></label>
          <label className="checkbox-label"><input type="checkbox" name="attested" required /><span>Tôi có thẩm quyền nhập và tái sử dụng bài cùng các bình luận đã dán; đã kiểm tra thông tin cá nhân.</span></label>
          <button className="button" disabled={busy || !canEdit}>{busy ? 'Đang lưu…' : 'Lưu bài để kiểm tra'}</button>
        </form>
      </section>}
      {progress.postId && !post && <p className="loading-state" role="status">Đang tải bản nội dung đã lưu…</p>}
      {progress.runId && !post && <section className="panel form-panel"><h2>Theo dõi lượt đã lưu</h2>{runPanel}</section>}
      {post && <div className="studio-grid">
        <section className="panel form-panel studio-setup"><h2>2. Kiểm tra bản lưu và duyệt</h2><p className="muted">Đây là dữ liệu thực trong workspace, kể cả khi bài đã được nhập trước đó. Duyệt dựa trên bản này.</p>
          <a className="text-button" href={post.canonicalUrl} target="_blank" rel="noreferrer">Mở link nguồn ↗</a>
          <div className="studio-source"><strong>{post.title || 'Bài nguồn'}</strong><p>{post.body}</p></div>
          <div className="phase5-definition-list"><div><dt>Quyền</dt><dd>{right?.basis ?? 'UNKNOWN'} · {right?.reviewStatus ?? 'PENDING'}</dd></div><div><dt>Lãnh thổ / nền tảng</dt><dd>{right?.territory ?? '—'} / {right?.allowedPlatforms.join(', ') || '—'}</dd></div><div><dt>Bằng chứng</dt><dd>{right?.evidence || 'Không có'}</dd></div>{right?.attributionRequired && <div><dt>Ghi công</dt><dd>{right.attributionText || 'Thiếu nội dung ghi công'}</dd></div>}</div>
          <h3 className="studio-label">Bình luận trong video</h3><div className="studio-comments">{comments.length ? comments.map((comment) => <label className="checkbox-label studio-comment" key={comment.id}><input type="checkbox" disabled={Boolean(progress.runId)} checked={progress.commentIds?.includes(comment.id) ?? false} onChange={(event) => saveProgress({ commentIds: event.target.checked ? [...(progress.commentIds ?? []), comment.id].slice(0, 8) : (progress.commentIds ?? []).filter((id) => id !== comment.id) })} /><span>{comment.body}{Boolean(comment.sensitiveFlags?.length) && ' · Cần xử lý dữ liệu nhạy cảm'}</span></label>) : <p className="field-help">Bài không có bình luận.</p>}</div>
          {sourceUnsafe && <div className="notice error">Nguồn có cờ dữ liệu nhạy cảm. Luồng tạo video bị chặn; xử lý nội dung và quyền tại Library trước.</div>}
          <label className="checkbox-label"><input type="checkbox" checked={reviewedSource} onChange={(event) => setReviewedSource(event.target.checked)} /><span>Tôi đã đọc bản lưu, bình luận, bằng chứng và phạm vi quyền ở trên; xác nhận đủ quyền dùng chúng trong video.</span></label>
          <div className="phase5-actions">{right?.reviewStatus === 'PENDING' && <button className="button secondary" onClick={() => void approveRights()} disabled={busy || !canReview || !reviewedSource || sourceUnsafe}>Duyệt quyền bản lưu</button>}{candidate && candidate.status !== 'APPROVED' && <button className="button" onClick={() => void approveCandidate()} disabled={busy || !canReview || !reviewedSource || right?.reviewStatus !== 'APPROVED' || !candidateEligible || sourceUnsafe}>Xác nhận chọn bài</button>}</div>
          {candidate ? <p className="field-help">Trạng thái: {candidate.status} · Điểm: {candidate.score ?? '—'}/{candidate.minimumScore} tối thiểu.{candidate.status === 'BELOW_THRESHOLD' && ' Bài dưới ngưỡng của kênh; không thể bỏ qua bước này.'}</p> : <p className="field-help" role="status">{waitingTooLong ? 'Chưa nhận được kết quả chấm điểm. Kiểm tra discovery worker, Redis và outbox local rồi tải lại trạng thái.' : 'Đang chờ discovery worker chấm điểm nội dung…'}</p>}
          <button className="text-button" onClick={() => setSourceRevision((value) => value + 1)} disabled={busy}>Tải lại trạng thái bài</button><Link className="text-button" href="/library/posts">Mở thư viện bài</Link>
        </section>
        <section className="studio-right-column"><section className="panel form-panel"><h2>3. Tạo video local</h2><p className="muted">Kênh: {channel?.name ?? 'Kênh không còn khả dụng'} · {channel?.language}. Nền và template có sẵn; không cần upload ảnh.</p>
          <div className="form-stack"><label>Giọng đọc local<select value={voice?.id ?? ''} disabled={Boolean(progress.runId)} onChange={(event) => saveProgress({ voiceProfileId: event.target.value })}>{!compatibleVoices.length && <option value="">Chưa có giọng đúng ngôn ngữ</option>}{compatibleVoices.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.provider === 'mock' ? ' · âm thử, không phải lời đọc' : ''}</option>)}</select></label>
            {!compatibleVoices.length && <p className="field-help">Cần TTS_PROVIDER=local và giọng hỗ trợ {channel?.language}. Windows hiện có thể chỉ có giọng tiếng Anh; bản Docker Linux có eSpeak tiếng Việt. Không tự chọn giọng sai ngôn ngữ.</p>}
            {voice?.provider === 'mock' && <div className="notice warning">Giọng mock chỉ tạo âm thử. Dùng cấu hình local speech để có lời đọc thực tế.</div>}
            <label>Độ dài mục tiêu<select value={progress.duration ?? 40} disabled={Boolean(progress.runId)} onChange={(event) => saveProgress({ duration: Number(event.target.value) })}><option value={25}>25 giây</option><option value={40}>40 giây</option><option value={60}>60 giây</option></select></label>
            {!progress.runId && <><button className="button" onClick={() => void produce()} aria-describedby={productionBlockers.length ? 'export-production-blockers' : undefined} disabled={busy || productionBlockers.length > 0}>Tạo video MP4</button>{productionBlockers.length > 0 && <div id="export-production-blockers" className="notice warning"><strong>Chưa thể tạo video:</strong><ul>{productionBlockers.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}</>}
          </div>
          {runPanel}
        </section></section>
      </div>}
      {video?.mediaAsset && <section className="panel form-panel studio-setup studio-preview"><h2>4. Xem và tải video</h2><p className="muted">{video.title} · {video.durationMs ? `${Math.round(video.durationMs / 1000)} giây` : ''} · {video.reviewStatus}</p>
        <video className="studio-html-video" controls playsInline preload="metadata" src={`/api/v1/media/${video.mediaAsset.id}`} aria-label="Video local đã tạo" />
        {video.reviewStatus === 'PENDING' && <><label className="checkbox-label"><input type="checkbox" checked={reviewedVideo} onChange={(event) => setReviewedVideo(event.target.checked)} /><span>Tôi đã xem video, kiểm tra lời đọc, phụ đề và quyền sử dụng.</span></label><button className="button" onClick={() => void approveVideo()} disabled={busy || !canReview || !reviewedVideo}>Duyệt video</button></>}
        <div className="phase5-actions"><a className="button" href={`/api/v1/media/${video.mediaAsset.id}?download=1`}>Tải MP4 về máy</a><Link className="button secondary" href="/studio">Mở Studio để chỉnh script</Link></div><p className="field-help">Có thể tải bản nháp để xem offline; tải về không đồng nghĩa đã duyệt hoặc được phép đăng. Không có tác vụ publishing được tạo từ màn hình này.</p>
      </section>}
    </>}
  </>;
}
