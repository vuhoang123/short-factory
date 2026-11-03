'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { StoryComposition } from '@shorts-factory/media/composition';
import { sourceImageMetadataSchema, type CompositionInput, type StoryScript } from '@shorts-factory/media/contracts';
import { applyRecordedAudio, buildRenderManifest } from '@shorts-factory/media/manifest-data';
import { type StudioMediaSettings } from '@shorts-factory/media/studio-settings';
import { z } from 'zod';
import { useResource } from '../lib/use-resource';
import { ErrorNotice } from './feedback';

const imagesSchema = z.object({ captured: z.boolean().optional(), items: z.array(z.object({ id: z.string().uuid(), checksum: z.string().optional(), metadata: sourceImageMetadataSchema })) });
export interface DraftPreviewProps {
  post: { id: string; title: string | null; body: string; authorAlias?: string | null; platform: string };
  storyId: string; versionId: string; script: StoryScript; speakingRate: number;
  templateId: 'RedditStory' | 'SocialCommentary'; subtitlePreset: 'ClassicCaption' | 'KaraokeHighlight'; theme: 'dark' | 'light'; anonymizeAuthors: boolean; showEngagement: boolean;
  backgroundAssetId: string | null; backgroundDurationMs?: number; mediaSettings: StudioMediaSettings;
  attribution?: { required: boolean; text: string | null };
  onStatus: (problem: string) => void;
  recorded?: CompositionInput;
  backgroundPending?: boolean;
}

export function StudioDraftPreview(props: DraftPreviewProps) {
  const images = useResource(`/posts/${props.post.id}/source-images`, imagesSchema);
  const player = useRef<PlayerRef>(null);
  const result = useMemo(() => {
    if (!images.data || props.backgroundPending) return null;
    try {
      const refs = new Set([`post:${props.post.id}`, ...props.script.segments.flatMap(segment => segment.sourceRefs.filter(ref => ref.startsWith('comment:')))]);
      const captured = images.data.captured || images.data.items.length > 0;
      const sourceImages = captured ? [...refs].map(ref => {
        const matches = images.data!.items.filter(image => image.metadata.sourceRef === ref && image.metadata.variant === (props.anonymizeAuthors ? 'ANONYMIZED' : 'ORIGINAL'));
        if (matches.length !== 1) throw new Error('Thiếu ảnh khớp với bài/bình luận ở chế độ che tên đã chọn. Kiểm tra hoặc chụp lại nguồn.');
        const image = matches[0]!;
        return { assetId: image.id, checksum: image.checksum ?? '0'.repeat(64), sourceRef: ref, width: image.metadata.width, height: image.metadata.height, anonymized: props.anonymizeAuthors };
      }) : undefined;
      const startFrame = Math.floor(props.mediaSettings.backgroundStartSec * 30);
      const totalFrames = props.backgroundDurationMs ? Math.ceil(props.backgroundDurationMs / 1000 * 30) : 0;
      if (props.backgroundAssetId && totalFrames && startFrame >= totalFrames) throw new Error('Điểm bắt đầu nằm ngoài video nền. Chọn thời gian nhỏ hơn độ dài của nền.');
      const { manifest } = buildRenderManifest({
        storyProjectId: props.storyId, storyVersionId: props.versionId, storyVersion: props.script.version,
        sourcePostId: props.post.id, platform: z.enum(['MANUAL', 'FACEBOOK', 'THREADS', 'REDDIT']).parse(props.post.platform), script: props.script,
        templateId: props.templateId, backgroundAssetId: props.backgroundAssetId, subtitlePreset: props.subtitlePreset,
        attribution: props.attribution ?? { required: false, text: null },
        visualSettings: { theme: props.theme, anonymizeAuthors: props.anonymizeAuthors, showEngagement: props.showEngagement },
        audioAssets: props.script.segments.map(segment => ({ assetId: props.versionId, segmentId: segment.id, durationMs: Math.max(500, Math.round(segment.text.trim().split(/\s+/u).length / (2.8 * props.speakingRate) * 1000)) })),
        mediaSettings: props.mediaSettings,
        ...(sourceImages ? { sourceImages } : {}), ...(totalFrames ? { backgroundVideo: { durationFrames: totalFrames, startFrame } } : {}),
      });
      const input: CompositionInput = {
        manifest, post: { title: props.post.title, body: props.post.body, authorAlias: props.post.authorAlias ?? null }, comments: [],
        audioSources: props.recorded?.audioSources ?? {}, backgroundSrc: props.backgroundAssetId ? `/api/v1/media/${props.backgroundAssetId}` : null,
        musicSrc: props.mediaSettings.musicAssetId ? `/api/v1/media/${props.mediaSettings.musicAssetId}` : null,
        ...(sourceImages ? { sourceImageSources: Object.fromEntries(sourceImages.map(image => [image.assetId, `/api/v1/media/${image.assetId}`])) } : {}),
      };
      return { input: props.recorded ? applyRecordedAudio(input, props.recorded) : input, error: null };
    } catch (failure) { return { input: null, error: failure instanceof Error ? failure.message : 'Chưa thể tạo preview. Kiểm tra ảnh nguồn và thiết lập.' }; }
  }, [images.data, props]);
  const problem = images.error ? 'Không tải được ảnh nguồn. Thử tải lại preview.' : !result ? 'Đang tải ảnh và nền để kiểm tra preview…' : result.error ?? '';
  useEffect(() => { props.onStatus(problem); }, [problem, props.onStatus]);
  return <section className="panel studio-live-preview" id="studio-live-preview" aria-label="Xem trước bố cục video">
    <div className="preview-heading"><div><span className="eyebrow">XEM TRƯỚC</span><h2>Video của bạn</h2></div><span className="badge neutral">9:16 · 1080p</span></div>
    {images.error ? <ErrorNotice message={images.error} retry={images.reload} /> : !result ? <p role="status">Đang tải ảnh nguồn…</p> : result.error ? <ErrorNotice message={result.error} /> : result.input && <>
      <div className="preview-stage"><Player ref={player} component={StoryComposition} inputProps={result.input} durationInFrames={result.input.manifest.durationFrames} compositionWidth={1080} compositionHeight={1920} fps={30} controls initialFrame={8} style={{ width: '100%', aspectRatio: '9 / 16' }} errorFallback={() => <div className="notice error">Không đọc được ảnh hoặc video nền. Kiểm tra file và tải lại preview.</div>} /></div>
      <nav className="preview-scenes" aria-label="Xem từng cảnh">{result.input.manifest.visualSegments.map((segment, index) => <button key={segment.id} type="button" className="button secondary small" onClick={() => { player.current?.pause(); player.current?.seekTo(Math.min(segment.startFrame + 8, segment.endFrame - 1)); }}>Cảnh {index + 1}</button>)}</nav>
      <p className="field-help">{props.recorded ? 'Dùng lời đọc và thời gian của bản đã xuất. Nếu đổi kiểu phụ đề, timing từng từ sẽ được căn lại khi xuất.' : 'Bố cục dùng cùng bộ dựng MP4. Thời gian và phụ đề đang tạm tính; lời đọc sẽ được tạo và căn khi xuất.'} Nhạc có thể nghe trong preview.</p>
    </>}
  </section>;
}
