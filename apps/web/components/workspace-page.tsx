'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api, errorMessage } from '../lib/api';
import { auditSchema, candidateSchema, channelSchema, commentSchema, dashboardSchema, eligibilitySchema, mayAdmin, mayEdit, mayReview, paginated, postSchema, roleSchema, sourceSchema, syncRunSchema, topicRuleSchema, unknownResponseSchema, type Post, type Source } from '../lib/contracts';
import { exampleImport, prepareManualImport } from '../lib/manual-import';
import { useSession, WorkspaceForm } from './app-shell';
import { EmptyState, ErrorNotice, StatusBadge } from './feedback';

type View = 'dashboard' | 'channels' | 'sources' | 'library' | 'reviews' | 'settings';
const pageCopy: Record<View, { title: string; description: string }> = {
  dashboard: { title: 'Workspace overview', description: 'Your source material, organized for a careful next step.' },
  channels: { title: 'Content channels', description: 'Give each editorial direction a clear home.' },
  sources: { title: 'Authorized sources', description: 'Keep a record of where your stories come from.' },
  library: { title: 'Post library', description: 'Your imported stories, comments and source provenance.' },
  reviews: { title: 'Content rights reviews', description: 'Verify evidence and permitted use before production.' },
  settings: { title: 'Workspace settings', description: 'Your workspace, access level and audit history.' },
};

