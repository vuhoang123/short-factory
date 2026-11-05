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
import { humanStage, mediaFailureMessage, type StudioItem } from '../lib/studio';
import { CommentPicker } from './comment-picker';
import { VoiceLibrary } from './voice-library';
import { commentPlanSchema, type CommentMode } from '../lib/comment-selection';
import { SourceImagePreview } from './source-capture';
import { StudioDraftPreview } from './studio-draft-preview';
import { StudioAssetUpload } from './studio-asset-upload';
import { StudioMediaCatalog } from './studio-media-catalog';
import { StudioPresets } from './studio-presets';
import { studioMediaSchema, studioPresetSettingsSchema } from '@shorts-factory/media/studio-settings';
import { studioStorySchema as storySchema, studioVideoSchema as videoSchema } from '../lib/studio-response';
import { playOneAudio } from '../lib/media-preview';
import { StudioSteps } from './studio-steps';

const candidatesSchema = paginated(candidateSchema);
const channelsSchema = paginated(channelSchema);
const profilesSchema = z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), provider: z.enum(['local', 'vieneu', 'openai', 'mock']), language: z.string(), voiceId: z.string(), requiresCredentials: z.boolean() })) });
const templatesSchema = z.object({ items: z.array(z.object({ id: z.enum(['RedditStory', 'SocialCommentary']), version: z.number(), name: z.string(), description: z.string(), status: z.string() })) });
const backgroundsSchema = z.object({ items: z.array(z.object({ id: z.string(), mimeType: z.string(), metadata: z.object({ name: z.string().optional(), durationMs: z.number().optional() }).nullable(), url: z.string() })) });
const musicSchema = backgroundsSchema;
const runSchema = z.object({ id: z.string(), storyProjectId: z.string(), status: z.string(), currentStage: z.string().nullable(), errorCode: z.string().nullable(), stages: z.array(z.object({ name: z.string(), status: z.string(), errorCode: z.string().nullable(), output: z.unknown().optional() })), renderJob: z.object({ progress: z.number() }).nullable(), videos: z.array(z.object({ id: z.string(), status: z.string(), mediaAsset: z.object({ id: z.string() }).nullable() })) });
const createResultSchema = z.object({ runId: z.string(), storyProjectId: z.string(), status: z.string() });
const durationFitSchema = z.object({ targetDurationSec: z.number(), durationMs: z.number(), tempo: z.number() });
const reviewResultSchema = z.object({ videoId: z.string(), status: z.string(), reviewStatus: z.string() });
const hydratedRunSchema = runSchema.extend({ input: z.object({ targetDurationSec: z.number().optional(), channelId: z.string().optional(), commentIds: z.array(z.string()).optional(), templateId: z.enum(['RedditStory', 'SocialCommentary']), subtitlePreset: z.enum(['ClassicCaption', 'KaraokeHighlight']), theme: z.enum(['dark', 'light']), mediaSettings: studioMediaSchema.optional(), backgroundAssetId: z.string().nullable(), voiceProfileId: z.string(), speakingRate: z.number().optional(), anonymizeAuthors: z.boolean().optional(), showEngagement: z.boolean().optional() }).optional() });


