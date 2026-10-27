import type { CSSProperties, ReactNode } from 'react';

export type SocialPlatform = 'REDDIT' | 'THREADS' | 'FACEBOOK' | 'MANUAL';
export type CardTheme = 'dark' | 'light';
interface BaseCardProps {
  body: string;
  authorAlias?: string | null;
  title?: string | null;
  theme?: CardTheme;
  anonymizeAuthors?: boolean;
  attribution?: string | null;
  likes?: number | null;
  showEngagement?: boolean;
  highlighted?: boolean;
}

const platformStyle: Record<SocialPlatform, { label: string; accent: string; icon: string }> = {
  REDDIT: { label: 'REDDIT STORY', accent: '#ff7043', icon: 'r/' },
  THREADS: { label: 'THREADS STORY', accent: '#e5e7eb', icon: '@' },
  FACEBOOK: { label: 'FACEBOOK STORY', accent: '#72a7ff', icon: 'f' },
  MANUAL: { label: 'SOURCE STORY', accent: '#b1d4bc', icon: 'Aa' },
};

function color(theme: CardTheme) {
  return theme === 'dark'
    ? { panel: 'rgba(15, 21, 25, 0.95)', border: 'rgba(255,255,255,0.15)', text: '#f4f7f4', muted: '#bac5bf', soft: '#252f33' }
    : { panel: 'rgba(255, 255, 255, 0.97)', border: 'rgba(23,51,38,0.16)', text: '#18231d', muted: '#5b6c62', soft: '#edf3ee' };
}

function Author({ alias, anonymize, palette }: { alias?: string | null; anonymize: boolean; palette: ReturnType<typeof color> }) {
  const display = anonymize ? 'Community member' : alias?.trim() || 'Community member';
  return <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
    <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 48, height: 48, flex: '0 0 48px', borderRadius: 24, background: palette.soft, color: palette.text, fontWeight: 700, fontSize: 21 }}>{display.slice(0, 1).toUpperCase()}</span>
    <span style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 650, fontSize: 24, color: palette.text }}>{display}</span>
  </div>;
}

function CardShell({ platform, theme = 'dark', children, title, attribution, highlighted }: { platform: SocialPlatform; theme?: CardTheme; children: ReactNode; title?: string | null; attribution?: string | null; highlighted?: boolean }) {
  const brand = platformStyle[platform];
  const palette = color(theme);
  const style: CSSProperties = {
    width: '100%', maxWidth: 900, maxHeight: 1000, overflow: 'hidden', boxSizing: 'border-box',
    borderRadius: 34, padding: '34px 38px 32px', color: palette.text,
    background: palette.panel, border: `${highlighted ? 3 : 1}px solid ${highlighted ? brand.accent : palette.border}`,
    boxShadow: '0 28px 90px rgba(0,0,0,0.28)', backdropFilter: 'blur(18px)',
  };
  return <article aria-label={`${brand.label} stylized content card`} style={style}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, marginBottom: 27 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}><span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 47, height: 47, borderRadius: 15, background: brand.accent, color: platform === 'THREADS' && theme === 'dark' ? '#121416' : '#fff', fontWeight: 800, fontSize: 18 }}>{brand.icon}</span><span style={{ color: palette.muted, fontSize: 17, letterSpacing: 2.1, fontWeight: 700 }}>{brand.label}</span></div>
      {title && <span style={{ color: brand.accent, fontSize: 17, fontWeight: 750, textTransform: 'uppercase', letterSpacing: 1.5 }}>SOURCE POST</span>}
    </header>
    {title && <h2 style={{ color: palette.text, fontSize: 37, lineHeight: 1.18, letterSpacing: -0.7, fontWeight: 750, margin: '0 0 21px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{title}</h2>}
    {children}
    {attribution && <footer style={{ borderTop: `1px solid ${palette.border}`, paddingTop: 17, marginTop: 23, color: palette.muted, fontSize: 17, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{attribution}</footer>}
    <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>Stylized presentation, not an official platform screen.</span>
  </article>;
}

function PostCard({ platform, body, authorAlias, theme = 'dark', anonymizeAuthors = true, title, attribution, likes, showEngagement = true }: BaseCardProps & { platform: SocialPlatform }) {
  const palette = color(theme);
  return <CardShell platform={platform} theme={theme} title={title} attribution={attribution}>
    <Author alias={authorAlias} anonymize={anonymizeAuthors} palette={palette} />
    <p style={{ color: palette.text, fontSize: 33, lineHeight: 1.43, margin: '22px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: title ? 8 : 12, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{body}</p>
    {showEngagement && likes !== undefined && likes !== null && <p style={{ color: palette.muted, fontSize: 19, margin: '24px 0 0' }}>{likes.toLocaleString()} reactions</p>}
  </CardShell>;
}

function CommentCard({ platform, body, authorAlias, theme = 'dark', anonymizeAuthors = true, attribution, likes, showEngagement = true, highlighted }: BaseCardProps & { platform: SocialPlatform }) {
  const palette = color(theme);
  return <CardShell platform={platform} theme={theme} attribution={attribution} highlighted={highlighted}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 17, marginBottom: 16 }}><span style={{ width: 5, height: 42, flex: '0 0 5px', background: platformStyle[platform].accent, borderRadius: 5 }} /><Author alias={authorAlias} anonymize={anonymizeAuthors} palette={palette} /></div>
    <p style={{ color: palette.text, fontSize: 36, lineHeight: 1.42, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 11, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>“{body}”</p>
    {showEngagement && likes !== undefined && likes !== null && <p style={{ color: palette.muted, fontSize: 19, margin: '22px 0 0' }}>{likes.toLocaleString()} reactions</p>}
  </CardShell>;
}

export function RedditPostCard(props: BaseCardProps) { return <PostCard {...props} platform="REDDIT" />; }
export function RedditCommentCard(props: BaseCardProps) { return <CommentCard {...props} platform="REDDIT" />; }
export function ThreadsPostCard(props: BaseCardProps) { return <PostCard {...props} platform="THREADS" />; }
export function ThreadsCommentCard(props: BaseCardProps) { return <CommentCard {...props} platform="THREADS" />; }
export function FacebookPostCard(props: BaseCardProps) { return <PostCard {...props} platform="FACEBOOK" />; }
export function FacebookCommentCard(props: BaseCardProps) { return <CommentCard {...props} platform="FACEBOOK" />; }
export function ManualPostCard(props: BaseCardProps) { return <PostCard {...props} platform="MANUAL" />; }
export function ManualCommentCard(props: BaseCardProps) { return <CommentCard {...props} platform="MANUAL" />; }