function useResource<T extends z.ZodTypeAny>(path: string, schema: T) {
  const [data, setData] = useState<z.infer<T> | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void api(path, schema).then((result) => { if (active) setData(result); }).catch((failure: unknown) => { if (active) setError(errorMessage(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, schema, revision]);
  return { data, error, loading, reload };
}

const channelsListSchema = paginated(channelSchema);
const sourcesListSchema = paginated(sourceSchema);
const postsListSchema = paginated(postSchema);
const commentsListSchema = paginated(commentSchema);
const auditsListSchema = paginated(auditSchema);
const membersListSchema = paginated(z.object({ userId: z.string(), email: z.string(), name: z.string().nullable(), role: roleSchema }));
const importResultSchema = z.object({ postId: z.string(), deduplicated: z.boolean(), warnings: z.array(z.string()) });

export function WorkspacePage({ view }: { view: View }) {
  const copy = pageCopy[view]; const { role } = useSession();
  return <><div className="page-heading"><div><span className="eyebrow">SHORTS FACTORY</span><h1>{copy.title}</h1><p>{copy.description}</p></div>{view === 'dashboard' && mayEdit(role) && <Link className="button" href="/library/posts#import" aria-label="Import a story">Import a story <span aria-hidden="true">＋</span></Link>}</div>
    {view === 'dashboard' && <Dashboard />}{view === 'channels' && <Channels />}{view === 'sources' && <Sources />}{view === 'library' && <LibraryHub />}{view === 'reviews' && <Library reviewMode />}{view === 'settings' && <Settings />}
  </>;
}

function Dashboard() {
  const { data, loading, error, reload } = useResource('/dashboard', dashboardSchema);
  const recent = useResource('/posts?limit=5', postsListSchema);
  if (error) return <ErrorNotice message={error} retry={reload} />;
  if (loading || !data) return <p className="loading-state" role="status">Loading your workspace overview…</p>;
  return <>
    <section className="metrics-grid" aria-label="Workspace statistics">
      {[{ label: 'Imported stories', value: data.counts.posts, detail: `${data.counts.comments} source comments`, mark: '▧' }, { label: 'Awaiting rights review', value: data.counts.pendingRights, detail: 'Human approval required', mark: '✓' }, { label: 'Content channels', value: data.counts.channels, detail: 'Editorial directions', mark: '▤' }, { label: 'Registered sources', value: data.counts.sources, detail: `${data.counts.pendingSources} need provider access`, mark: '↗' }, { label: 'Content candidates', value: data.counts.candidates, detail: 'Scored and rights checked', mark: '◎' }].map((metric) => <article className="metric" key={metric.label}><div><span>{metric.label}</span><span className="metric-mark" aria-hidden="true">{metric.mark}</span></div><strong>{metric.value}</strong><p>{metric.detail}</p></article>)}
    </section>
    <div className="overview-grid">
      <section className="panel latest-posts"><div className="panel-heading"><div><h2>Recent source material</h2><p>Your latest imports and their rights status.</p></div><Link className="text-button" href="/library/posts">View library <span aria-hidden="true">↗</span></Link></div>
        {recent.error ? <ErrorNotice message={recent.error} retry={recent.reload} /> : recent.loading ? <p role="status" className="loading-state">Loading recent stories…</p> : recent.data?.items.length ? <div className="recent-list">{recent.data.items.map((post) => <Link href="/library/posts" key={post.id} className="recent-item"><span className="post-glyph" aria-hidden="true">Aa</span><div><strong>{post.title || 'Untitled story'}</strong><p>{post.platform.toLowerCase()} · {post._count?.comments ?? 0} comments</p></div><StatusBadge value={post.rights[0]?.reviewStatus ?? 'PENDING'} /></Link>)}</div> : <EmptyState title="Your first story starts here">Import a post and its authorized comments to begin building your library.</EmptyState>}
      </section>
      <section className="next-step"><span className="eyebrow">A CAREFUL NEXT STEP</span><h2>{data.counts.pendingRights ? 'Make the rights clear.' : 'Bring your stories together.'}</h2><p>{data.counts.pendingRights ? 'Review the evidence, permitted platforms and commercial scope for your imported material.' : 'Add source material you own or have permission to use. Every import keeps its provenance and needs a rights review.'}</p><Link className="button secondary" href={data.counts.pendingRights ? '/reviews' : '/library/posts#import'}>{data.counts.pendingRights ? 'Open rights reviews' : 'Import source material'} <span aria-hidden="true">→</span></Link><div className="next-step-note"><strong>Public does not mean permitted.</strong><span>Unknown, expired or revoked rights remain blocked.</span></div></section>
    </div>
    <section className="panel"><div className="panel-heading"><div><h2>Discovery readiness</h2><p>What is available in this phase.</p></div><span className="badge neutral">Phase 2</span></div><div className="readiness-grid"><div><span className="readiness-icon" aria-hidden="true">↥</span><h3>Manual source import</h3><p>Authorized text and comments with provenance and rights evidence.</p><StatusBadge value="AVAILABLE" /></div><div><span className="readiness-icon" aria-hidden="true">↗</span><h3>Synthetic demo discovery</h3><p>Deterministic local fixtures demonstrate pagination, scoring and sync history.</p><StatusBadge value="DEMO_ONLY" /></div><div><span className="readiness-icon" aria-hidden="true">⇥</span><h3>Official platform connections</h3><p>Provider permissions and verified adapter implementations are required.</p><StatusBadge value={data.integrations.publishing} /></div></div>
      {data.blockers.length > 0 && <div className="integration-notes">{data.blockers.map((blocker, index) => <p key={`${blocker.code}-${index}`}><strong>{blocker.code.replaceAll('_', ' ')}</strong> {blocker.message}</p>)}</div>}
    </section>
  </>;
}

function Channels() {
  const { role } = useSession(); const resource = useResource('/channels?limit=50', channelsListSchema);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const form = new FormData(element);
    setBusy(true); setError('');
    try { await api('/channels', unknownResponseSchema, { method: 'POST', body: { name: String(form.get('name')), language: String(form.get('language')), minimumCandidateScore: Number(form.get('minimumCandidateScore')), topicConfig: { keywords: String(form.get('keywords')).split(',').map((word) => word.trim()).filter(Boolean) }, automationConfig: { enabled: false } } }); element.reset(); resource.reload(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <div className="split-layout"><section className="panel"><div className="panel-heading"><div><h2>Your channels</h2><p>Automation stays off while the editorial workflow is being built.</p></div></div>{resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading ? <p role="status" className="loading-state">Loading channels…</p> : resource.data?.items.length ? <div className="channel-grid">{resource.data.items.map((channel) => <article key={channel.id} className="channel-item"><span className="channel-initial" aria-hidden="true">{channel.name.slice(0, 1).toUpperCase()}</span><h3>{channel.name}</h3><p>Language: {channel.language}</p><span className="badge neutral">Manual review</span></article>)}</div> : <EmptyState title="Create a content channel">Organize stories by topic, language or editorial direction.</EmptyState>}</section>
    {mayAdmin(role) ? <section className="panel form-panel"><h2>Add a channel</h2><p className="muted">Start with one editorial direction.</p>{error && <ErrorNotice message={error} />}<form className="form-stack" onSubmit={create}><label>Channel name<input name="name" maxLength={100} required placeholder="Everyday stories" /></label><label>Language<input name="language" defaultValue="vi" required maxLength={20} /></label><label>Topic keywords<textarea name="keywords" rows={3} placeholder="work, community, everyday life" maxLength={2000} /></label><p className="field-help">Separate keywords with commas.</p><label>Minimum candidate score<input type="number" name="minimumCandidateScore" min={0} max={100} step={1} defaultValue={55} /></label><button className="button" disabled={busy}>{busy ? 'Creating…' : 'Create channel'}</button></form></section> : <div className="notice">An owner or admin can create channels.</div>}
  </div>;
}

function Sources() {
  const { role } = useSession(); const resource = useResource('/sources?limit=50', sourcesListSchema); const channels = useResource('/channels?limit=100', channelsListSchema);
  const [platform, setPlatform] = useState('MANUAL'); const [mode, setMode] = useState('USER_SUPPLIED'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null); const [historyId, setHistoryId] = useState('');
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); setBusy(true); setError('');
    try {
      const manual = platform === 'MANUAL';
      await api('/sources', unknownResponseSchema, { method: 'POST', body: {
        platform, sourceKey: String(form.get('sourceKey')), channelId: form.get('channelId') || undefined,
        enabled: manual && form.get('enabled') === 'on', syncFrequencyMinutes: Number(form.get('syncFrequencyMinutes')),
        config: { mode: manual ? mode : 'USER_SUPPLIED', keywords: csv(form.get('keywords')), hashtags: csv(form.get('hashtags')), topics: csv(form.get('topics')), language: String(form.get('language') || '') || undefined, retainRawPayload: false },
      } });
      element.reset(); resource.reload();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function action(source: Source, kind: 'verify' | 'sync' | 'toggle' | 'delete') {
    setError(''); setBusy(true);
    try {
      if (kind === 'verify') await api(`/sources/${source.id}/verify`, unknownResponseSchema, { method: 'POST', body: {} });
      if (kind === 'sync') await api(`/sources/${source.id}/sync`, unknownResponseSchema, { method: 'POST' });
      if (kind === 'toggle') await api(`/sources/${source.id}`, unknownResponseSchema, { method: 'PATCH', body: { enabled: !source.enabled } });
      if (kind === 'delete') await api(`/sources/${source.id}`, unknownResponseSchema, { method: 'DELETE' });
      resource.reload();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <><div className="notice"><strong>Use permitted material.</strong><span>Manual imports and synthetic demo fixtures are available. Reddit, Threads and Facebook stay disabled until verified official API or licensed provider access is implemented.</span></div>
    {error && <ErrorNotice message={error} />}
    <div className="split-layout"><section className="panel"><div className="panel-heading"><div><h2>Source registry</h2><p>Access checks, sync history and source health for this workspace.</p></div><button className="text-button" onClick={resource.reload}>Refresh</button></div>
      {resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading ? <p className="loading-state" role="status">Loading sources…</p> : resource.data?.items.length ? <div className="table-scroll"><table><caption className="sr-only">Registered content sources</caption><thead><tr><th>Source</th><th>Access and sync</th><th>Last run</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{resource.data.items.map(source => {
        const demo = source.config?.mode === 'MOCK_FIXTURE';
        const lastStatus = source.lastSyncStatus && source.lastSyncStatus !== 'NEVER' ? source.lastSyncStatus : null;
        return <tr key={source.id}><td><strong>{source.sourceKey}</strong><span className="cell-detail">{source.platform.toLowerCase()}{source.channel ? ` · ${source.channel.name}` : ''}{demo ? ' · synthetic demo' : ''}</span><span className="cell-detail">{source.enabled ? 'Enabled' : 'Disabled'} · every {source.syncFrequencyMinutes ?? 1440} minutes</span></td><td><StatusBadge value={source.capabilityStatus} /></td><td>{source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString() : 'No sync yet'}<span className="cell-detail">{lastStatus ? `Status: ${lastStatus}${source.lastErrorCode ? ` · ${source.lastErrorCode}` : ''}` : 'No run history'}</span>{source.runs?.[0] && <span className="cell-detail">{`${source.runs[0].fetchedCount} new · ${source.runs[0].duplicateCount} duplicates`}</span>}</td><td><div className="form-actions"><button className="text-button" disabled={busy} onClick={() => void action(source, 'verify')}>Check access</button>{demo && source.enabled && <button className="text-button" disabled={busy} onClick={() => void action(source, 'sync')}>Sync now</button>}{mayAdmin(role) && <><button className="text-button" onClick={() => setEditing(source)}>Edit</button>{source.platform === 'MANUAL' && <button className="text-button" disabled={busy} onClick={() => void action(source, 'toggle')}>{source.enabled ? 'Disable' : 'Enable'}</button>}<button className="text-button" onClick={() => setHistoryId(historyId === source.id ? '' : source.id)}>{historyId === source.id ? 'Hide runs' : 'Runs'}</button><button className="text-button" disabled={busy} onClick={() => void action(source, 'delete')}>Delete</button></>}</div></td></tr>;
      })}</tbody></table></div> : <EmptyState title="No sources registered">Add a manual source or a clearly labeled synthetic demo fixture.</EmptyState>}
      {historyId && <SourceHistory sourceId={historyId} />}{editing && <SourceEditor source={editing} channels={channels.data?.items ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); resource.reload(); }} />}
    </section>
    {mayAdmin(role) && <section className="panel form-panel"><h2>Register a source</h2>{channels.error && <ErrorNotice message={channels.error} retry={channels.reload} />}<form className="form-stack" onSubmit={create}><label>Platform<select aria-label="Platform" value={platform} onChange={event => setPlatform(event.target.value)}><option value="MANUAL">Manual / user-supplied</option><option value="REDDIT">Reddit (approval required)</option><option value="THREADS">Threads (approval required)</option><option value="FACEBOOK">Facebook (licensed access required)</option></select></label><label>Source identifier<input name="sourceKey" required maxLength={150} placeholder="owned-story-archive" /></label><label>Content channel<select name="channelId" defaultValue=""><option value="">No channel</option>{channels.data?.items.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      {platform === 'MANUAL' && <label>Mode<select value={mode} onChange={event => setMode(event.target.value)}><option value="USER_SUPPLIED">User supplied (manual import)</option><option value="MOCK_FIXTURE">Synthetic demo discovery</option></select></label>}
      <label>Keywords<input name="keywords" maxLength={2000} placeholder="community, volunteers" /></label><label>Hashtags<input name="hashtags" maxLength={2000} placeholder="#community, #local" /></label><label>Topics<input name="topics" maxLength={2000} placeholder="books, food, repair" /></label><label>Language<input name="language" maxLength={20} placeholder="en or vi" /></label><label>Sync frequency in minutes<input type="number" name="syncFrequencyMinutes" min={5} max={10080} defaultValue={1440} /></label>
      {platform === 'MANUAL' && <label className="checkbox-label"><input name="enabled" type="checkbox" defaultChecked /><span>Enable this source{mode === 'MOCK_FIXTURE' ? ' for scheduled demo sync' : ' for organizing manual imports'}</span></label>}{platform !== 'MANUAL' && <p className="field-help">This registers an external source as blocked. It will not fetch data until an approved adapter is implemented.</p>}
      <button className="button" disabled={busy}>{busy ? 'Saving…' : 'Register source'}</button></form></section>}
    </div></>;
}

function csv(value: FormDataEntryValue | null): string[] { return String(value ?? '').split(',').map(term => term.trim()).filter(Boolean); }

function SourceHistory({ sourceId }: { sourceId: string }) {
  const resource = useResource(`/sources/${sourceId}/sync-runs?limit=20`, paginated(syncRunSchema));
  return <div className="panel"><h3>Recent sync runs</h3>{resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading ? <p role="status" className="loading-state">Loading run history…</p> : resource.data?.items.length ? <div className="table-scroll"><table><thead><tr><th>Started</th><th>Status</th><th>New posts</th><th>Duplicates</th><th>Error</th></tr></thead><tbody>{resource.data.items.map(run => <tr key={run.id}><td>{new Date(run.startedAt).toLocaleString()}</td><td><StatusBadge value={run.status} /></td><td>{run.fetchedCount}</td><td>{run.duplicateCount}</td><td>{run.errorCode ?? '—'}</td></tr>)}</tbody></table></div> : <p className="muted">This source has no sync runs yet.</p>}</div>;
}

function SourceEditor({ source, channels, onClose, onSaved }: { source: Source; channels: z.infer<typeof channelSchema>[]; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const current = source.config;
    setBusy(true); setError('');
    try { await api(`/sources/${source.id}`, unknownResponseSchema, { method: 'PATCH', body: { sourceKey: String(form.get('sourceKey')), channelId: String(form.get('channelId')) || null, syncFrequencyMinutes: Number(form.get('syncFrequencyMinutes')), config: { ...current, mode: String(form.get('mode')), keywords: csv(form.get('keywords')), hashtags: csv(form.get('hashtags')), topics: csv(form.get('topics')), language: String(form.get('language') || '') || undefined } } }); onSaved(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section className="panel form-panel"><div className="panel-heading"><div><h3>Edit source</h3><p>{source.platform.toLowerCase()}</p></div><button className="text-button" onClick={onClose}>Close</button></div>{error && <ErrorNotice message={error} />}<form className="form-stack" onSubmit={save}><label>Source identifier<input name="sourceKey" defaultValue={source.sourceKey} maxLength={150} required /></label><label>Content channel<select name="channelId" defaultValue={source.channelId ?? ''}><option value="">No channel</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label>Mode<select name="mode" defaultValue={source.config?.mode ?? 'USER_SUPPLIED'}><option value="USER_SUPPLIED">User supplied</option><option value="MOCK_FIXTURE">Synthetic demo</option></select></label><label>Keywords<input name="keywords" defaultValue={source.config?.keywords?.join(', ') ?? ''} /></label><label>Hashtags<input name="hashtags" defaultValue={source.config?.hashtags?.join(', ') ?? ''} /></label><label>Topics<input name="topics" defaultValue={source.config?.topics?.join(', ') ?? ''} /></label><label>Language<input name="language" defaultValue={source.config?.language ?? ''} maxLength={20} /></label><label>Sync frequency in minutes<input type="number" name="syncFrequencyMinutes" min={5} max={10080} defaultValue={source.syncFrequencyMinutes ?? 1440} /></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save source'}</button></form></section>;
}

function ManualImport({ onImported }: { onImported: () => void }) {
  const [raw, setRaw] = useState(''); const [attested, setAttested] = useState(false);
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSuccess(''); setBusy(true);
    try {
      const payload = prepareManualImport(raw, attested);
      const result = await api('/imports/manual', importResultSchema, { method: 'POST', body: payload });
      setSuccess(`${result.deduplicated ? 'This story is already in your library. No duplicate was created.' : 'Story and comments imported. Rights review is required.'}${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`);
      setAttested(false); onImported();
    } catch (failure) { setError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section id="import" className="panel import-panel"><div className="panel-heading"><div><h2>Import source material</h2><p>Paste a post and its authorized comments as JSON.</p></div><button className="text-button" onClick={() => { setRaw(exampleImport); setAttested(false); setSuccess(''); }}>Load example draft</button></div>{error && <ErrorNotice message={error} />}{success && <div className="notice success" role="status">{success}</div>}<form onSubmit={submit} className="form-stack"><label>Import JSON<textarea name="import" className="code-input" value={raw} onChange={(event) => setRaw(event.target.value)} rows={13} maxLength={200_000} required placeholder={'{\n  "platform": "MANUAL",\n  "externalPostId": "your-story-id",\n  …\n}'} spellCheck={false} aria-describedby="import-help" /></label><p id="import-help" className="field-help">Include externalPostId, canonicalUrl, body, comments and rights. Evidence, territory and permitted commercial/platform scope must be verified before approval. Example drafts start with unknown rights.</p><label className="checkbox-label"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} required /><span>I confirm I have authority to import this post and its comments. Public visibility alone does not grant reuse rights.</span></label><div className="form-actions"><p className="field-help">Importing does not approve or schedule publication.</p><button className="button" disabled={busy}>{busy ? 'Importing…' : 'Import story'}<span aria-hidden="true">↥</span></button></div></form></section>;
}

function CandidateLibrary() {
  const { role } = useSession();
  const [query, setQuery] = useState(''); const [platform, setPlatform] = useState(''); const [topic, setTopic] = useState(''); const [minScore, setMinScore] = useState(''); const [sort, setSort] = useState('SCORE_DESC'); const [cursor, setCursor] = useState('');
  const [selectedId, setSelectedId] = useState(''); const [actionError, setActionError] = useState(''); const [busy, setBusy] = useState(false);
  const params = new URLSearchParams({ limit: '25', sort });
  if (query) params.set('q', query); if (platform) params.set('platform', platform); if (topic) params.set('topic', topic); if (minScore) params.set('minScore', minScore); if (cursor) params.set('cursor', cursor);
  const resource = useResource(`/candidates?${params.toString()}`, paginated(candidateSchema));
  const selected = resource.data?.items.find(candidate => candidate.id === selectedId) ?? null;
  function refresh() { resource.reload(); setSelectedId(''); }
  async function review(candidateId: string, decision: 'APPROVED' | 'REJECTED') {
    setBusy(true); setActionError('');
    try { await api(`/candidates/${candidateId}/review`, unknownResponseSchema, { method: 'POST', body: { decision } }); refresh(); }
    catch (failure) { setActionError(errorMessage(failure)); } finally { setBusy(false); }
  }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setQuery(String(form.get('query')).trim()); setTopic(String(form.get('topic')).trim()); setMinScore(String(form.get('minScore')).trim()); setPlatform(String(form.get('platform'))); setSort(String(form.get('sort'))); setCursor(''); setSelectedId(''); }
  return <>
    <section className="panel"><div className="panel-heading"><div><h2>Discovered content candidates</h2><p>Explainable scores with source provenance, duplicate counts and rights checks.</p></div><button className="text-button" onClick={resource.reload}>Refresh</button></div>
      <form className="search-form" role="search" onSubmit={search}><label className="sr-only" htmlFor="candidate-search">Search candidates</label><input id="candidate-search" name="query" type="search" placeholder="Search titles or text…" maxLength={200} defaultValue={query} /><label><span className="sr-only">Platform</span><select name="platform" defaultValue={platform}><option value="">All platforms</option><option value="MANUAL">Manual / demo</option><option value="REDDIT">Reddit</option><option value="THREADS">Threads</option><option value="FACEBOOK">Facebook</option></select></label><label><span className="sr-only">Topic</span><input name="topic" placeholder="Topic" maxLength={80} defaultValue={topic} /></label><label><span className="sr-only">Minimum score</span><input name="minScore" type="number" min={0} max={100} placeholder="Min score" defaultValue={minScore} /></label><label><span className="sr-only">Sort candidates</span><select name="sort" defaultValue={sort}><option value="SCORE_DESC">Highest score</option><option value="SCORE_ASC">Lowest score</option><option value="NEWEST">Newest</option></select></label><button className="button secondary small">Filter</button></form>
      {resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading ? <p role="status" className="loading-state">Loading candidate scores…</p> : resource.data?.items.length ? <div className="table-scroll"><table><caption className="sr-only">Discovered content and score review</caption><thead><tr><th>Story</th><th>Source</th><th>Score</th><th>Rights</th><th>Candidate state</th></tr></thead><tbody>{resource.data.items.map(candidate => <tr key={candidate.id} className={selectedId === candidate.id ? 'selected-row' : ''}><td><button className="text-button" onClick={() => setSelectedId(candidate.id)}>{candidate.post.title || 'Untitled story'}<span className="cell-detail">{candidate.post.topicTags?.join(', ') || candidate.post.externalPostId}</span></button></td><td>{candidate.post.platform.toLowerCase()}{candidate.post.synthetic && <span className="cell-detail">synthetic demo</span>}</td><td><strong>{candidate.score === null ? '—' : Math.round(candidate.score)}</strong><span className="cell-detail">minimum {Math.round(candidate.minimumScore)}</span></td><td><StatusBadge value={candidate.post.rights[0]?.reviewStatus ?? 'PENDING'} /></td><td><StatusBadge value={candidate.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="No candidates yet">Import authorized material or enable a synthetic demo source and run a sync.</EmptyState>}
      {(cursor || resource.data?.nextCursor) && <div className="pagination"><button className="text-button" disabled={!cursor} onClick={() => { setCursor(''); setSelectedId(''); }}>First page</button><button className="button small secondary" disabled={!resource.data?.nextCursor} onClick={() => { setCursor(resource.data?.nextCursor ?? ''); setSelectedId(''); }}>Next page →</button></div>}
    </section>
    {selected && <section className="panel"><div className="panel-heading"><div><h2>{selected.post.title || 'Untitled story'}</h2><p>{selected.post.platform.toLowerCase()} · <a href={selected.post.canonicalUrl} target="_blank" rel="noreferrer">Open source</a>{selected.post.synthetic ? ' · synthetic demo data' : ''}</p></div><button className="text-button" onClick={() => setSelectedId('')}>Close details</button></div>
      {actionError && <ErrorNotice message={actionError} />}
      <div className="detail-grid"><div><h3>Original content</h3><p className="source-body">{selected.post.body}</p><StatusBadge value={selected.post.rights[0]?.reviewStatus ?? 'PENDING'} /><p className="field-help">Rights basis: {selected.post.rights[0]?.basis ?? 'UNKNOWN'} · comments: {selected.post._count?.comments ?? selected.post.comments?.length ?? 0}</p>{selected.post.sensitiveFlags?.length ? <p className="notice">Safety review flags: {selected.post.sensitiveFlags.join(', ')}</p> : null}</div>
        <div><h3>Score breakdown <span className="badge neutral">{selected.modelVersion ?? 'heuristic'}</span></h3><p className="score-total">{selected.score === null ? 'Unscored' : `${Math.round(selected.score)} / 100`}<span className="field-help">{selected.reasoning}</span></p>{selected.factors?.factors && <dl className="detail-list">{Object.entries(selected.factors.factors).map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd>{value === null ? 'Unavailable' : Math.round(value)}</dd></div>)}</dl>}<h3>Engagement snapshot</h3>{selected.post.metricSnapshots?.[0] ? <p>{selected.post.metricSnapshots[0].likes ?? '—'} likes · {selected.post.metricSnapshots[0].replies ?? '—'} comments · {selected.post.metricSnapshots[0].shares ?? '—'} shares · {selected.post.metricSnapshots[0].views ?? '—'} views</p> : <p className="muted">Engagement metrics were unavailable.</p>}</div></div>
      <div className="panel"><h3>Available comments</h3>{selected.post.comments?.length ? <ul>{selected.post.comments.map(comment => <li key={comment.id}>{comment.body}</li>)}</ul> : <p className="muted">No comments were available for this source.</p>}</div>
      <div className="form-actions"><p className="field-help">Approval requires a completed rights review, no unresolved safety flags and a score above the channel threshold.</p>{selected.status === 'NEEDS_RIGHTS_REVIEW' && <Link className="button secondary" href="/reviews">Review rights first</Link>}{mayReview(role) && !['APPROVED', 'REJECTED', 'BLOCKED_RIGHTS', 'BLOCKED_SAFETY', 'BELOW_THRESHOLD', 'DUPLICATE'].includes(selected.status) && <><button className="button danger" disabled={busy} onClick={() => void review(selected.id, 'REJECTED')}>Reject candidate</button><button className="button" disabled={busy || selected.status !== 'PENDING_REVIEW'} onClick={() => void review(selected.id, 'APPROVED')}>Approve candidate</button></>}</div>
    </section>}
    {mayEdit(role) && <ManualImport onImported={refresh} />}{!mayEdit(role) && <div className="notice">Your role has read access to this library. An owner, admin or editor can import source material.</div>}
  </>;
}

function LibraryHub() {
  const [view, setView] = useState<'posts' | 'candidates'>('posts');
  return <><div className="form-actions" role="group" aria-label="Library view"><button className={`button ${view === 'posts' ? '' : 'secondary'}`} aria-pressed={view === 'posts'} onClick={() => setView('posts')}>All source posts</button><button className={`button ${view === 'candidates' ? '' : 'secondary'}`} aria-pressed={view === 'candidates'} onClick={() => setView('candidates')}>Scored candidates</button></div>{view === 'posts' ? <Library /> : <CandidateLibrary />}</>;
}

function Library({ reviewMode = false }: { reviewMode?: boolean }) {
  const { role } = useSession(); const [query, setQuery] = useState(''); const [selected, setSelected] = useState<Post | null>(null); const [cursor, setCursor] = useState('');
  const resource = useResource(`/posts?limit=25${query ? `&q=${encodeURIComponent(query)}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, postsListSchema);
  const posts = resource.data?.items.filter((post) => !reviewMode || post.rights.some((right) => right.reviewStatus !== 'APPROVED')) ?? [];
  function refresh() { resource.reload(); setSelected(null); }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setQuery(String(form.get('query')).trim()); setCursor(''); setSelected(null); }
  return <>
    {reviewMode && <div className="notice"><strong>Rights approval is an explicit decision.</strong><span>Verify evidence, territory, attribution, commercial use and target platforms. Unknown or revoked rights cannot be approved.</span></div>}
    <section className="panel"><div className="panel-heading"><div><h2>{reviewMode ? 'Material awaiting a rights decision' : 'Source library'}</h2><p>{reviewMode ? 'Imported material is held until an authorized reviewer approves its use.' : 'Original text stays connected to its source and comments.'}</p></div><form className="search-form" role="search" onSubmit={search}><label className="sr-only" htmlFor="post-search">Search stories</label><input id="post-search" name="query" type="search" placeholder="Search stories…" maxLength={200} /><button className="button secondary small">Search</button></form></div>
      {resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading ? <p role="status" className="loading-state">Loading source material…</p> : posts.length ? <div className="table-scroll"><table><caption className="sr-only">{reviewMode ? 'Stories requiring rights review' : 'Imported stories'}</caption><thead><tr><th>Story</th><th>Source</th><th>Comments</th><th>Rights review</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{posts.map((post) => <tr key={post.id}><td><strong>{post.title || 'Untitled story'}</strong><span className="cell-detail">{post.externalPostId}</span></td><td>{post.platform.toLowerCase()}</td><td>{post._count?.comments ?? 0}</td><td><StatusBadge value={post.rights[0]?.reviewStatus ?? 'PENDING'} /><span className="cell-detail">{(post.rights[0]?.basis ?? 'UNKNOWN').replaceAll('_', ' ').toLowerCase()}</span></td><td><button className="text-button" onClick={() => setSelected(post)}>{reviewMode ? 'Review' : 'Open'} <span aria-hidden="true">↗</span></button></td></tr>)}</tbody></table></div> : <EmptyState title={reviewMode ? 'No pending material on this page' : query ? 'No matching stories' : 'Your library is ready'}>{reviewMode ? 'New imports requiring review will appear here.' : query ? 'Try a different title or phrase.' : 'Import your first authorized story and comments below.'}</EmptyState>}
      {(cursor || resource.data?.nextCursor) && <div className="pagination"><button className="text-button" disabled={!cursor} onClick={() => { setCursor(''); setSelected(null); }}>First page</button><button className="button small secondary" disabled={!resource.data?.nextCursor} onClick={() => { setCursor(resource.data?.nextCursor ?? ''); setSelected(null); }}>Next page →</button></div>}
    </section>
    {selected && <PostInspector key={selected.id} post={selected} reviewMode={reviewMode} onClose={() => setSelected(null)} onChanged={refresh} />}
    {!reviewMode && mayEdit(role) && <ManualImport onImported={refresh} />}
    {!reviewMode && !mayEdit(role) && <div className="notice">Your role has read access to this library. An owner, admin or editor can import source material.</div>}
    {reviewMode && !mayReview(role) && <div className="notice">Your role can view source material. An owner, admin or reviewer must make rights decisions.</div>}
  </>;
}

function PostInspector({ post, reviewMode, onClose, onChanged }: { post: Post; reviewMode: boolean; onClose: () => void; onChanged: () => void }) {
  const { role } = useSession(); const right = post.rights[0]; const comments = useResource(`/posts/${post.id}/comments?limit=100`, commentsListSchema);
  const eligibility = useResource(`/posts/${post.id}/eligibility?platform=YOUTUBE`, eligibilitySchema);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState('APPROVED'); const [basis, setBasis] = useState(right?.basis ?? 'UNKNOWN');
  const [attributionRequired, setAttributionRequired] = useState(right?.attributionRequired ?? false);
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      await api(`/posts/${post.id}/rights/review`, unknownResponseSchema, {
        method: 'POST',
        body: {
          decision,
          ...(form.get('evidence') ? { evidence: String(form.get('evidence')) } : {}),
          ...(form.get('territory') ? { territory: String(form.get('territory')) } : {}),
          ...(form.get('attributionText') ? { attributionText: String(form.get('attributionText')) } : {}),
          ...(decision === 'APPROVED' ? {
            basis, attested: form.get('attested') === 'on', commercialAllowed: form.get('commercialAllowed') === 'on',
            allowedPlatforms: form.getAll('allowedPlatforms').map(String), attributionRequired,
            expiresAt: form.get('expiresAt') ? `${String(form.get('expiresAt'))}T23:59:59.000Z` : null,
          } : {}),
        },
      });
      onChanged();
    }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function takedown(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await api('/takedowns', unknownResponseSchema, { method: 'POST', body: { postId: post.id, reason: String(form.get('reason')) } }); onChanged(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section className="panel inspector" aria-label="Selected story detail"><div className="panel-heading"><div><span className="eyebrow">SOURCE DETAIL</span><h2>{post.title || 'Untitled story'}</h2><a href={post.canonicalUrl} target="_blank" rel="noopener noreferrer" className="source-link">{post.canonicalUrl} ↗</a></div><button className="button small secondary" onClick={onClose}>Close</button></div>{error && <ErrorNotice message={error} />}
    <div className="inspector-grid"><div><h3>Original source text</h3><p className="source-body">{post.body}</p><h3>Source comments</h3>{comments.error ? <ErrorNotice message={comments.error} retry={comments.reload} /> : comments.loading ? <p role="status">Loading comments…</p> : comments.data?.items.length ? <ol className="comment-list">{comments.data.items.map((comment) => <li key={comment.id}><span className="comment-id">{comment.externalId}</span><p>{comment.body}</p></li>)}</ol> : <p className="muted">No comments were imported.</p>}</div>
      <div className="rights-summary"><h3>Rights record</h3><dl className="detail-list"><div><dt>Basis</dt><dd><StatusBadge value={right?.basis ?? 'UNKNOWN'} /></dd></div><div><dt>Review</dt><dd><StatusBadge value={right?.reviewStatus ?? 'PENDING'} /></dd></div><div><dt>Attestation</dt><dd>{right?.attested ? 'Recorded' : 'Missing'}</dd></div><div><dt>Commercial use</dt><dd>{right?.commercialAllowed ? 'Permitted by attestation' : 'Not permitted'}</dd></div><div><dt>Platforms</dt><dd>{right?.allowedPlatforms.join(', ') || 'None permitted'}</dd></div><div><dt>Territory</dt><dd>{right?.territory || 'Unspecified'}</dd></div><div><dt>Expiry</dt><dd>{right?.expiresAt ? new Date(right.expiresAt).toLocaleDateString() : 'No expiry recorded'}</dd></div><div><dt>Attribution</dt><dd>{right?.attributionRequired ? right.attributionText || 'Required; text missing' : 'Not required'}</dd></div></dl><h4>Evidence</h4><p className="evidence-text">{right?.evidence || 'No supporting evidence supplied yet.'}</p>
        {eligibility.error ? <ErrorNotice message={eligibility.error} retry={eligibility.reload} /> : eligibility.data && <div className={`notice ${eligibility.data.allowed ? 'success' : 'warning'}`}><strong>YouTube rights check: {eligibility.data.allowed ? 'passed' : 'blocked'}</strong><span>{eligibility.data.reasons.length ? eligibility.data.reasons.map((reason) => reason.replaceAll('_', ' ').toLowerCase()).join('; ') : 'Rights alone do not approve a video or enable publishing.'}</span></div>}
      </div>
    </div>
    {mayReview(role) && (reviewMode || right?.reviewStatus !== 'APPROVED') && <form className="review-form" onSubmit={review}>
      <h3>Record a rights decision</h3><p className="field-help">Approval requires an attested known basis, evidence, explicit territory and permitted use. Any corrections to imported rights are recorded with your decision.</p>
      <div className="form-grid"><div className="form-stack">
        <label>Verified rights basis<select aria-label="Verified rights basis" value={basis} onChange={(event) => setBasis(event.target.value)}><option value="UNKNOWN">Unknown (approval blocked)</option><option value="OWNED">Owned</option><option value="LICENSED">Licensed</option><option value="CONSENTED">Consented</option><option value="EXCEPTION_REVIEWED">Exception reviewed by an informed reviewer</option></select></label>
        <label>Evidence or license reference<textarea aria-label="Evidence or license reference" name="evidence" rows={4} defaultValue={right?.evidence ?? ''} maxLength={4000} required={decision === 'APPROVED'} /></label>
        <fieldset className="platform-fieldset"><legend>Permitted platforms</legend>{['YOUTUBE', 'FACEBOOK', 'TIKTOK'].map((platform) => <label className="checkbox-label" key={platform}><input type="checkbox" name="allowedPlatforms" value={platform} defaultChecked={right?.allowedPlatforms.includes(platform)} /><span>{platform === 'YOUTUBE' ? 'YouTube' : platform === 'FACEBOOK' ? 'Facebook' : 'TikTok (manual handoff)'}</span></label>)}</fieldset>
        <label className="checkbox-label"><input name="commercialAllowed" type="checkbox" defaultChecked={right?.commercialAllowed} /><span>Commercial use is explicitly permitted.</span></label>
      </div><div className="form-stack">
        <label>Territory<input name="territory" defaultValue={right?.territory === 'UNSPECIFIED' ? '' : right?.territory} placeholder="e.g. WORLDWIDE, if your rights permit" maxLength={100} required={decision === 'APPROVED'} /></label>
        <label>Rights valid through (UTC)<input name="expiresAt" type="date" defaultValue={right?.expiresAt?.slice(0, 10) ?? ''} /></label>
        <p className="field-help">Leave blank only when the verified rights have no expiry.</p>
        <label className="checkbox-label"><input type="checkbox" checked={attributionRequired} onChange={(event) => setAttributionRequired(event.target.checked)} /><span>Attribution is required.</span></label>
        <label>Attribution text<input name="attributionText" defaultValue={right?.attributionText ?? ''} maxLength={2000} required={decision === 'APPROVED' && attributionRequired} /></label>
      </div></div>
      <label className="checkbox-label review-attestation"><input name="attested" type="checkbox" required={decision === 'APPROVED'} /><span>I have checked the evidence and confirm this rights basis and permitted use for the post and its comments.</span></label>
      <div className="form-actions"><label>Decision<select aria-label="Decision" value={decision} onChange={(event) => setDecision(event.target.value)}><option value="APPROVED">Approve verified permitted use</option><option value="REJECTED">Reject use</option></select></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Record decision'}</button></div>
      {basis === 'UNKNOWN' && <p className="field-help">Unknown rights remain blocked. Select a verified basis and document its evidence to approve use.</p>}
    </form>}
    {mayAdmin(role) && <details className="takedown-section"><summary>Author deletion or takedown request</summary><p className="field-help">This removes source text and comments, revokes associated rights and blocks downstream use. Keep the reason free of unnecessary personal data.</p><form className="form-actions" onSubmit={takedown}><label>Reason<input name="reason" required minLength={5} maxLength={500} placeholder="Author requested removal" /></label><button className="button danger" disabled={busy}>Register takedown</button></form></details>}
  </section>;
}

function Settings() {
  const { session, role, refresh } = useSession(); const workspace = session.workspaces.find((item) => item.id === session.activeWorkspaceId);
  return <><div className="split-layout"><section className="panel form-panel"><h2>Current workspace</h2><dl className="detail-list"><div><dt>Name</dt><dd>{workspace?.name}</dd></div><div><dt>Your role</dt><dd>{role?.toLowerCase()}</dd></div><div><dt>Workspace ID</dt><dd className="mono">{session.activeWorkspaceId}</dd></div></dl><p className="field-help">Your active workspace is verified against membership on the server for every request.</p><div className="notice"><strong>Rights remain the gate</strong><span>Discovery and scoring suggest candidates. They never schedule publication automatically.</span></div></section><section className="panel form-panel"><h2>Create another workspace</h2><p className="muted">Source material and rights remain isolated by workspace.</p><WorkspaceForm onCreated={refresh} /></section></div><TopicRules />{mayAdmin(role) && <><Members /><AuditLog /></>}</>;
}

function TopicRules() {
  const { role } = useSession(); const rules = useResource('/topic-rules?limit=100', paginated(topicRuleSchema)); const channels = useResource('/channels?limit=100', channelsListSchema);
  const [editingId, setEditingId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setError(''); setBusy(true);
    try { await api('/topic-rules', unknownResponseSchema, { method: 'POST', body: { channelId: String(form.get('channelId')), name: String(form.get('name')), keywords: csv(form.get('keywords')), hashtags: csv(form.get('hashtags')), topics: csv(form.get('topics')), allow: csv(form.get('allow')), deny: csv(form.get('deny')), language: String(form.get('language') || '') || undefined, minimumScore: Number(form.get('minimumScore')), enabled: form.get('enabled') === 'on' } }); event.currentTarget.reset(); rules.reload(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function toggle(id: string, enabled: boolean) {
    setError(''); setBusy(true);
    try { await api(`/topic-rules/${id}`, unknownResponseSchema, { method: 'PATCH', body: { enabled: !enabled } }); rules.reload(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    setError(''); setBusy(true);
    try { await api(`/topic-rules/${id}`, unknownResponseSchema, { method: 'DELETE' }); rules.reload(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-heading"><div><h2>Discovery topic rules</h2><p>Set channel vocabulary, excluded topics and minimum candidate scores.</p></div></div>
    {error && <ErrorNotice message={error} />}{rules.error && <ErrorNotice message={rules.error} retry={rules.reload} />}
    {rules.loading ? <p role="status" className="loading-state">Loading topic rules…</p> : rules.data?.items.length ? <div className="channel-grid">{rules.data.items.map(rule => <article key={rule.id} className="channel-item"><div className="panel-heading"><h3>{rule.name}</h3><StatusBadge value={rule.enabled ? 'ENABLED' : 'DISABLED'} /></div><p>{channels.data?.items.find(channel => channel.id === rule.channelId)?.name ?? 'Channel'}</p><p>Minimum score: {rule.minimumScore}</p><p className="field-help">Keywords: {rule.keywords.join(', ') || 'none'} · topics: {rule.topics.join(', ') || 'none'}</p><p className="field-help">Exclude: {rule.deny.join(', ') || 'none'}</p>{mayAdmin(role) && <div className="form-actions"><button className="text-button" disabled={busy} onClick={() => void toggle(rule.id, rule.enabled)}>{rule.enabled ? 'Disable' : 'Enable'}</button><button className="text-button" onClick={() => setEditingId(editingId === rule.id ? '' : rule.id)}>Edit</button><button className="text-button" disabled={busy} onClick={() => void remove(rule.id)}>Delete</button></div>}{editingId === rule.id && mayAdmin(role) && <TopicRuleEditor rule={rule} onSaved={() => { setEditingId(''); rules.reload(); }} />}</article>)}</div> : <EmptyState title="No topic rules yet">Add rules to score candidates against each channel direction.</EmptyState>}
    {mayAdmin(role) && <form className="form-stack member-form" onSubmit={create}><h3>Add topic rule</h3>{channels.error && <ErrorNotice message={channels.error} retry={channels.reload} />}<label>Content channel<select name="channelId" required defaultValue=""><option value="" disabled>Select a channel</option>{channels.data?.items.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label>Rule name<input name="name" required maxLength={100} placeholder="Local community stories" /></label><label>Keywords<input name="keywords" maxLength={2000} placeholder="community, volunteers" /></label><label>Hashtags<input name="hashtags" maxLength={2000} placeholder="#local" /></label><label>Topics<input name="topics" maxLength={2000} placeholder="books, food, repair" /></label><label>Allow terms<input name="allow" maxLength={2000} placeholder="shared space" /></label><label>Exclude terms<input name="deny" maxLength={2000} placeholder="advertisement, giveaway" /></label><label>Language<input name="language" maxLength={20} placeholder="en or vi" /></label><label>Minimum score<input name="minimumScore" type="number" min={0} max={100} defaultValue={55} /></label><label className="checkbox-label"><input name="enabled" type="checkbox" defaultChecked /><span>Rule is enabled</span></label><button className="button" disabled={busy || !channels.data?.items.length}>{busy ? 'Saving…' : 'Add topic rule'}</button></form>}
  </section>;
}

function TopicRuleEditor({ rule, onSaved }: { rule: z.infer<typeof topicRuleSchema>; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await api(`/topic-rules/${rule.id}`, unknownResponseSchema, { method: 'PATCH', body: { name: String(form.get('name')), keywords: csv(form.get('keywords')), hashtags: csv(form.get('hashtags')), topics: csv(form.get('topics')), allow: csv(form.get('allow')), deny: csv(form.get('deny')), language: String(form.get('language') || '') || undefined, minimumScore: Number(form.get('minimumScore')) } }); onSaved(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <form className="form-stack" onSubmit={save}>{error && <ErrorNotice message={error} />}<label>Name<input name="name" defaultValue={rule.name} maxLength={100} required /></label><label>Keywords<input name="keywords" defaultValue={rule.keywords.join(', ')} /></label><label>Hashtags<input name="hashtags" defaultValue={rule.hashtags.join(', ')} /></label><label>Topics<input name="topics" defaultValue={rule.topics.join(', ')} /></label><label>Allow terms<input name="allow" defaultValue={rule.allow.join(', ')} /></label><label>Exclude terms<input name="deny" defaultValue={rule.deny.join(', ')} /></label><label>Language<input name="language" defaultValue={rule.language ?? ''} maxLength={20} /></label><label>Minimum score<input name="minimumScore" type="number" min={0} max={100} defaultValue={rule.minimumScore} /></label><button className="button small" disabled={busy}>{busy ? 'Saving…' : 'Save rule'}</button></form>;
}

function Members() {
  const { session, refresh } = useSession();
  const resource = useResource(`/workspaces/${session.activeWorkspaceId}/members?limit=100`, membersListSchema);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); setBusy(true); setError(''); setSuccess('');
    try {
      await api(`/workspaces/${session.activeWorkspaceId}/members`, unknownResponseSchema, { method: 'POST', body: { email: String(form.get('email')), role: String(form.get('role')) } });
      setSuccess('Workspace access updated.'); element.reset(); resource.reload();
      if (String(form.get('email')).trim().toLowerCase() === session.user.email.toLowerCase()) await refresh();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-heading"><div><h2>Workspace members</h2><p>Access applies only to this workspace. Existing owners are protected.</p></div></div>
    {resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}
    {resource.loading ? <p className="loading-state" role="status">Loading members…</p> : resource.data?.items.length ? <div className="table-scroll"><table><caption className="sr-only">Workspace membership roles</caption><thead><tr><th>Member</th><th>Email</th><th>Role</th></tr></thead><tbody>{resource.data.items.map((member) => <tr key={member.userId}><td><strong>{member.name || 'Workspace member'}</strong></td><td>{member.email}</td><td><span className="badge neutral">{member.role.toLowerCase()}</span></td></tr>)}</tbody></table></div> : <EmptyState title="No members to display">Workspace members and their roles appear here.</EmptyState>}
    <form className="member-form" onSubmit={save}><h3>Add or update registered member</h3><p className="field-help">The person must create an account first. Reviewers can review rights; editors can import source material.</p>{error && <ErrorNotice message={error} />}{success && <p className="notice success" role="status">{success}</p>}<div className="form-actions"><label>Account email<input name="email" type="email" required maxLength={254} placeholder="editor@your-team.example" /></label><label>Workspace role<select aria-label="Workspace role" name="role" defaultValue="VIEWER"><option value="VIEWER">Viewer</option><option value="EDITOR">Editor</option><option value="REVIEWER">Reviewer</option><option value="ADMIN">Admin</option></select></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save access'}</button></div></form>
  </section>;
}

function AuditLog() {
  const resource = useResource('/audit-logs?limit=25', auditsListSchema);
  return <section className="panel"><div className="panel-heading"><div><h2>Recent audit events</h2><p>Recorded actions for this workspace. Content and credentials are excluded.</p></div><button className="text-button" onClick={resource.reload}>Refresh</button></div>{resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading ? <p role="status" className="loading-state">Loading audit history…</p> : resource.data?.items.length ? <div className="table-scroll"><table><caption className="sr-only">Workspace audit events</caption><thead><tr><th>Action</th><th>Resource</th><th>Recorded</th></tr></thead><tbody>{resource.data.items.map((event) => <tr key={event.id}><td><strong>{event.action.replaceAll('_', ' ').toLowerCase()}</strong></td><td>{event.resourceType}<span className="cell-detail mono">{event.resourceId}</span></td><td>{new Date(event.occurredAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState title="No audit events yet">Workspace actions will be recorded here.</EmptyState>}</section>;
}
