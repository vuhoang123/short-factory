'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Player } from '@remotion/player';
import { StoryComposition } from '@shorts-factory/media/composition';
import { renderManifestSchema, storyScriptSchema } from '@shorts-factory/media/contracts';
import { z } from 'zod';
import { api, errorMessage } from '../lib/api';
import { useResource } from '../lib/use-resource';
import { candidateSchema, channelSchema, mayAdmin, mayEdit, mayReview, paginated, unknownResponseSchema } from '../lib/contracts';
import { useSession } from './app-shell';
import { EmptyState, ErrorNotice } from './feedback';
import { getOperationKey, type OperationKeys } from '../lib/local-export';
import { humanStage, mediaFailureMessage, studioLink, type StudioItem } from '../lib/studio';
import { CommentPicker } from './comment-picker';
import { VoiceLibrary } from './voice-library';
import { commentPlanSchema, type CommentMode } from '../lib/comment-selection';
import { SourceImagePreview } from './source-capture';

const candidatesSchema = paginated(candidateSchema);
const channelsSchema = paginated(channelSchema);
const profilesSchema = z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), provider: z.enum(['local', 'vieneu', 'openai', 'mock']), language: z.string(), voiceId: z.string(), requiresCredentials: z.boolean() })) });
const templatesSchema = z.object({ items: z.array(z.object({ id: z.enum(['RedditStory', 'SocialCommentary']), version: z.number(), name: z.string(), description: z.string(), status: z.string() })) });
const backgroundsSchema = z.object({ items: z.array(z.object({ id: z.string(), mimeType: z.string(), metadata: z.unknown(), rights: z.unknown(), createdAt: z.string(), url: z.string() })) });
const videosSchema = z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), reviewStatus: z.string(), createdAt: z.string(), durationMs: z.number().nullable(), mediaAssetId: z.string().nullable() })) });
const runSchema = z.object({ id: z.string(), storyProjectId: z.string(), status: z.string(), currentStage: z.string().nullable(), errorCode: z.string().nullable(), stages: z.array(z.object({ name: z.string(), status: z.string(), errorCode: z.string().nullable(), output: z.unknown().optional() })), renderJob: z.object({ progress: z.number() }).nullable(), videos: z.array(z.object({ id: z.string(), status: z.string(), mediaAsset: z.object({ id: z.string() }).nullable() })) });
const storySchema = z.object({ id: z.string(), channel: z.object({ id: z.string(), name: z.string(), language: z.string() }).nullable(), post: z.object({ id: z.string(), platform: z.string(), title: z.string().nullable(), body: z.string(), authorAlias: z.string().nullable(), comments: z.array(z.object({ id: z.string(), externalId: z.string(), body: z.string(), likes: z.number().nullable(), sensitiveFlags: z.array(z.string()) })) }), versions: z.array(z.object({ id: z.string(), version: z.number(), script: storyScriptSchema, modelVersion: z.string().nullable(), audioAssets: z.array(z.object({ id: z.string(), segmentId: z.string(), durationMs: z.number(), mediaAsset: z.object({ id: z.string(), mimeType: z.string() }) })), subtitleTracks: z.array(z.object({ id: z.string(), preset: z.string(), timeline: z.unknown(), srt: z.string() })) })) });
const videoStorySchema = storySchema.extend({ post: storySchema.shape.post.extend({ comments: z.array(z.object({ id: z.string(), body: z.string() })) }) });
const videoSchema = z.object({ id: z.string(), title: z.string(), status: z.string(), reviewStatus: z.string(), durationMs: z.number().nullable(), width: z.number().nullable(), height: z.number().nullable(), fps: z.number().nullable(), renderManifest: z.unknown().nullable(), mediaAsset: z.object({ id: z.string(), mimeType: z.string(), checksum: z.string(), metadata: z.unknown() }).nullable(), story: videoStorySchema.nullable() });
const createResultSchema = z.object({ runId: z.string(), storyProjectId: z.string(), status: z.string() });
const uploadResultSchema = z.object({ id: z.string(), url: z.string() });
const durationFitSchema = z.object({ targetDurationSec: z.number(), durationMs: z.number(), tempo: z.number() });
const reviewResultSchema = z.object({ videoId: z.string(), status: z.string(), reviewStatus: z.string() });
const hydratedRunSchema = runSchema.extend({ input: z.object({ targetDurationSec: z.number().optional(), channelId: z.string().optional(), commentIds: z.array(z.string()).optional(), templateId: z.string(), subtitlePreset: z.string(), theme: z.string(), backgroundAssetId: z.string().nullable(), voiceProfileId: z.string(), speakingRate: z.number().optional(), anonymizeAuthors: z.boolean().optional(), showEngagement: z.boolean().optional() }).optional() });


