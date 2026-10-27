import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CompositionInput } from './contracts';
import { FacebookCommentCard, FacebookPostCard, ManualCommentCard, ManualPostCard, RedditCommentCard, RedditPostCard, ThreadsCommentCard, ThreadsPostCard, type CardTheme } from './cards';
import { subtitlePresets } from './subtitles';

function selectPostCard(platform: CompositionInput['manifest']['platform']) {
  if (platform === 'REDDIT') return RedditPostCard;
  if (platform === 'THREADS') return ThreadsPostCard;
  if (platform === 'FACEBOOK') return FacebookPostCard;
  return ManualPostCard;
}
function selectCommentCard(platform: CompositionInput['manifest']['platform']) {
  if (platform === 'REDDIT') return RedditCommentCard;
  if (platform === 'THREADS') return ThreadsCommentCard;
  if (platform === 'FACEBOOK') return FacebookCommentCard;
  return ManualCommentCard;
}

function Background({ src }: { src: string | null }) {
  return <AbsoluteFill style={{ background: 'linear-gradient(140deg,#1c3329 0%,#182429 48%,#31453b 100%)' }}>
    {src && <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.42) saturate(0.82)' }} />}
    <AbsoluteFill style={{ background: 'linear-gradient(180deg,rgba(2,12,9,0.24),rgba(2,12,9,0.56))' }} />
  </AbsoluteFill>;
}

function SegmentCard({ input, segmentId, templateId }: { input: CompositionInput; segmentId: string; templateId: CompositionInput['manifest']['templateId'] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const segment = input.manifest.visualSegments.find((candidate) => candidate.id === segmentId);
  if (!segment) return null;
  const motion = spring({ frame, fps, config: { damping: 19, stiffness: 120, mass: 0.7 } });
  const opacity = interpolate(frame, [0, 8, 18], [0, 1, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const translateX = interpolate(motion, [0, 1], [templateId === 'RedditStory' ? 54 : 0, 0]);
  const translateY = interpolate(motion, [0, 1], [templateId === 'SocialCommentary' ? 56 : 36, 0]);
  const scale = interpolate(motion, [0, 1], [0.94, 1]);
  const platform = input.manifest.platform;
  const theme: CardTheme = input.manifest.visualSettings.theme;
  const shared = { theme, anonymizeAuthors: input.manifest.visualSettings.anonymizeAuthors, showEngagement: input.manifest.visualSettings.showEngagement };
  const attribution = input.manifest.attribution.required ? input.manifest.attribution.text : null;
  const cardStyle = { opacity, transform: `translate(${translateX}px, ${translateY}px) scale(${scale})` };

  if (segment.type === 'COMMENT') {
    const commentId = segment.sourceRefs.find((ref) => ref.startsWith('comment:'))?.slice('comment:'.length);
    const comment = input.comments.find((candidate) => candidate.id === commentId);
    const Card = selectCommentCard(platform);
    return <div style={cardStyle}><Card {...shared} body={comment?.body ?? segment.text} authorAlias={comment?.authorAlias} attribution={attribution} highlighted /></div>;
  }

  if (segment.type === 'POST' || segment.type === 'HOOK') {
    const Card = selectPostCard(platform);
    const body = segment.type === 'POST' ? segment.text : input.post.title ?? segment.text;
    return <div style={cardStyle}><Card {...shared} title={segment.type === 'POST' ? input.post.title : 'THE STORY'} body={body} authorAlias={input.post.authorAlias} attribution={attribution} /></div>;
  }

  const palette = theme === 'dark' ? { color: '#f4f7f4', bg: 'rgba(12,19,17,0.88)', muted: '#d0dbd4' } : { color: '#18231d', bg: 'rgba(255,255,255,0.94)', muted: '#52655a' };
  return <div style={{ ...cardStyle, boxSizing: 'border-box', width: 900, padding: '54px 58px', borderRadius: 34, color: palette.color, background: palette.bg, boxShadow: '0 28px 90px rgba(0,0,0,0.28)', textAlign: 'center' }}>
    <div style={{ fontSize: 20, letterSpacing: 3, color: palette.muted, textTransform: 'uppercase', fontWeight: 750 }}>{segment.type === 'OUTRO' ? 'YOUR TURN' : segment.type === 'TRANSITION' ? 'SELECTED COMMENT' : 'STORY CONTEXT'}</div>
    <div style={{ fontSize: 44, lineHeight: 1.3, fontWeight: 720, marginTop: 27, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{segment.text}</div>
    {templateId === 'SocialCommentary' && input.manifest.visualSettings.anonymizeAuthors && <div style={{ fontSize: 17, color: palette.muted, marginTop: 25 }}>Source details are minimized</div>}
  </div>;
}

function SubtitleOverlay({ input }: { input: CompositionInput }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const cue = input.manifest.subtitleTimeline.find((item) => nowMs >= item.startMs && nowMs < item.endMs);
  if (!cue) return null;
  const preset = subtitlePresets[input.manifest.subtitlePreset];
  const theme = input.manifest.visualSettings.theme;
  const background = theme === 'dark' ? preset.background : 'rgba(10, 16, 21, 0.82)';
  return <div style={{ position: 'absolute', left: 70, right: 70, bottom: 205, display: 'flex', justifyContent: 'center', padding: '18px 26px', borderRadius: 18, background, color: preset.color, fontSize: preset.fontSize, lineHeight: 1.18, fontWeight: 850, textAlign: 'center', textShadow: '0 3px 6px rgba(0,0,0,0.6)', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
    {cue.words ? <span>{cue.words.map((word, index) => <span key={`${cue.id}-${index}`} style={{ color: nowMs >= word.startMs && nowMs < word.endMs ? preset.highlightColor : preset.color, marginInlineEnd: 11 }}>{word.text}</span>)}</span> : cue.text}
  </div>;
}

export function StoryComposition(input: CompositionInput) {
  const duration = input.manifest.durationFrames;
  return <AbsoluteFill style={{ overflow: 'hidden', fontFamily: 'Arial, "Noto Sans", sans-serif' }}>
    <Background src={input.backgroundSrc} />
    {input.manifest.visualSegments.map((segment) => <Sequence key={segment.id} from={segment.startFrame} durationInFrames={Math.max(1, segment.endFrame - segment.startFrame)}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: segment.type === 'HOOK' ? 'center' : 'center', padding: '120px 82px 390px', boxSizing: 'border-box' }}>
        <SegmentCard input={input} segmentId={segment.id} templateId={input.manifest.templateId} />
      </AbsoluteFill>
    </Sequence>)}
    {input.manifest.audioAssets.map((asset) => {
      const src = input.audioSources[asset.assetId];
      return src ? <Sequence key={asset.assetId} from={asset.startFrame} durationInFrames={Math.min(asset.durationFrames, duration - asset.startFrame)}><Audio src={src} volume={input.manifest.audioLevels.narration} /></Sequence> : null;
    })}
    <SubtitleOverlay input={input} />
    {input.manifest.attribution.required && input.manifest.attribution.text && <div style={{ position: 'absolute', bottom: 80, left: 60, right: 60, color: '#fff', fontSize: 18, textAlign: 'center', textShadow: '0 2px 5px #000', overflowWrap: 'anywhere' }}>{input.manifest.attribution.text}</div>}
  </AbsoluteFill>;
}