export function StoryStudio({ source, initialRunId = '', initialVideoId = '', embedded = false }: { source?: StudioItem; initialRunId?: string; initialVideoId?: string; embedded?: boolean }) {
  const { role } = useSession();
  const canEdit = mayEdit(role);
  const canReview = mayReview(role);
  const [editorStep, setEditorStep] = useState(1);
  const candidates = useResource('/candidates?candidateStatus=APPROVED&rightsStatus=APPROVED&limit=50', candidatesSchema);
  const channels = useResource('/channels?limit=100', channelsSchema);
  const profiles = useResource('/voice-profiles', profilesSchema);
  const templates = useResource('/video-templates', templatesSchema);
  const backgrounds = useResource('/backgrounds', backgroundsSchema);
  const music = useResource('/music', musicSchema);
  const [candidateId, setCandidateId] = useState(source?.candidate?.id ?? '');
  const [channelId, setChannelId] = useState(source?.post.channel?.id ?? '');
  const [voiceProfileId, setVoiceProfileId] = useState('');
  const [pendingVoiceId, setPendingVoiceId] = useState('');
  const [commentIds, setCommentIds] = useState<string[]>([]);
  const [commentMode, setCommentMode] = useState<CommentMode>('TOP_REACTIONS');
  const [needsRegeneration, setNeedsRegeneration] = useState(false);
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
  const [templateId, setTemplateId] = useState<'RedditStory' | 'SocialCommentary'>('SocialCommentary');
  const [subtitlePreset, setSubtitlePreset] = useState<'ClassicCaption' | 'KaraokeHighlight'>('ClassicCaption');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [speakingRate, setSpeakingRate] = useState(1);
  const [style, setStyle] = useState<'STORYTELLING' | 'SOCIAL_COMMENTARY'>('STORYTELLING');
  const [mediaSettings, setMediaSettings] = useState(() => studioMediaSchema.parse({}));
  const selectedMusicPlayer = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (selectedMusicPlayer.current) selectedMusicPlayer.current.volume = mediaSettings.musicVolume; }, [mediaSettings.musicVolume, mediaSettings.musicAssetId]);
  const [anonymizeAuthors, setAnonymizeAuthors] = useState(true);
  const [showEngagement, setShowEngagement] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reviewedVideoId, setReviewedVideoId] = useState('');
  const [previewProblem, setPreviewProblem] = useState('Đang chuẩn bị preview…');
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
          setMediaSettings(next.input.mediaSettings ?? studioMediaSchema.parse({}));
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
    if (latestVersion) { await regenerateScript(); return; }
    if (!selectedCandidate || !channelId || !voiceProfileId) { setError('Choose an approved story, channel and voice first.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const selectedIds = commentMode === 'TOP_REACTIONS' ? (await api(`/posts/${selectedCandidate.post.id}/comment-selection?duration=${targetDurationSec}`, commentPlanSchema)).items.map((comment) => comment.id) : commentIds;
      const body = {
        channelId, commentIds: selectedIds, commentSelection: commentMode, language: selectedChannel?.language ?? 'vi', targetDurationSec,
        style, voiceProfileId, speakingRate,
        templateId, backgroundAssetId: selectedBackground || null,
        subtitlePreset, theme,
        anonymizeAuthors, showEngagement, mediaSettings, draftOnly: true,
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
      const body = { commentIds, commentSelection: commentMode, targetDurationSec, ...currentSettings, style, draftOnly: true };
      const result = await api(`/stories/${story.id}/regenerate`, createResultSchema, { method: 'POST', body, idempotencyKey: await getOperationKey(keys.current, `regenerate:${story.id}`, { body, version: latestVersion.id }) });
      setRunId(result.runId); setStoryId(result.storyProjectId); setActiveVideoId(''); setNeedsRegeneration(false); setNotice('Đang soạn phiên bản kịch bản mới; chưa render video.');
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
    if (!video || decision === 'APPROVED' && reviewedVideoId !== video.id) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/videos/${video.id}/reviews`, reviewResultSchema, { method: 'POST', body: { decision } });
      setVideo(await api(`/videos/${video.id}`, videoSchema));
      setNotice(decision === 'APPROVED' ? 'Đã duyệt video. Bạn có thể tải MP4 hoặc mở Publish để bàn giao.' : 'Đã ghi nhận không duyệt video. Sửa kịch bản hoặc thiết lập rồi dựng bản mới.');
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }

  async function renderLatest() {
    if (!story) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const body = { backgroundAssetId: selectedBackground || null, templateId, subtitlePreset, theme, voiceProfileId, speakingRate, anonymizeAuthors, showEngagement, mediaSettings };
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

  const preview = useMemo(() => {
    if (!video?.renderManifest || !video.story?.versions[0]) return null;
    const parsed = renderManifestSchema.safeParse(video.renderManifest);
    if (!parsed.success) return null;
    const version = video.story.versions.find(version => version.id === parsed.data.storyVersionId);
    if (!version) return null;
    const inputProps = {
      manifest: parsed.data,
      post: { title: video.story.post.title, body: video.story.post.body, authorAlias: video.story.post.authorAlias },
      comments: video.story.post.comments.map((comment) => ({ id: comment.id, body: comment.body, authorAlias: null })),
      backgroundSrc: parsed.data.backgroundAssetId ? `/api/v1/media/${parsed.data.backgroundAssetId}` : null,
      ...(parsed.data.mediaSettings?.musicAssetId ? { musicSrc: `/api/v1/media/${parsed.data.mediaSettings.musicAssetId}` } : {}),
      audioSources: Object.fromEntries(version.audioAssets.map((audio) => [audio.mediaAsset.id, `/api/v1/media/${audio.mediaAsset.id}`])),
      ...(parsed.data.sourceImages ? { sourceImageSources: Object.fromEntries(parsed.data.sourceImages.map(image => [image.assetId, `/api/v1/media/${image.assetId}`])) } : {}),
    };
    return { manifest: parsed.data, inputProps };
  }, [video]);

  const currentSettings = {
    voiceProfileId, speakingRate, templateId, subtitlePreset, theme, backgroundAssetId: selectedBackground || null,
    anonymizeAuthors, showEngagement, mediaSettings,
  };
  function applySettings(settings: z.infer<typeof studioPresetSettingsSchema>) {
    if (!compatibleProfiles.some(profile => profile.id === settings.voiceProfileId)) { setError('Giọng trong bộ thiết lập không khả dụng với kênh này. Chọn một bộ khác.'); return; }
    setVoiceProfileId(settings.voiceProfileId); setSpeakingRate(settings.speakingRate); setTemplateId(settings.templateId);
    setSubtitlePreset(settings.subtitlePreset); setTheme(settings.theme); setSelectedBackground(settings.backgroundAssetId ?? '');
    setAnonymizeAuthors(settings.anonymizeAuthors); setShowEngagement(settings.showEngagement); setMediaSettings(settings.mediaSettings);
  }
  const selectedBackgroundAsset = backgrounds.data?.items.find(asset => asset.id === selectedBackground);
  const previewScript = latestVersion ? { ...latestVersion.script, segments: orderedSegments.map(segment => ({ ...segment, text: editedText[segment.id] ?? segment.text })) } : null;
  const recordedPreview = !dirty && preview && latestVersion && preview.manifest.storyVersionId === latestVersion.id && video?.productionRun?.input.voiceProfileId === voiceProfileId && video.productionRun.input.speakingRate === speakingRate ? preview.inputProps : undefined;
  const renderBlockers = [
    ...(needsRegeneration ? ['Đã đổi bình luận. Soạn lại kịch bản để áp dụng lựa chọn mới.'] : []),
    ...(latestVersion && latestVersion.script.targetDurationSec !== targetDurationSec ? ['Đã đổi thời lượng. Soạn lại kịch bản để áp dụng.'] : []),
    ...(previewProblem ? [previewProblem] : []),
    ...(dirty ? ['Lưu phiên bản kịch bản để xuất những thay đổi vừa sửa.'] : []),
    ...(!voiceProfileId || !compatibleProfiles.some(profile => profile.id === voiceProfileId) ? ['Chọn giọng đọc hỗ trợ ngôn ngữ của kênh.'] : []),
    ...(selectedBackground && !backgrounds.loading && !selectedBackgroundAsset ? ['Nền đã chọn không còn khả dụng. Chọn nền khác.'] : []),
    ...(mediaSettings.musicAssetId && !music.loading && !music.data?.items.some(asset => asset.id === mediaSettings.musicAssetId) ? ['Nhạc đã chọn không còn khả dụng. Chọn nhạc khác.'] : []),
    ...(selectedBackgroundAsset?.mimeType === 'video/mp4' && mediaSettings.backgroundStartSec * 1000 >= (selectedBackgroundAsset.metadata?.durationMs ?? 0) ? ['Điểm bắt đầu phải nằm trong video nền.'] : []),
  ];
  if (!canEdit && !canReview) return <div className="notice">Cần vai trò biên tập hoặc duyệt để mở bàn dựng video.</div>;
  return <>
    {!embedded && <div className="page-heading"><div><h1>Studio</h1><p>Biên tập nội dung, xem trước và xuất video local.</p></div></div>}
    {error && <ErrorNotice message={error} />}{runError && <ErrorNotice message={runError} />}{notice && <div className="notice success" role="status">{notice}</div>}
    {video && <section className="panel studio-preview" id="video-review" aria-labelledby="video-review-heading">
      <div className="panel-heading"><div><h2 id="video-review-heading">Xem và duyệt video</h2><p>{video.title} · {video.durationMs ? `${(video.durationMs/1000).toFixed(1)} giây` : 'Đang dựng'} · {video.width ?? '—'} × {video.height ?? '—'}</p></div><span className="badge neutral">{video.reviewStatus === 'PENDING' ? 'Chờ duyệt' : video.reviewStatus === 'APPROVED' ? 'Đã duyệt' : video.reviewStatus === 'REJECTED' ? 'Không duyệt' : video.reviewStatus}</span></div>
      {video.mediaAsset ? <div className="studio-player-column">
        <video className="studio-html-video" controls playsInline preload="metadata" aria-label="Video MP4 đã xuất" src={`/api/v1/media/${video.mediaAsset.id}`} />
        <div className="studio-review-controls">
          <h3>Kiểm tra bản MP4 đã dựng</h3><p>Xem lời đọc, phụ đề, ảnh bài và bình luận trước khi ghi nhận quyết định.</p>
          {video.status === 'READY_FOR_REVIEW' && video.reviewStatus === 'PENDING' && (canReview ? <>
            <label className="checkbox-label"><input type="checkbox" checked={reviewedVideoId === video.id} onChange={event => setReviewedVideoId(event.target.checked ? video.id : '')} /><span>Tôi đã xem video, kiểm tra lời đọc, phụ đề và quyền sử dụng.</span></label>
            <div className="phase5-actions"><button className="button" onClick={() => void decideReview('APPROVED')} disabled={busy || reviewedVideoId !== video.id}>Duyệt video</button><button className="button secondary" onClick={() => void decideReview('REJECTED')} disabled={busy}>Không duyệt video</button></div>
          </> : <p className="notice">Cần chủ workspace, quản trị viên hoặc người duyệt để duyệt video này. Bạn có thể xem và tải bản MP4.</p>)}
          <div className="phase5-actions"><a className="button secondary" href={`/api/v1/media/${video.mediaAsset.id}?download=1`}>Tải MP4 về máy</a>{video.reviewStatus === 'APPROVED' && <Link className="text-button" href="/publish">Mở bàn giao video →</Link>}</div>
          {preview && <details className="studio-remotion-preview"><summary>Xem composition của bản đã xuất</summary><Player component={StoryComposition} inputProps={preview.inputProps} durationInFrames={preview.manifest.durationFrames} compositionWidth={1080} compositionHeight={1920} fps={30} controls style={{ width: '100%', maxHeight: 740, aspectRatio: '9 / 16' }} /></details>}
        </div>
      </div> : <p className="loading-state">Chưa có bản MP4 để duyệt. Đợi lượt dựng hoàn tất hoặc kiểm tra tiến độ.</p>}
    </section>}
    <div className="studio-workspace">
      <div className="studio-edit-column">
        <StudioSteps active={editorStep} onSelect={setEditorStep} hasScript={Boolean(latestVersion)} />
        {story && latestVersion && <section hidden={editorStep !== 1} className="studio-script" id="studio-script"><div className="panel-heading"><div><h2>Biên tập kịch bản</h2><p>Phiên bản {latestVersion.version} · {latestVersion.script.language} · {estimatedDurationMs ? `khoảng ${Math.round(estimatedDurationMs / 1000)} giây` : 'thời gian tạm tính'}</p></div>{canEdit && <button className="button secondary small" onClick={() => void saveScript()} disabled={busy || processing || !dirty}>Lưu phiên bản</button>}</div>
          {dirty && <p className="notice warning">Có thay đổi chưa lưu. Preview đã cập nhật; lưu kịch bản trước khi tạo MP4.</p>}
          <div className="studio-segments">{orderedSegments.map((segment,index) => <div className="studio-segment" key={segment.id}><div className="studio-segment-meta"><span><b>{String(index+1).padStart(2,'0')}</b>{segment.type}<small>{segment.narrationType === 'VERBATIM' ? 'Trích nguyên văn · giữ nguồn' : 'Lời dẫn có thể chỉnh sửa'}</small></span>{canEdit && <div className="studio-segment-order"><button type="button" className="text-button" aria-label={`Move segment ${index+1} up`} disabled={busy || processing || index === 0} onClick={() => moveSegment(segment.id,-1)}>↑</button><button type="button" className="text-button" aria-label={`Move segment ${index+1} down`} disabled={busy || processing || index === orderedSegments.length-1} onClick={() => moveSegment(segment.id,1)}>↓</button></div>}</div>{canEdit ? <textarea aria-label={`${segment.type} text`} readOnly={segment.narrationType === 'VERBATIM'} disabled={busy || processing} maxLength={4000} rows={Math.min(6,Math.max(2,Math.ceil(segment.text.length/100)))} value={editedText[segment.id] ?? segment.text} onChange={event => setEditedText(current => ({ ...current, [segment.id]: event.target.value }))} /> : <p>{segment.text}</p>}</div>)}</div>
          {story.versions.length > 1 && <details className="studio-version-compare"><summary>Lịch sử phiên bản</summary><label>So sánh với phiên bản<select value={compareVersionId} onChange={event => setCompareVersionId(event.target.value)}>{story.versions.filter(version => version.id !== latestVersion.id).map(version => <option key={version.id} value={version.id}>Phiên bản {version.version}</option>)}</select></label>{comparedVersion && <div className="studio-version-columns"><div>{comparedVersion.script.segments.map(segment => <p key={segment.id}>{segment.text}</p>)}</div><div>{orderedSegments.map(segment => <p key={segment.id}>{editedText[segment.id] ?? segment.text}</p>)}</div></div>}</details>}
          <details className="studio-audio-previews"><summary>Lời đọc đã tạo</summary>{latestVersion.audioAssets.filter(audio => audio.segmentId !== 'voice-preview').map(audio => <div key={audio.id}><span>{audio.segmentId} · {(audio.durationMs/1000).toFixed(1)} giây</span><audio controls preload="none" src={`/api/v1/media/${audio.mediaAsset.id}`} /></div>)}</details>
        </section>}
        {canEdit && <section hidden={editorStep === 3} className="studio-setup" id="studio-setup">
          {(editorStep !== 1 || !latestVersion) && <div className="panel-heading"><div><h2>{editorStep === 0 ? 'Nguồn và bình luận' : editorStep === 2 ? 'Nền, nhạc và phụ đề' : 'Chọn giọng và soạn lời đọc'}</h2><p>Thay đổi được giữ lại khi chuyển bước. Chỉ dựng video khi bạn bấm tạo MP4.</p></div></div>}
          {candidates.error && !source && <ErrorNotice message={candidates.error} retry={candidates.reload} />}
          {!selectedCandidate && <EmptyState title="Bài này chưa đủ điều kiện">Duyệt quyền và chọn nội dung ở phần nguồn phía trên.</EmptyState>}
          <div hidden={editorStep !== 2}><StudioPresets settings={currentSettings} onApply={applySettings} disabled={busy || processing} /></div>
          {selectedCandidate && <form className="form-stack" onSubmit={createProduction}><fieldset className="studio-fields" disabled={busy || processing}>
            <div hidden={editorStep !== 0} className="studio-fields">
            {!source && <label>Bài đã duyệt<select value={candidateId} onChange={event => setCandidateId(event.target.value)}>{candidates.data?.items.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.post.title || candidate.post.body.slice(0, 74)}</option>)}</select></label>}
            <details className="studio-original-source" open><summary>Bài và ảnh nguồn</summary><div className="studio-source"><strong>{selectedCandidate.post.title || 'Bài nguồn'}</strong><p>{selectedCandidate.post.body}</p></div><SourceImagePreview postId={selectedCandidate.post.id} anonymized={anonymizeAuthors} /></details>
            <div className="studio-form-row"><label>Kênh nội dung<select disabled={Boolean(latestVersion)} value={channelId} onChange={event => setChannelId(event.target.value)}>{channels.data?.items.map(channel => <option key={channel.id} value={channel.id}>{channel.name} · {channel.language}</option>)}</select></label><label>Độ dài mục tiêu<select name="targetDurationSec" value={targetDurationSec} onChange={event => setTargetDurationSec(Number(event.target.value))}>{[25,40,60,90,120].map(value => <option key={value} value={value}>{value} giây</option>)}</select></label></div>
            <details className="studio-comment-section" open><summary>Bình luận trong video</summary><CommentPicker postId={selectedCandidate.post.id} duration={targetDurationSec} mode={commentMode} selectedIds={commentIds} onMode={mode => { setCommentMode(mode); if (latestVersion) setNeedsRegeneration(true); }} onSelection={ids => { setCommentIds(ids); if (latestVersion) setNeedsRegeneration(true); }} locked={processing} /><p className="field-help">Sau khi đổi bình luận hoặc thời lượng, chọn soạn lại để cập nhật kịch bản.</p></details>
            </div>
            <div hidden={editorStep !== 1} className="studio-control-section"><h3>Giọng đọc</h3><div className="studio-form-row"><label>Giọng thuyết minh<select value={voiceProfileId} onChange={event => setVoiceProfileId(event.target.value)}>{compatibleProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label>Tốc độ đọc<select name="speakingRate" value={speakingRate} onChange={event => setSpeakingRate(Number(event.target.value))}><option value="0.85">Chậm · 0.85×</option><option value="1">Tự nhiên · 1×</option><option value="1.15">Nhanh · 1.15×</option>{![0.85,1,1.15].includes(speakingRate) && <option value={speakingRate}>{speakingRate}×</option>}</select></label></div>
              <button className="button secondary small" type="button" onClick={() => void requestAudioPreview()} disabled={busy || processing || dirty || !latestVersion || !voiceProfileId}>Nghe thử giọng</button><p className="field-help">{latestVersion ? 'Nghe một câu mẫu ngắn với giọng và tốc độ đang chọn.' : 'Soạn bản nháp bên dưới để nghe thử giọng.'}</p>
              {profiles.data?.items.find(profile => profile.id === voiceProfileId)?.provider === 'mock' && <p className="notice warning">Giọng mock chỉ tạo âm thử. Chọn VieNeu local để có lời đọc.</p>}
              {latestVersion?.audioAssets.filter(audio => audio.segmentId === 'voice-preview').slice(-1).map(audio => <audio key={audio.id} aria-label="Bản nghe thử giọng" controls preload="none" src={`/api/v1/media/${audio.mediaAsset.id}`} />)}
            </div>
            <div hidden={editorStep !== 2} className="studio-control-section"><h3>Phụ đề</h3><div className="caption-choices" role="group" aria-label="Mẫu phụ đề">{(['ClassicCaption','KaraokeHighlight'] as const).map(preset => <button key={preset} type="button" className={`caption-choice ${subtitlePreset === preset ? 'selected' : ''}`} aria-pressed={subtitlePreset === preset} onClick={() => setSubtitlePreset(preset)}><span>{preset === 'KaraokeHighlight' ? <>Một <mark>câu chuyện</mark> hay</> : 'Một câu chuyện hay'}</span><small>{preset === 'KaraokeHighlight' ? 'Tô sáng từng từ' : 'Phụ đề rõ nét'}</small></button>)}</div><input type="hidden" name="subtitlePreset" value={subtitlePreset} />
              <div className="studio-form-row"><label>Cỡ chữ<select value={mediaSettings.captionSize} onChange={event => setMediaSettings(current => ({ ...current, captionSize: Number(event.target.value) }))}>{[44,52,58,64,72, ...([44,52,58,64,72].includes(mediaSettings.captionSize) ? [] : [mediaSettings.captionSize])].map(size => <option key={size} value={size}>{size}px</option>)}</select></label><label>Màu chữ<input type="color" value={mediaSettings.captionColor} onChange={event => setMediaSettings(current => ({ ...current, captionColor: event.target.value }))} /></label><label>Vị trí phụ đề<select value={mediaSettings.captionPosition} onChange={event => setMediaSettings(current => ({ ...current, captionPosition: event.target.value as 'BOTTOM' | 'CENTER' }))}><option value="BOTTOM">Phía dưới</option><option value="CENTER">Giữa khung</option></select></label></div>
            </div>
            <div hidden={editorStep !== 2} className="studio-control-section"><h3>Nền & âm nhạc</h3>{backgrounds.error && <ErrorNotice message={backgrounds.error} retry={backgrounds.reload} />}{music.error && <ErrorNotice message={music.error} retry={music.reload} />}
              <StudioMediaCatalog disabled={busy || processing} onInstalled={(items, select) => { backgrounds.reload(); music.reload(); const item = select ? items[0] : undefined; if (item?.kind === 'BACKGROUND') { setSelectedBackground(item.id); setMediaSettings(current => ({ ...current, backgroundStartSec: 0 })); } else if (item) setMediaSettings(current => ({ ...current, musicAssetId: item.id })); }} />
              <div className="studio-form-row"><label>Ảnh / video nền<select value={selectedBackground} onChange={event => { setSelectedBackground(event.target.value); setMediaSettings(current => ({ ...current, backgroundStartSec: 0 })); }}><option value="">Nền mặc định</option>{backgrounds.data?.items.map(asset => <option key={asset.id} value={asset.id}>{asset.mimeType === 'video/mp4' ? '▶ ' : ''}{asset.metadata?.name || asset.id.slice(0,8)}</option>)}</select></label>{selectedBackgroundAsset?.mimeType === 'video/mp4' && <label>Bắt đầu nền (giây)<input type="number" min="0" max={Math.max(0, (selectedBackgroundAsset.metadata?.durationMs ?? 1000) / 1000 - 1)} step="0.1" value={mediaSettings.backgroundStartSec} onChange={event => setMediaSettings(current => ({ ...current, backgroundStartSec: Number(event.target.value) }))} /><small className="field-help">Lặp từ điểm này; tắt tiếng video gốc.</small></label>}</div>
              {selectedBackgroundAsset && <figure className="studio-selected-background"><figcaption>Nền đang chọn · {selectedBackgroundAsset.metadata?.name || 'Nền của bạn'}</figcaption>{selectedBackgroundAsset.mimeType === 'video/mp4' ? <video key={`${selectedBackground}:${mediaSettings.backgroundStartSec}`} aria-label="Xem trước nền đang chọn" src={`/api/v1/media/${selectedBackground}#t=${mediaSettings.backgroundStartSec}`} controls autoPlay muted loop playsInline /> : <img src={`/api/v1/media/${selectedBackground}`} alt="Xem trước nền đang chọn" />}</figure>}
              <label>Nhạc nền<select value={mediaSettings.musicAssetId ?? ''} onChange={event => setMediaSettings(current => ({ ...current, musicAssetId: event.target.value || null }))}><option value="">Không có nhạc</option>{music.data?.items.map(asset => <option key={asset.id} value={asset.id}>{asset.metadata?.name || asset.id.slice(0,8)}</option>)}</select></label>
              {mediaSettings.musicAssetId && <><audio ref={selectedMusicPlayer} key={mediaSettings.musicAssetId} aria-label="Nghe nhạc nền" controls autoPlay onPlay={event => playOneAudio(event.currentTarget)} src={`/api/v1/media/${mediaSettings.musicAssetId}`} /><label>Âm lượng nhạc · {Math.round(mediaSettings.musicVolume * 100)}%<input aria-label="Âm lượng nhạc" type="range" min="0" max="0.5" step="0.01" value={mediaSettings.musicVolume} onChange={event => setMediaSettings(current => ({ ...current, musicVolume: Number(event.target.value) }))} /></label><label className="checkbox-label"><input type="checkbox" checked={mediaSettings.ducking} onChange={event => setMediaSettings(current => ({ ...current, ducking: event.target.checked }))} /><span>Giảm nhạc khi có lời đọc</span></label></>}
            </div>
            <details hidden={editorStep !== 2} className="studio-advanced"><summary>Bố cục và quyền riêng tư</summary><div className="studio-form-row"><label>Mẫu bố cục<select name="templateId" value={templateId} onChange={event => setTemplateId(event.target.value as typeof templateId)}>{templates.data?.items.filter(item => item.status === 'READY').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Phong cách kể<select name="style" value={style} onChange={event => setStyle(event.target.value as typeof style)}><option value="STORYTELLING">Kể chuyện</option><option value="SOCIAL_COMMENTARY">Bình luận xã hội</option></select></label><label>Giao diện thẻ<select name="theme" value={theme} onChange={event => setTheme(event.target.value as typeof theme)}><option value="dark">Tối</option><option value="light">Sáng</option></select></label></div><label className="checkbox-label"><input type="checkbox" checked={anonymizeAuthors} onChange={event => setAnonymizeAuthors(event.target.checked)} /><span>Che tên và avatar trong video</span></label><label className="checkbox-label"><input type="checkbox" checked={showEngagement} onChange={event => setShowEngagement(event.target.checked)} /><span>Hiện số tương tác đã có trên thẻ dựng</span></label><p className="field-help">Ảnh chụp gốc giữ nguyên số tương tác và nội dung. Chế độ thẻ chỉ dùng khi nguồn không có ảnh chụp.</p></details>
            <button hidden={editorStep !== 0 && Boolean(latestVersion)} className="button" disabled={!compatibleProfiles.length || processing || dirty || Boolean(source?.lifecycle.blockedReason)}>{latestVersion ? 'Soạn lại từ bình luận đã chọn' : 'Tạo bản nháp kịch bản'} →</button>
          </fieldset></form>}
        </section>}
        {canEdit && <><div hidden={editorStep !== 1}><VoiceLibrary enabled={profiles.data?.items.some(profile => profile.provider === 'vieneu') ?? false} onCreated={id => { setPendingVoiceId(id); profiles.reload(); }} /></div><div hidden={editorStep !== 2}><StudioAssetUpload disabled={processing} onUploaded={(kind,id) => { if (kind === 'BACKGROUND') { setSelectedBackground(id); setMediaSettings(current => ({ ...current, backgroundStartSec: 0 })); backgrounds.reload(); } else { setMediaSettings(current => ({ ...current, musicAssetId: id })); music.reload(); } }} /></div></>}
        <section hidden={editorStep !== 3} className="studio-export-summary"><h2>Xuất video về máy</h2><p>Kiểm tra bản xem trước, rồi bấm “Tạo video MP4”. Sau khi hoàn tất, bản MP4 sẽ xuất hiện ở phần duyệt phía trên và trong “Video của bạn”.</p><dl><div><dt>Nội dung</dt><dd>{story?.post.title || selectedCandidate?.post.title || 'Bài đã chọn'}</dd></div><div><dt>Lời đọc</dt><dd>{compatibleProfiles.find(profile => profile.id === voiceProfileId)?.name || 'Chưa chọn giọng'}</dd></div><div><dt>Định dạng</dt><dd>MP4 · 1080 × 1920 · 30fps</dd></div></dl>{video?.mediaAsset && <Link className="button secondary" href="#video-review">Xem và duyệt bản MP4</Link>}</section>
        {latestVersion && <div className="studio-step-actions"><button type="button" className="text-button" disabled={editorStep === 0} onClick={() => setEditorStep(step => Math.max(0, step - 1))}>Quay lại</button>{editorStep < 3 && <button type="button" className="button secondary" onClick={() => setEditorStep(step => Math.min(3, step + 1))}>{editorStep === 0 ? 'Tiếp: Lời đọc' : editorStep === 1 ? 'Tiếp: Nền & nhạc' : 'Tiếp: Xuất video'}</button>}</div>}
      </div>
      <aside className="studio-preview-column">
        {video?.mediaAsset && <Link className="button" href="#video-review">Xem và duyệt bản MP4 đã tạo ↑</Link>}
        {story && latestVersion && previewScript ? <StudioDraftPreview backgroundPending={Boolean(selectedBackground && !selectedBackgroundAsset)} recorded={recordedPreview} onStatus={setPreviewProblem} post={story.post} storyId={story.id} versionId={latestVersion.id} script={previewScript} speakingRate={speakingRate} templateId={templateId} subtitlePreset={subtitlePreset} theme={theme} anonymizeAuthors={anonymizeAuthors} showEngagement={showEngagement} backgroundAssetId={selectedBackground || null} backgroundDurationMs={selectedBackgroundAsset?.mimeType === 'video/mp4' ? selectedBackgroundAsset.metadata?.durationMs : undefined} mediaSettings={mediaSettings} attribution={{ required: story.post.rights?.[0]?.attributionRequired ?? false, text: story.post.rights?.[0]?.attributionText ?? null }} /> : <section className="panel studio-live-preview" id="studio-live-preview"><div className="preview-heading"><div><h2>Video của bạn</h2></div><span className="badge neutral">9:16</span></div><div className="preview-placeholder"><span>▶</span><strong>Câu chuyện bắt đầu từ đây</strong><p>Chọn bình luận và soạn bản nháp để xem bố cục video.</p></div></section>}
        {latestVersion && canEdit && <section className="panel studio-export-bar"><h3>{processing ? humanStage(run?.currentStage ?? null) : dirty ? 'Lưu bản chỉnh sửa trước' : renderBlockers.length ? 'Cần kiểm tra thiết lập' : 'Sẵn sàng dựng video'}</h3><p className="field-help">MP4 · 1080 × 1920 · 30fps · lưu ở máy local</p>{renderBlockers.length > 0 && <ul className="export-blockers" id="studio-render-blockers">{renderBlockers.map(reason => <li key={reason}>{reason}</li>)}</ul>}<button className="button" onClick={() => void renderLatest()} disabled={busy || processing || renderBlockers.length > 0} aria-describedby={renderBlockers.length ? 'studio-render-blockers' : undefined}>{processing ? 'Đang xử lý…' : 'Tạo video MP4'}</button></section>}
        {run && <details className="panel studio-run" open={processing || run.status.startsWith('FAILED') || run.status.startsWith('BLOCKED')}><summary className="studio-progress-summary">Tiến độ · {run.status === 'CANCELLED' ? 'Đã hủy' : humanStage(run.currentStage)}</summary><div className="studio-run-content"><p>{run.status.replaceAll('_',' ')}</p><progress max="1" value={run.renderJob?.progress ?? 0} aria-label="Production progress" /><ol className="stage-list">{run.stages.map(stage => <li key={stage.name} className={stage.status === 'SUCCEEDED' ? 'done' : ''}><span>{humanStage(stage.name)}</span><span>{stage.status}</span></li>)}</ol>{run.errorCode && <p className="notice error">{mediaFailureMessage(run.errorCode)}</p>}{mayAdmin(role) && run.status.startsWith('FAILED') && <button className="button secondary small" onClick={() => void retryFailedRun()} disabled={busy}>Thử lại lượt lỗi</button>}{processing && <><label className="checkbox-label"><input type="checkbox" checked={confirmCancel} onChange={event => setConfirmCancel(event.target.checked)} /><span>Xác nhận hủy lượt đang chạy</span></label><button className="button secondary small" disabled={busy || !confirmCancel} onClick={() => void cancelRun()}>Hủy lượt xử lý</button></>}</div></details>}
        {durationFit.success && <p className="notice" role="status">Lời đọc: {(durationFit.data.durationMs/1000).toFixed(1)} / {durationFit.data.targetDurationSec} giây. {alignedCaptions ? 'Đã căn phụ đề theo audio.' : 'Đang chờ căn phụ đề.'}</p>}
      </aside>
    </div>
  </>;
}