export function StoryStudio({ source, initialRunId = '', initialVideoId = '', embedded = false }: { source?: StudioItem; initialRunId?: string; initialVideoId?: string; embedded?: boolean }) {
  const { role } = useSession();
  const canEdit = mayEdit(role);
  const canReview = mayReview(role);
  const candidates = useResource('/candidates?candidateStatus=APPROVED&rightsStatus=APPROVED&limit=50', candidatesSchema);
  const channels = useResource('/channels?limit=100', channelsSchema);
  const profiles = useResource('/voice-profiles', profilesSchema);
  const templates = useResource('/video-templates', templatesSchema);
  const backgrounds = useResource('/backgrounds', backgroundsSchema);
  const videos = useResource('/videos', videosSchema);
  const [candidateId, setCandidateId] = useState(source?.candidate?.id ?? '');
  const [channelId, setChannelId] = useState(source?.post.channel?.id ?? '');
  const [voiceProfileId, setVoiceProfileId] = useState('');
  const [pendingVoiceId, setPendingVoiceId] = useState('');
  const [commentIds, setCommentIds] = useState<string[]>([]);
  const [commentMode, setCommentMode] = useState<CommentMode>('TOP_REACTIONS');
  const [targetDurationSec, setTargetDurationSec] = useState(40);
  const [runId, setRunId] = useState(initialRunId);
  const [runRevision, setRunRevision] = useState(0);
  const [storyId, setStoryId] = useState('');
  const [activeVideoId, setActiveVideoId] = useState(initialVideoId);
  const [run, setRun] = useState<z.infer<typeof runSchema> | null>(null);
  const [runError, setRunError] = useState('');
  const [story, setStory] = useState<z.infer<typeof storySchema> | null>(null);
  const [video, setVideo] = useState<z.infer<typeof videoSchema> | null>(null);
  const [editedText, setEditedText] = useState<Record<string, string>>({});
  const [segmentOrder, setSegmentOrder] = useState<string[]>([]);
  const [compareVersionId, setCompareVersionId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedBackground, setSelectedBackground] = useState('');
  const [templateId, setTemplateId] = useState('SocialCommentary');
  const [subtitlePreset, setSubtitlePreset] = useState('ClassicCaption');
  const [theme, setTheme] = useState('dark');
  const [speakingRate, setSpeakingRate] = useState(1);
  const [anonymizeAuthors, setAnonymizeAuthors] = useState(true);
  const [showEngagement, setShowEngagement] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const keys = useRef<OperationKeys>({});
  const hydrateInitial = useRef(Boolean(initialRunId));
  const selectedCandidate = useMemo(() => source ? (source.candidate?.status === 'APPROVED' ? { ...source.candidate, post: source.post } : null) : candidates.data?.items.find((item) => item.id === candidateId) ?? null, [source, candidates.data, candidateId]);
  const selectedChannel = channels.data?.items.find((item) => item.id === channelId) ?? null;
  const latestVersion = story?.versions[0] ?? null;
  const comparedVersion = story?.versions.find((version) => version.id === compareVersionId) ?? null;
  const orderedSegments = useMemo(() => {
    const segments = latestVersion?.script.segments ?? [];
    const byId = new Map(segments.map((segment) => [segment.id, segment]));
    return [...segmentOrder.flatMap((id) => { const segment = byId.get(id); return segment ? [segment] : []; }), ...segments.filter((segment) => !segmentOrder.includes(segment.id))];
  }, [latestVersion, segmentOrder]);
  const durationFit = durationFitSchema.safeParse(run?.stages.find((stage) => stage.name === 'DURATION_FIT' && stage.status === 'SUCCEEDED')?.output);
  const alignedCaptions = run?.stages.some((stage) => stage.name === 'AUDIO_ALIGNMENT' && stage.status === 'SUCCEEDED' && typeof stage.output === 'object' && stage.output !== null && 'provider' in stage.output);
  const estimatedDurationMs = orderedSegments.reduce((total, segment) => total + (segment.estimatedDurationMs ?? 0), 0);
  const dirty = Boolean(latestVersion && (Object.entries(editedText).some(([id, text]) => text !== latestVersion.script.segments.find((segment) => segment.id === id)?.text) || orderedSegments.some((segment, index) => segment.id !== latestVersion.script.segments[index]?.id)));
  const processing = Boolean(runId && (!run || ['QUEUED', 'RUNNING'].includes(run.status)));

  useEffect(() => { if (!source && !candidateId && candidates.data?.items[0]) setCandidateId(candidates.data.items[0].id); }, [source, candidateId, candidates.data]);
  useEffect(() => { if (!channelId && channels.data?.items[0]) setChannelId(channels.data.items[0].id); }, [channelId, channels.data]);
  useEffect(() => { if (!voiceProfileId && profiles.data?.items[0]) setVoiceProfileId(profiles.data.items[0].id); }, [voiceProfileId, profiles.data]);
  useEffect(() => { if (pendingVoiceId && profiles.data?.items.some((profile) => profile.id === pendingVoiceId)) { setVoiceProfileId(pendingVoiceId); setPendingVoiceId(''); } }, [pendingVoiceId, profiles.data]);
  useEffect(() => {
    if (!selectedCandidate) { setCommentIds([]); return; }
    setCommentIds((previous) => previous.filter((id) => selectedCandidate.post.comments?.some((comment) => comment.id === id)));
  }, [selectedCandidate]);

  useEffect(() => {
    if (!runId) { setRun(null); return; }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setRun(null); setRunError('');
    const poll = async () => {
      let keepPolling = true;
      try {
        const next = await api(`/production-runs/${runId}`, hydratedRunSchema, { signal: controller.signal });
        if (!active) return;
        setRun(next); setRunError(''); setStoryId(next.storyProjectId);
        if (hydrateInitial.current && next.input) {
          hydrateInitial.current = false;
          setTemplateId(next.input.templateId); setSubtitlePreset(next.input.subtitlePreset); setTheme(next.input.theme);
          setSelectedBackground(next.input.backgroundAssetId ?? ''); setVoiceProfileId(next.input.voiceProfileId);
          setSpeakingRate(next.input.speakingRate ?? 1); setAnonymizeAuthors(next.input.anonymizeAuthors ?? true); setShowEngagement(next.input.showEngagement ?? true);
          if (next.input.targetDurationSec) setTargetDurationSec(next.input.targetDurationSec);
          if (next.input.channelId) setChannelId(next.input.channelId);
          if (next.input.commentIds) { setCommentIds(next.input.commentIds); setCommentMode('MANUAL'); }
        }
        const outputVideo = next.videos.find((item) => item.mediaAsset)?.id;
        if (outputVideo) setActiveVideoId(outputVideo);
        keepPolling = next.status !== 'SUCCEEDED' && next.status !== 'CANCELLED' && !next.status.startsWith('FAILED') && !next.status.startsWith('BLOCKED');
      } catch (failure) { if (active) setRunError(errorMessage(failure)); }
      finally { if (active && keepPolling) timer = setTimeout(() => { void poll(); }, 1600); }
    };
    void poll();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [runId, runRevision]);

  useEffect(() => {
    if (!storyId) { setStory(null); return; }
    let active = true;
    const controller = new AbortController();
    void api(`/stories/${storyId}`, storySchema, { signal: controller.signal }).then((value) => {
      if (!active) return;
      setStory(value);
      const current = value.versions[0]?.script.segments ?? [];
      setEditedText(Object.fromEntries(current.map((segment) => [segment.id, segment.text])));
      setSegmentOrder(current.map((segment) => segment.id));
      setCompareVersionId(value.versions[1]?.id ?? '');
    }).catch((failure: unknown) => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; controller.abort(); };
  }, [storyId, run?.status]);

  useEffect(() => {
    if (!activeVideoId) { setVideo(null); return; }
    let active = true;
    const controller = new AbortController();
    void api(`/videos/${activeVideoId}`, videoSchema, { signal: controller.signal }).then((value) => { if (active) { setVideo(value); setStoryId(value.story?.id ?? ''); } }).catch((failure: unknown) => { if (active) setError(errorMessage(failure)); });
    return () => { active = false; controller.abort(); };
  }, [activeVideoId, run?.status]);

  const compatibleProfiles = useMemo(() => profiles.data?.items.filter((profile) => profile.language === 'multilingual' || profile.language.toLowerCase() === (selectedChannel?.language ?? 'vi').slice(0, 2).toLowerCase()) ?? [], [profiles.data, selectedChannel?.language]);
  useEffect(() => { if (compatibleProfiles.length && !compatibleProfiles.some((profile) => profile.id === voiceProfileId)) setVoiceProfileId(compatibleProfiles[0]?.id ?? ''); }, [compatibleProfiles, voiceProfileId]);

  async function createProduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCandidate || !channelId || !voiceProfileId) { setError('Choose an approved story, channel and voice first.'); return; }
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setNotice('');
    try {
      const selectedIds = commentMode === 'TOP_REACTIONS' ? (await api(`/posts/${selectedCandidate.post.id}/comment-selection?duration=${targetDurationSec}`, commentPlanSchema)).items.map((comment) => comment.id) : commentIds;
      const body = {
        channelId, commentIds: selectedIds, commentSelection: commentMode, language: selectedChannel?.language ?? 'vi', targetDurationSec: Number(form.get('targetDurationSec')),
        style: String(form.get('style')), voiceProfileId, speakingRate: Number(form.get('speakingRate')),
        templateId: String(form.get('templateId')), backgroundAssetId: selectedBackground || null,
        subtitlePreset: String(form.get('subtitlePreset')), theme: String(form.get('theme')),
        anonymizeAuthors: form.get('anonymizeAuthors') === 'on', showEngagement: form.get('showEngagement') === 'on', draftOnly: true,
      };
      const result = await api(`/candidates/${selectedCandidate.id}/produce`, createResultSchema, { method: 'POST', body, idempotencyKey: await getOperationKey(keys.current, `draft:${selectedCandidate.id}`, { body, previousRun: runId }) });
      setRunId(result.runId); setStoryId(result.storyProjectId); setActiveVideoId(''); setNotice('Đang soạn kịch bản. Bạn có thể sửa bản nháp trước khi tạo MP4.');
    } catch (failure) { setError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : errorMessage(failure)); } finally { setBusy(false); }
  }

  async function saveScript() {
    if (!story || !latestVersion) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const script = storyScriptSchema.parse({ ...latestVersion.script, version: latestVersion.version, segments: orderedSegments.map((segment) => ({ ...segment, text: editedText[segment.id] ?? segment.text })) });
      await api(`/stories/${story.id}`, unknownResponseSchema, { method: 'PATCH', body: { expectedVersion: latestVersion.version, script } });
      setNotice('Script saved as a new version. Render it when you are ready to preview the changes.');
      setRunId('');
      await reloadStory();
    } catch (failure) { setError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : errorMessage(failure)); } finally { setBusy(false); }
  }

  async function regenerateScript() {
    if (!story || !latestVersion) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const body = { commentIds, commentSelection: commentMode, targetDurationSec, voiceProfileId, speakingRate, draftOnly: true };
      const result = await api(`/stories/${story.id}/regenerate`, createResultSchema, { method: 'POST', body, idempotencyKey: await getOperationKey(keys.current, `regenerate:${story.id}`, { body, version: latestVersion.id }) });
      setRunId(result.runId); setStoryId(result.storyProjectId); setActiveVideoId(''); setNotice('Đang soạn phiên bản kịch bản mới; chưa render video.');
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  async function requestAudioPreview() {
    if (!story || !latestVersion) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/stories/${story.id}/audio`, createResultSchema, { method: 'POST', body: { voiceProfileId, speakingRate, preview: true } });
      setRunId(result.runId); setStoryId(result.storyProjectId); setNotice('Đang tạo bản nghe thử ngắn với giọng và tốc độ đã chọn. Chưa dựng video.');
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  async function retryFailedRun() {
    if (!run) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/production-runs/${run.id}/retry`, z.object({ runId: z.string(), status: z.string() }), { method: 'POST', body: {} });
      setRunRevision((revision) => revision + 1); setNotice(`Retry queued: ${result.status.toLowerCase()}.`);
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  async function reloadStory() {
    if (!storyId) return;
    const value = await api(`/stories/${storyId}`, storySchema);
    setStory(value);
    setEditedText(Object.fromEntries(value.versions[0]?.script.segments.map((segment) => [segment.id, segment.text]) ?? []));
    setSegmentOrder(value.versions[0]?.script.segments.map((segment) => segment.id) ?? []);
    setCompareVersionId(value.versions[1]?.id ?? '');
  }

  function moveSegment(segmentId: string, offset: number) {
    setSegmentOrder((current) => {
      const index = current.indexOf(segmentId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [segment] = next.splice(index, 1);
      if (segment) next.splice(target, 0, segment);
      return next;
    });
  }

  async function decideReview(decision: 'APPROVED' | 'REJECTED') {
    if (!video) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/videos/${video.id}/reviews`, reviewResultSchema, { method: 'POST', body: { decision } });
      setVideo(await api(`/videos/${video.id}`, videoSchema));
      videos.reload();
      setNotice(decision === 'APPROVED' ? 'Video approved after rights and safety checks.' : 'Video rejected and recorded for the workspace.');
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  async function renderLatest() {
    if (!story) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const body = { backgroundAssetId: selectedBackground || null, templateId, subtitlePreset, theme, voiceProfileId, speakingRate, anonymizeAuthors, showEngagement };
      const result = await api(`/stories/${story.id}/render`, createResultSchema, { method: 'POST', body, idempotencyKey: await getOperationKey(keys.current, `render:${story.id}`, { body, version: latestVersion?.id, prior: runId }) });
      setActiveVideoId(''); setRunId(result.runId); setStoryId(result.storyProjectId); setNotice('A new render is queued from the latest script version.');
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  async function cancelRun() {
    if (!run || !confirmCancel) return;
    setBusy(true); setError('');
    try {
      await api(`/production-runs/${run.id}/cancel`, unknownResponseSchema, { method: 'POST', body: {} });
      setConfirmCancel(false); setRunRevision((revision) => revision + 1); setNotice('Đã yêu cầu hủy lượt xử lý.');
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  async function uploadBackground(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('background');
    if (!(file instanceof File) || file.size > 20 * 1024 * 1024) { setError('Choose an image under 20 MB.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/backgrounds', { method: 'POST', credentials: 'same-origin', headers: {
        'Content-Type': file.type, 'Idempotency-Key': crypto.randomUUID(), 'X-Asset-Name': String(form.get('name') || file.name),
        'X-Rights-Basis': String(form.get('basis')), 'X-Rights-Attested': form.get('attested') === 'on' ? 'true' : 'false',
        'X-Rights-Evidence': String(form.get('evidence') || ''),
      }, body: file });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(z.object({ message: z.string() }).safeParse(body).data?.message ?? 'The background could not be uploaded.');
      const result = uploadResultSchema.parse(body);
      setSelectedBackground(result.id); backgrounds.reload(); setNotice('Background uploaded with your usage attestation. It remains subject to editorial review.');
      event.currentTarget.reset();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  const preview = useMemo(() => {
    if (!video?.renderManifest || !video.story?.versions[0]) return null;
    const parsed = renderManifestSchema.safeParse(video.renderManifest);
    if (!parsed.success) return null;
    const version = video.story.versions[0];
    const inputProps = {
      manifest: parsed.data,
      post: { title: video.story.post.title, body: video.story.post.body, authorAlias: video.story.post.authorAlias },
      comments: video.story.post.comments.map((comment) => ({ id: comment.id, body: comment.body, authorAlias: null })),
      backgroundSrc: parsed.data.backgroundAssetId ? `/api/v1/media/${parsed.data.backgroundAssetId}` : null,
      audioSources: Object.fromEntries(version.audioAssets.map((audio) => [audio.mediaAsset.id, `/api/v1/media/${audio.mediaAsset.id}`])),
      ...(parsed.data.sourceImages ? { sourceImageSources: Object.fromEntries(parsed.data.sourceImages.map(image => [image.assetId, `/api/v1/media/${image.assetId}`])) } : {}),
    };
    return { manifest: parsed.data, inputProps };
  }, [video]);

  if (!canEdit && !canReview) return <>{!embedded && <div className="page-heading"><div><span className="eyebrow">STUDIO</span><h1>Studio</h1></div></div>}<div className="notice">A workspace editor or reviewer can access the production studio.</div></>;
  return <>
    {!embedded && <div className="page-heading"><div><span className="eyebrow">02 / STUDIO</span><h1>Studio</h1><p>Soạn kịch bản, nghe lời đọc và tạo video từ nội dung đã duyệt.</p></div><span className="badge neutral">Human review required</span></div>}
    {error && <ErrorNotice message={error} />}{runError && <ErrorNotice message={runError} />}{notice && <div className="notice success" role="status">{notice}</div>}
    {canEdit && <div className="studio-grid">
      <details className="panel form-panel studio-setup" open={!latestVersion}><summary>1. Nội dung, giọng đọc & bố cục</summary><p className="muted">Chỉ tạo bản nháp từ nội dung đủ điều kiện. MP4 được tạo ở bước riêng. Mở lại phần này để đổi template, phụ đề hoặc hình nền.</p>
        {candidates.error && <ErrorNotice message={candidates.error} retry={candidates.reload} />}
        {!source && candidates.loading && !candidates.data ? <p role="status" className="loading-state">Loading approved stories…</p> : source ? !selectedCandidate ? <EmptyState title="Bài này chưa đủ điều kiện">Duyệt quyền và chọn nội dung ở phần chi tiết phía trên.</EmptyState> : null : !candidates.data?.items.length ? <EmptyState title="No approved stories yet">Review rights and approve a candidate before producing a video.</EmptyState> : null}
        {selectedCandidate && <form className="form-stack" onSubmit={createProduction}>
          {!source && <label>Approved source story<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>{candidates.data?.items.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.post.title || candidate.post.body.slice(0, 74)} · score {candidate.score ?? '—'}</option>)}</select></label>}
          {selectedCandidate && <div className="studio-source"><strong>{selectedCandidate.post.title || 'Source post'}</strong><p>{selectedCandidate.post.body}</p><span className="field-help">{selectedCandidate.post.platform} · rights approved · score {selectedCandidate.score ?? '—'}</span></div>}
          <SourceImagePreview postId={selectedCandidate.post.id} anonymized={anonymizeAuthors} />
          <div><h3 className="studio-label">Bình luận được chọn</h3><CommentPicker postId={selectedCandidate.post.id} duration={targetDurationSec} mode={commentMode} selectedIds={commentIds} onMode={setCommentMode} onSelection={setCommentIds} locked={processing} /></div>
          <label>Content channel<select value={channelId} onChange={(event) => setChannelId(event.target.value)}>{(channels.data?.items ?? []).map((channel) => <option key={channel.id} value={channel.id}>{channel.name} · {channel.language}</option>)}</select></label>
          <div className="studio-form-row"><label>Template<select name="templateId" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{(templates.data?.items ?? []).filter((item) => item.status === 'READY').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Duration target<select name="targetDurationSec" value={targetDurationSec} onChange={(event) => setTargetDurationSec(Number(event.target.value))}><option value="25">25 seconds</option><option value="40">40 seconds</option><option value="60">60 seconds</option><option value="90">90 seconds</option><option value="120">120 seconds</option></select></label></div>
          <div className="studio-form-row"><label>Script style<select name="style"><option value="STORYTELLING">Storytelling</option><option value="SOCIAL_COMMENTARY">Social commentary</option></select></label><label>Subtitles<select name="subtitlePreset" value={subtitlePreset} onChange={(event) => setSubtitlePreset(event.target.value)}><option value="ClassicCaption">Classic captions</option><option value="KaraokeHighlight">Karaoke highlight</option></select></label></div>
          <div className="studio-form-row"><label>Narration voice<select value={voiceProfileId} onChange={(event) => setVoiceProfileId(event.target.value)}>{compatibleProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.requiresCredentials ? ' · credentials required' : ''}</option>)}</select></label><label>Speaking rate<select name="speakingRate" value={speakingRate} onChange={(event) => setSpeakingRate(Number(event.target.value))}><option value="0.85">Slower</option><option value="1">Normal</option><option value="1.15">Faster</option></select></label></div>
          {profiles.data?.items.find((profile) => profile.id === voiceProfileId)?.provider === 'mock' && <p className="field-help">The mock voice emits a deterministic test tone, not speech. Choose a configured voice provider for narration.</p>}
          <div className="studio-form-row"><label>Visual theme<select name="theme" value={theme} onChange={(event) => setTheme(event.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></label><label>Background<select value={selectedBackground} onChange={(event) => setSelectedBackground(event.target.value)}><option value="">Default gradient</option>{(backgrounds.data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{String((item.metadata as { name?: string } | null)?.name ?? item.id.slice(0, 8))}</option>)}</select></label></div>
          <label className="checkbox-label"><input type="checkbox" name="anonymizeAuthors" checked={anonymizeAuthors} onChange={(event) => setAnonymizeAuthors(event.target.checked)} /><span>Anonymize author names in the video</span></label>
          <label className="checkbox-label"><input type="checkbox" name="showEngagement" checked={showEngagement} onChange={(event) => setShowEngagement(event.target.checked)} /><span>Show available engagement counts</span></label>
          <button className="button" disabled={busy || !compatibleProfiles.length || processing || Boolean(source?.lifecycle.blockedReason)}>{busy ? 'Đang gửi…' : 'Tạo bản nháp kịch bản'} <span aria-hidden="true">→</span></button>
        </form>}
      </details>
      <section className="studio-right-column">
        <VoiceLibrary enabled={profiles.data?.items.some((profile) => profile.provider === 'vieneu') ?? false} onCreated={(id) => { setPendingVoiceId(id); profiles.reload(); }} />
        <details className="panel form-panel"><summary>Thư viện hình nền · nâng cao</summary><p className="muted">Upload an image you own or have permission to use.</p>
          {backgrounds.error && <ErrorNotice message={backgrounds.error} retry={backgrounds.reload} />}
          <form className="form-stack studio-upload" onSubmit={uploadBackground}><label>Image file<input type="file" name="background" accept="image/png,image/jpeg,image/webp" required /></label><label>Asset name<input name="name" maxLength={120} placeholder="Rainy city loop" required /></label><label>Usage basis<select name="basis"><option value="OWNED">I own this image</option><option value="LICENSED">Licensed for this use</option><option value="CONSENTED">Permission granted</option></select></label><label>License or consent reference<input name="evidence" maxLength={2000} placeholder="Optional for owned work; required otherwise" /></label><label className="checkbox-label"><input type="checkbox" name="attested" required /><span>I confirm this background may be used in this workspace’s videos.</span></label><button className="button secondary small" disabled={busy}>Upload and attest</button></form>
        </details>
        <details className="panel studio-run" open={processing}><summary className="studio-progress-summary">Tiến độ xử lý · {run?.status === 'CANCELLED' ? 'Đã hủy' : run?.status.startsWith('FAILED') || run?.status.startsWith('BLOCKED') ? 'Cần xử lý lỗi' : humanStage(run?.currentStage ?? null)}</summary><div className="panel-heading"><div><h2>Production status</h2><p>Each run can resume from its last completed stage.</p></div></div>
          {run ? <div className="studio-run-content"><div className="studio-run-status"><span className={`badge ${run.status === 'SUCCEEDED' ? 'positive' : run.status.startsWith('FAILED') || run.status.startsWith('BLOCKED') ? 'negative' : 'neutral'}`}>{run.status.replaceAll('_', ' ')}</span><span className="field-help">{run.currentStage?.replaceAll('_', ' ') ?? 'Queued'}</span></div><progress max="1" value={run.renderJob?.progress ?? 0} aria-label="Production progress" /><ol className="stage-list">{run.stages.map((stage) => <li key={stage.name} className={stage.status === 'SUCCEEDED' ? 'done' : stage.status === 'RUNNING' ? 'active' : ''}><span>{stage.name.replaceAll('_', ' ')}</span><span>{stage.status}</span></li>)}</ol>{run.errorCode && <div className="notice error">{mediaFailureMessage(run.errorCode)}</div>}{mayAdmin(role) && run.status.startsWith('FAILED') && <button className="button secondary small" onClick={() => void retryFailedRun()} disabled={busy}>Retry failed run</button>}</div> : <EmptyState title="No active production">Start with an approved source. Completed videos remain available in the review list below.</EmptyState>}
        </details>
      </section>
    </div>}
    {canEdit && processing && <section className="notice"><p>{humanStage(run?.currentStage ?? null)}. Có thể hủy trước khi bắt đầu một lượt mới.</p><label className="checkbox-label"><input type="checkbox" checked={confirmCancel} onChange={(event) => setConfirmCancel(event.target.checked)} /><span>Xác nhận hủy lượt đang chạy</span></label><button className="button secondary small" disabled={busy || !confirmCancel} onClick={() => void cancelRun()}>Hủy lượt xử lý</button></section>}
    {story && latestVersion && <section className="panel studio-script"><div className="panel-heading"><div><h2>{canEdit ? 'Script editor' : 'Approved script'}</h2><p>Version {latestVersion.version} · {latestVersion.script.language} · about {estimatedDurationMs ? `${Math.round(estimatedDurationMs / 1000)} sec` : '—'} · source-grounded segments</p></div>{canEdit && <div className="studio-preview-actions"><button className="button secondary small" onClick={() => void regenerateScript()} disabled={busy || processing || dirty}>Regenerate draft</button><button className="button secondary small" onClick={() => void requestAudioPreview()} disabled={busy || processing || dirty || !voiceProfileId}>Nghe thử giọng</button><button className="button secondary small" onClick={() => void saveScript()} disabled={busy || processing || !dirty}>Save new version</button></div>}</div>
      <div className="studio-segments">{orderedSegments.map((segment, index) => <div className="studio-segment" key={segment.id}><div className="studio-segment-meta"><span><b>{String(index + 1).padStart(2, '0')}</b>{segment.type.replaceAll('_', ' ')}<small>{segment.narrationType.replaceAll('_', ' ')}</small></span>{canEdit && <div className="studio-segment-order"><button type="button" className="text-button" aria-label={`Move segment ${index + 1} up`} onClick={() => moveSegment(segment.id, -1)} disabled={index === 0}>↑</button><button type="button" className="text-button" aria-label={`Move segment ${index + 1} down`} onClick={() => moveSegment(segment.id, 1)} disabled={index === orderedSegments.length - 1}>↓</button></div>}</div>{canEdit ? <textarea disabled={busy || processing} aria-label={`${segment.type.replaceAll('_', ' ')} text`} rows={Math.min(6, Math.max(2, Math.ceil(segment.text.length / 100)))} value={editedText[segment.id] ?? segment.text} onChange={(event) => setEditedText((current) => ({ ...current, [segment.id]: event.target.value }))} /> : <p className="studio-segment-readonly">{segment.text}</p>}</div>)}</div>
      {story.versions.length > 1 && <section className="studio-version-compare"><label>Compare with version<select value={compareVersionId} onChange={(event) => setCompareVersionId(event.target.value)}>{story.versions.filter((version) => version.id !== latestVersion.id).map((version) => <option key={version.id} value={version.id}>Version {version.version}</option>)}</select></label>{comparedVersion && <div className="studio-version-columns"><div><h3>Version {comparedVersion.version}</h3>{comparedVersion.script.segments.map((segment, index) => <p key={segment.id}><b>{String(index + 1).padStart(2, '0')} · {segment.type}</b><br />{segment.text}</p>)}</div><div><h3>Current · Version {latestVersion.version}</h3>{orderedSegments.map((segment, index) => <p key={segment.id}><b>{String(index + 1).padStart(2, '0')} · {segment.type}</b><br />{editedText[segment.id] ?? segment.text}</p>)}</div></div>}</section>}
      {latestVersion.audioAssets.length > 0 && <div className="studio-audio-previews"><h3>Lời đọc và bản nghe thử</h3><p className="field-help">Bản nghe thử dùng câu mẫu ngắn với giọng và tốc độ đã chọn.</p>{latestVersion.audioAssets.map((audio) => <div key={audio.id}><span>{latestVersion.script.segments.find((segment) => segment.id === audio.segmentId)?.type ?? (audio.segmentId === 'voice-preview' ? 'Bản nghe thử giọng' : 'Segment')} · {Math.round(audio.durationMs / 1000)} sec</span><audio controls preload="none" src={`/api/v1/media/${audio.mediaAsset.id}`} /></div>)}</div>}
      <p className="field-help studio-grounding">Quoted comments and verbatim source text remain locked to the original. If you revise a paraphrase or commentary, keep it faithful to the cited material.</p>
    </section>}
    {durationFit.success && <p className="notice" role="status">Thời lượng audio: {(durationFit.data.durationMs / 1000).toFixed(1)} giây / mục tiêu {durationFit.data.targetDurationSec} giây. {alignedCaptions ? 'Phụ đề đã căn theo audio; hãy nghe kiểm tra trước khi duyệt.' : 'Đang chờ căn phụ đề theo audio.'}</p>}
    {latestVersion && <section className="panel draft-render"><div><span className="eyebrow">3 / DỰNG VIDEO</span><h2>{video ? 'Dựng phiên bản tiếp theo' : 'Kịch bản đã sẵn sàng'}</h2><p>{dirty ? 'Lưu phiên bản kịch bản trước khi nghe hoặc dựng video.' : 'Tạo lời đọc, phụ đề và video MP4 từ phiên bản đã lưu.'}</p>{canEdit && <button className="button" onClick={() => void renderLatest()} disabled={busy || dirty || processing}>Tạo video MP4</button>}</div><div className={`draft-poster ${theme}`} aria-label="Xem thử chữ trong bản nháp"><small>BỐ CỤC CHỮ · CHƯA RENDER</small><strong>{story?.post.title}</strong><p>{orderedSegments[0] ? editedText[orderedSegments[0].id] ?? orderedSegments[0].text : ''}</p><span>{subtitlePreset === 'KaraokeHighlight' ? 'Karaoke highlight' : 'Classic captions'}</span></div></section>}
    {video && <section className="panel studio-preview"><div className="panel-heading"><div><h2>Video preview</h2><p>{video.title} · {video.durationMs ? `${Math.round(video.durationMs / 1000)} sec` : 'render in progress'} · {video.width ?? '—'} × {video.height ?? '—'} · {video.fps ?? '—'} fps</p></div><div className="studio-preview-actions"><span className={`badge ${video.reviewStatus === 'APPROVED' ? 'positive' : video.reviewStatus === 'REJECTED' || video.reviewStatus === 'BLOCKED' ? 'negative' : 'neutral'}`}>{video.reviewStatus.replaceAll('_', ' ')}</span>{canReview && video.reviewStatus === 'PENDING' && video.mediaAsset && <><button className="button secondary small" onClick={() => void decideReview('REJECTED')} disabled={busy}>Reject video</button><button className="button small" onClick={() => void decideReview('APPROVED')} disabled={busy}>Approve video</button></>}{video.mediaAsset && <a className="button small" href={`/api/v1/media/${video.mediaAsset.id}?download=1`}>Download MP4</a>}</div></div>
      {video.mediaAsset && <div className="studio-player-column"><video className="studio-html-video" controls playsInline preload="metadata" src={`/api/v1/media/${video.mediaAsset.id}`} /><details className="studio-remotion-preview"><summary>Open editable composition preview</summary>{preview && <Player component={StoryComposition} inputProps={preview.inputProps} durationInFrames={preview.manifest.durationFrames} compositionWidth={1080} compositionHeight={1920} fps={30} controls style={{ width: '100%', maxHeight: 740, aspectRatio: '9 / 16' }} />}</details></div>}
    </section>}
    <section className="panel studio-video-list"><div className="panel-heading"><div><h2>Review queue</h2><p>Generated videos stay pending until a workspace reviewer records a decision.</p></div><button className="text-button" onClick={videos.reload}>Refresh</button></div>{videos.loading && !videos.data ? <p role="status" className="loading-state">Loading videos…</p> : videos.error ? <ErrorNotice message={videos.error} retry={videos.reload} /> : videos.data?.items.length ? <div className="table-scroll"><table><thead><tr><th>Video</th><th>Status</th><th>Review</th><th>Duration</th><th>Output</th></tr></thead><tbody>{videos.data.items.map((item) => <tr key={item.id}><td><Link className="text-button" href={studioLink({ videoId: item.id })}>{item.title}</Link></td><td>{item.status}</td><td>{item.reviewStatus}</td><td>{item.durationMs ? `${Math.round(item.durationMs / 1000)} sec` : '—'}</td><td>{item.mediaAssetId ? <a className="text-button" href={`/api/v1/media/${item.mediaAssetId}?download=1`}>MP4 ↓</a> : 'Rendering'}</td></tr>)}</tbody></table></div> : <EmptyState title="No videos to review">Generated outputs will appear here when their render and media checks complete.</EmptyState>}</section>
  </>;
}
