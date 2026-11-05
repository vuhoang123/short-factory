'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { api, errorMessage } from '../lib/api';
import { useResource } from '../lib/use-resource';
import { auditSchema, candidateSchema, channelSchema, commentSchema, dashboardSchema, eligibilitySchema, mayAdmin, mayEdit, mayReview, paginated, postSchema, roleSchema, sourceSchema, syncRunSchema, topicRuleSchema, unknownResponseSchema, type Post, type Source } from '../lib/contracts';
import { exampleImport, prepareManualImport } from '../lib/manual-import';
import { useSession, WorkspaceForm } from './app-shell';
import { EmptyState, ErrorNotice, StatusBadge } from './feedback';

type View = 'dashboard' | 'channels' | 'sources' | 'library' | 'reviews' | 'settings';
const pageCopy: Record<View, { title: string; description: string }> = {
  dashboard: { title: 'Tổng quan workspace', description: 'Nội dung đã lưu và các công việc cần tiếp tục.' },
  channels: { title: 'Kênh nội dung', description: 'Tổ chức nội dung theo chủ đề và ngôn ngữ.' },
  sources: { title: 'Nguồn nội dung', description: 'Quản lý nơi cung cấp nội dung và tình trạng truy cập.' },
  library: { title: 'Bài đã lưu', description: 'Bài viết, bình luận và thông tin nguồn đã nhập.' },
  reviews: { title: 'Duyệt quyền sử dụng', description: 'Kiểm tra bằng chứng và phạm vi sử dụng trước khi dựng video.' },
  settings: { title: 'Cài đặt workspace', description: 'Quản lý workspace, quyền truy cập và nhật ký thao tác.' },
};


const channelsListSchema = paginated(channelSchema);
const topicRulesListSchema = paginated(topicRuleSchema);
const sourcesListSchema = paginated(sourceSchema);
const postsListSchema = paginated(postSchema);
const commentsListSchema = paginated(commentSchema);
const auditsListSchema = paginated(auditSchema);
const membersListSchema = paginated(z.object({ userId: z.string(), email: z.string(), name: z.string().nullable(), role: roleSchema }));
const importResultSchema = z.object({ postId: z.string(), deduplicated: z.boolean(), warnings: z.array(z.string()) });
const syncRunsListSchema = paginated(syncRunSchema);
const candidatesListSchema = paginated(candidateSchema);

export function WorkspacePage({ view }: { view: View }) {
  const copy = pageCopy[view]; const { role } = useSession();
  return <><div className="page-heading"><div><h1>{copy.title}</h1><p>{copy.description}</p></div>{view === 'dashboard' && mayEdit(role) && <Link className="button" href="/library/posts#import" aria-label="Import a story">Import a story <span aria-hidden="true">＋</span></Link>}</div>
    {view === 'dashboard' && <Dashboard />}{view === 'channels' && <Channels />}{view === 'sources' && <Sources />}{view === 'library' && <LibraryHub />}{view === 'reviews' && <Library reviewMode />}{view === 'settings' && <Settings />}
  </>;
}

function Dashboard() {
  const { data, loading, error, reload } = useResource('/dashboard', dashboardSchema);
  const recent = useResource('/posts?limit=5', postsListSchema);
  if (error) return <ErrorNotice message={error} retry={reload} />;
  if (loading || !data) return <p className="loading-state" role="status">Loading your workspace overview…</p>;
  return <>
    <section className="guide-prompt"><div><h2>Chưa biết bắt đầu từ đâu?</h2><p>Xem quy trình từ tạo kênh, nhập nội dung có quyền đến duyệt video.</p></div><Link className="button secondary" href="/guide">Mở hướng dẫn sử dụng <span aria-hidden="true">→</span></Link></section>
    <section className="metrics-grid" aria-label="Workspace statistics">
      {[{ label: 'Bài đã nhập', value: data.counts.posts, detail: `${data.counts.comments} source comments`, mark: '▧' }, { label: 'Awaiting rights review', value: data.counts.pendingRights, detail: 'Human approval required', mark: '✓' }, { label: 'Kênh nội dung', value: data.counts.channels, detail: 'Editorial directions', mark: '▤' }, { label: 'Nguồn đã lưu', value: data.counts.sources, detail: `${data.counts.pendingSources} need provider access`, mark: '↗' }, { label: 'Content candidates', value: data.counts.candidates, detail: 'Scored and rights checked', mark: '◎' }].map((metric) => <article className="metric" key={metric.label}><div><span>{metric.label}</span><span className="metric-mark" aria-hidden="true">{metric.mark}</span></div><strong>{metric.value}</strong><p>{metric.detail}</p></article>)}
    </section>
    <div className="overview-grid">
      <section className="panel latest-posts"><div className="panel-heading"><div><h2>Recent source material</h2><p>Your latest imports and their rights status.</p></div><Link className="text-button" href="/library/posts">View library <span aria-hidden="true">↗</span></Link></div>
        {recent.error ? <ErrorNotice message={recent.error} retry={recent.reload} /> : recent.loading && !recent.data ? <p role="status" className="loading-state">Loading recent stories…</p> : recent.data?.items.length ? <div className="recent-list">{recent.data.items.map((post) => <Link href="/library/posts" key={post.id} className="recent-item"><span className="post-glyph" aria-hidden="true">Aa</span><div><strong>{post.title || 'Bài chưa có tiêu đề'}</strong><p>{post.platform.toLowerCase()} · {post._count?.comments ?? 0} comments</p></div><StatusBadge value={post.rights[0]?.reviewStatus ?? 'PENDING'} /></Link>)}</div> : <EmptyState title="Your first story starts here">Import a post and its authorized comments to begin building your library.</EmptyState>}
      </section>
      <section className="next-step"><h2>{data.counts.pendingRights ? 'Make the rights clear.' : 'Bring your stories together.'}</h2><p>{data.counts.pendingRights ? 'Review the evidence, permitted platforms and commercial scope for your imported material.' : 'Add source material you own or have permission to use. Every import keeps its provenance and needs a rights review.'}</p><Link className="button secondary" href={data.counts.pendingRights ? '/reviews' : '/library/posts#import'}>{data.counts.pendingRights ? 'Open rights reviews' : 'Nhập nội dung nguồn'} <span aria-hidden="true">→</span></Link><div className="next-step-note"><strong>Public does not mean permitted.</strong><span>Unknown, expired or revoked rights remain blocked.</span></div></section>
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
  return <div className="split-layout"><section className="panel"><div className="panel-heading"><div><h2>Kênh của bạn</h2><p>Automation stays off while the editorial workflow is being built.</p></div></div>{resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading && !resource.data ? <p role="status" className="loading-state">Đang tải kênh…</p> : resource.data?.items.length ? <div className="channel-grid">{resource.data.items.map((channel) => <article key={channel.id} className="channel-item"><span className="channel-initial" aria-hidden="true">{channel.name.slice(0, 1).toUpperCase()}</span><h3>{channel.name}</h3><p>Language: {channel.language}</p><span className="badge neutral">Duyệt thủ công</span></article>)}</div> : <EmptyState title="Tạo kênh nội dung">Nhóm bài viết theo chủ đề, ngôn ngữ hoặc hướng nội dung.</EmptyState>}</section>
    {mayAdmin(role) ? <section className="panel form-panel"><h2>Thêm kênh nội dung</h2><p className="muted">Chọn một hướng nội dung cho kênh của bạn.</p>{error && <ErrorNotice message={error} />}<form className="form-stack" onSubmit={create}><label>Tên kênh<input name="name" maxLength={100} required placeholder="Everyday stories" /></label><label>Ngôn ngữ<input name="language" defaultValue="vi" required maxLength={20} /></label><label>Từ khóa chủ đề<textarea name="keywords" rows={3} placeholder="work, community, everyday life" maxLength={2000} /></label><p className="field-help">Ngăn cách các từ khóa bằng dấu phẩy.</p><label>Điểm tối thiểu để chọn bài<input type="number" name="minimumCandidateScore" min={0} max={100} step={1} defaultValue={55} /></label><button className="button" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo kênh'}</button></form></section> : <div className="notice">Cần vai trò chủ sở hữu hoặc quản trị viên để tạo kênh.</div>}
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
  return <><div className="notice"><strong>Sử dụng nội dung đã được cho phép.</strong><span>Manual imports and synthetic demo fixtures are available. Reddit, Threads and Facebook stay disabled until verified official API or licensed provider access is implemented.</span></div>
    {error && <ErrorNotice message={error} />}
    <div className="split-layout"><section className="panel"><div className="panel-heading"><div><h2>Danh sách nguồn</h2><p>Kiểm tra truy cập, lịch sử đồng bộ và tình trạng nguồn.</p></div><button className="text-button" onClick={resource.reload}>Làm mới</button></div>
      {resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading && !resource.data ? <p className="loading-state" role="status">Đang tải nguồn…</p> : resource.data?.items.length ? <div className="table-scroll"><table><caption className="sr-only">Nguồn nội dung đã lưu</caption><thead><tr><th>Nguồn</th><th>Truy cập & đồng bộ</th><th>Lượt gần nhất</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{resource.data.items.map(source => {
        const demo = source.config?.mode === 'MOCK_FIXTURE';
        const lastStatus = source.lastSyncStatus && source.lastSyncStatus !== 'NEVER' ? source.lastSyncStatus : null;
        return <tr key={source.id}><td><strong>{source.sourceKey}</strong><span className="cell-detail">{source.platform.toLowerCase()}{source.channel ? ` · ${source.channel.name}` : ''}{demo ? ' · synthetic demo' : ''}</span><span className="cell-detail">{source.enabled ? 'Đang bật' : 'Đã tắt'} · every {source.syncFrequencyMinutes ?? 1440} minutes</span></td><td><StatusBadge value={source.capabilityStatus} /></td><td>{source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleString() : 'Chưa đồng bộ'}<span className="cell-detail">{lastStatus ? `Status: ${lastStatus}${source.lastErrorCode ? ` · ${source.lastErrorCode}` : ''}` : 'Chưa có lịch sử'}</span>{source.runs?.[0] && <span className="cell-detail">{`${source.runs[0].fetchedCount} new · ${source.runs[0].duplicateCount} duplicates`}</span>}</td><td><div className="form-actions"><button className="text-button" disabled={busy} onClick={() => void action(source, 'verify')}>Kiểm tra truy cập</button>{demo && source.enabled && <button className="text-button" disabled={busy} onClick={() => void action(source, 'sync')}>Đồng bộ ngay</button>}{mayAdmin(role) && <><button className="text-button" onClick={() => setEditing(source)}>Chỉnh sửa</button>{source.platform === 'MANUAL' && <button className="text-button" disabled={busy} onClick={() => void action(source, 'toggle')}>{source.enabled ? 'Tắt' : 'Bật'}</button>}<button className="text-button" onClick={() => setHistoryId(historyId === source.id ? '' : source.id)}>{historyId === source.id ? 'Ẩn lịch sử' : 'Runs'}</button><button className="text-button" disabled={busy} onClick={() => void action(source, 'delete')}>Xóa</button></>}</div></td></tr>;
      })}</tbody></table></div> : <EmptyState title="Chưa có nguồn">Add a manual source or a clearly labeled synthetic demo fixture.</EmptyState>}
      {historyId && <SourceHistory sourceId={historyId} />}{editing && <SourceEditor source={editing} channels={channels.data?.items ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); resource.reload(); }} />}
    </section>
    {mayAdmin(role) && <section className="panel form-panel"><h2>Thêm nguồn nội dung</h2>{channels.error && <ErrorNotice message={channels.error} retry={channels.reload} />}<form className="form-stack" onSubmit={create}><label>Nền tảng<select aria-label="Nền tảng" value={platform} onChange={event => setPlatform(event.target.value)}><option value="MANUAL">Nội dung tự nhập</option><option value="REDDIT">Reddit (approval required)</option><option value="THREADS">Threads (approval required)</option><option value="FACEBOOK">Facebook (licensed access required)</option></select></label><label>Mã nguồn<input name="sourceKey" required maxLength={150} placeholder="owned-story-archive" /></label><label>Kênh nội dung<select name="channelId" defaultValue=""><option value="">Chưa chọn kênh</option>{channels.data?.items.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      {platform === 'MANUAL' && <label>Chế độ<select value={mode} onChange={event => setMode(event.target.value)}><option value="USER_SUPPLIED">Nội dung tự nhập</option><option value="MOCK_FIXTURE">Synthetic demo discovery</option></select></label>}
      <label>Từ khóa<input name="keywords" maxLength={2000} placeholder="community, volunteers" /></label><label>Hashtags<input name="hashtags" maxLength={2000} placeholder="#community, #local" /></label><label>Chủ đề<input name="topics" maxLength={2000} placeholder="books, food, repair" /></label><label>Ngôn ngữ<input name="language" maxLength={20} placeholder="en or vi" /></label><label>Khoảng đồng bộ (phút)<input type="number" name="syncFrequencyMinutes" min={5} max={10080} defaultValue={1440} /></label>
      {platform === 'MANUAL' && <label className="checkbox-label"><input name="enabled" type="checkbox" defaultChecked /><span>Enable this source{mode === 'MOCK_FIXTURE' ? ' for scheduled demo sync' : ' for organizing manual imports'}</span></label>}{platform !== 'MANUAL' && <p className="field-help">This registers an external source as blocked. It will not fetch data until an approved adapter is implemented.</p>}
      <button className="button" disabled={busy}>{busy ? 'Saving…' : 'Lưu nguồn'}</button></form></section>}
    </div></>;
}

function csv(value: FormDataEntryValue | null): string[] { return String(value ?? '').split(',').map(term => term.trim()).filter(Boolean); }

function SourceHistory({ sourceId }: { sourceId: string }) {
  const resource = useResource(`/sources/${sourceId}/sync-runs?limit=20`, syncRunsListSchema);
  return <div className="panel"><h3>Lịch sử đồng bộ</h3>{resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading && !resource.data ? <p role="status" className="loading-state">Đang tải lịch sử…</p> : resource.data?.items.length ? <div className="table-scroll"><table><thead><tr><th>Bắt đầu</th><th>Trạng thái</th><th>Bài mới</th><th>Bài trùng</th><th>Lỗi</th></tr></thead><tbody>{resource.data.items.map(run => <tr key={run.id}><td>{new Date(run.startedAt).toLocaleString()}</td><td><StatusBadge value={run.status} /></td><td>{run.fetchedCount}</td><td>{run.duplicateCount}</td><td>{run.errorCode ?? '—'}</td></tr>)}</tbody></table></div> : <p className="muted">This source has no sync runs yet.</p>}</div>;
}

function SourceEditor({ source, channels, onClose, onSaved }: { source: Source; channels: z.infer<typeof channelSchema>[]; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const current = source.config;
    setBusy(true); setError('');
    try { await api(`/sources/${source.id}`, unknownResponseSchema, { method: 'PATCH', body: { sourceKey: String(form.get('sourceKey')), channelId: String(form.get('channelId')) || null, syncFrequencyMinutes: Number(form.get('syncFrequencyMinutes')), config: { ...current, mode: String(form.get('mode')), keywords: csv(form.get('keywords')), hashtags: csv(form.get('hashtags')), topics: csv(form.get('topics')), language: String(form.get('language') || '') || undefined } } }); onSaved(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <section className="panel form-panel"><div className="panel-heading"><div><h3>Chỉnh sửa nguồn</h3><p>{source.platform.toLowerCase()}</p></div><button className="text-button" onClick={onClose}>Đóng</button></div>{error && <ErrorNotice message={error} />}<form className="form-stack" onSubmit={save}><label>Mã nguồn<input name="sourceKey" defaultValue={source.sourceKey} maxLength={150} required /></label><label>Kênh nội dung<select name="channelId" defaultValue={source.channelId ?? ''}><option value="">Chưa chọn kênh</option>{channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label>Chế độ<select name="mode" defaultValue={source.config?.mode ?? 'USER_SUPPLIED'}><option value="USER_SUPPLIED">Tự nhập</option><option value="MOCK_FIXTURE">Dữ liệu thử</option></select></label><label>Từ khóa<input name="keywords" defaultValue={source.config?.keywords?.join(', ') ?? ''} /></label><label>Hashtags<input name="hashtags" defaultValue={source.config?.hashtags?.join(', ') ?? ''} /></label><label>Chủ đề<input name="topics" defaultValue={source.config?.topics?.join(', ') ?? ''} /></label><label>Ngôn ngữ<input name="language" defaultValue={source.config?.language ?? ''} maxLength={20} /></label><label>Khoảng đồng bộ (phút)<input type="number" name="syncFrequencyMinutes" min={5} max={10080} defaultValue={source.syncFrequencyMinutes ?? 1440} /></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Lưu nguồn'}</button></form></section>;
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
  return <section id="import" className="panel import-panel"><div className="panel-heading"><div><h2>Nhập nội dung nguồn</h2><p>Dán bài viết và bình luận được phép sử dụng ở dạng JSON.</p></div><button className="text-button" onClick={() => { setRaw(exampleImport); setAttested(false); setSuccess(''); }}>Dùng dữ liệu mẫu</button></div>{error && <ErrorNotice message={error} />}{success && <div className="notice success" role="status">{success}</div>}<form onSubmit={submit} className="form-stack"><label>Import JSON<textarea name="import" className="code-input" value={raw} onChange={(event) => setRaw(event.target.value)} rows={13} maxLength={200_000} required placeholder={'{\n  "platform": "MANUAL",\n  "externalPostId": "your-story-id",\n  …\n}'} spellCheck={false} aria-describedby="import-help" /></label><p id="import-help" className="field-help">Include externalPostId, canonicalUrl, body, comments and rights. Evidence, territory and permitted commercial/platform scope must be verified before approval. Example drafts start with unknown rights.</p><label className="checkbox-label"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} required /><span>I confirm I have authority to import this post and its comments. Public visibility alone does not grant reuse rights.</span></label><div className="form-actions"><p className="field-help">Importing does not approve or schedule publication.</p><button className="button" disabled={busy}>{busy ? 'Đang nhập…' : 'Nhập bài viết'}<span aria-hidden="true">↥</span></button></div></form></section>;
}

function CandidateLibrary() {
  const { role } = useSession();
  const [query, setQuery] = useState(''); const [platform, setPlatform] = useState(''); const [topic, setTopic] = useState(''); const [minScore, setMinScore] = useState(''); const [sort, setSort] = useState('SCORE_DESC'); const [cursor, setCursor] = useState('');
  const [selectedId, setSelectedId] = useState(''); const [actionError, setActionError] = useState(''); const [busy, setBusy] = useState(false);
  const params = new URLSearchParams({ limit: '25', sort });
  if (query) params.set('q', query); if (platform) params.set('platform', platform); if (topic) params.set('topic', topic); if (minScore) params.set('minScore', minScore); if (cursor) params.set('cursor', cursor);
  const resource = useResource(`/candidates?${params.toString()}`, candidatesListSchema);
  const selected = resource.data?.items.find(candidate => candidate.id === selectedId) ?? null;
  function refresh() { resource.reload(); setSelectedId(''); }
  async function review(candidateId: string, decision: 'APPROVED' | 'REJECTED') {
    setBusy(true); setActionError('');
    try { await api(`/candidates/${candidateId}/review`, unknownResponseSchema, { method: 'POST', body: { decision } }); refresh(); }
    catch (failure) { setActionError(errorMessage(failure)); } finally { setBusy(false); }
  }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setQuery(String(form.get('query')).trim()); setTopic(String(form.get('topic')).trim()); setMinScore(String(form.get('minScore')).trim()); setPlatform(String(form.get('platform'))); setSort(String(form.get('sort'))); setCursor(''); setSelectedId(''); }
  return <>
    <section className="panel"><div className="panel-heading"><div><h2>Bài viết được đề xuất</h2><p>Explainable scores with source provenance, duplicate counts and rights checks.</p></div><button className="text-button" onClick={resource.reload}>Làm mới</button></div>
      <form className="search-form" role="search" onSubmit={search}><label className="sr-only" htmlFor="candidate-search">Tìm bài đề xuất</label><input id="candidate-search" name="query" type="search" placeholder="Search titles or text…" maxLength={200} defaultValue={query} /><label><span className="sr-only">Nền tảng</span><select name="platform" defaultValue={platform}><option value="">Tất cả nền tảng</option><option value="MANUAL">Tự nhập / dữ liệu thử</option><option value="REDDIT">Reddit</option><option value="THREADS">Threads</option><option value="FACEBOOK">Facebook</option></select></label><label><span className="sr-only">Chủ đề</span><input name="topic" placeholder="Chủ đề" maxLength={80} defaultValue={topic} /></label><label><span className="sr-only">Điểm tối thiểu</span><input name="minScore" type="number" min={0} max={100} placeholder="Điểm tối thiểu" defaultValue={minScore} /></label><label><span className="sr-only">Sắp xếp bài</span><select name="sort" defaultValue={sort}><option value="SCORE_DESC">Điểm cao nhất</option><option value="SCORE_ASC">Điểm thấp nhất</option><option value="NEWEST">Mới nhất</option></select></label><button className="button secondary small">Lọc</button></form>
      {resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading && !resource.data ? <p role="status" className="loading-state">Loading candidate scores…</p> : resource.data?.items.length ? <div className="table-scroll"><table><caption className="sr-only">Discovered content and score review</caption><thead><tr><th>Bài viết</th><th>Nguồn</th><th>Điểm</th><th>Quyền sử dụng</th><th>Trạng thái bài</th></tr></thead><tbody>{resource.data.items.map(candidate => <tr key={candidate.id} className={selectedId === candidate.id ? 'selected-row' : ''}><td><button className="text-button" onClick={() => setSelectedId(candidate.id)}>{candidate.post.title || 'Bài chưa có tiêu đề'}<span className="cell-detail">{candidate.post.topicTags?.join(', ') || candidate.post.externalPostId}</span></button></td><td>{candidate.post.platform.toLowerCase()}{candidate.post.synthetic && <span className="cell-detail">synthetic demo</span>}</td><td><strong>{candidate.score === null ? '—' : Math.round(candidate.score)}</strong><span className="cell-detail">minimum {Math.round(candidate.minimumScore)}</span></td><td><StatusBadge value={candidate.post.rights[0]?.reviewStatus ?? 'PENDING'} /></td><td><StatusBadge value={candidate.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="Chưa có bài đề xuất">Import authorized material or enable a synthetic demo source and run a sync.</EmptyState>}
      {(cursor || resource.data?.nextCursor) && <div className="pagination"><button className="text-button" disabled={!cursor} onClick={() => { setCursor(''); setSelectedId(''); }}>Trang đầu</button><button className="button small secondary" disabled={!resource.data?.nextCursor} onClick={() => { setCursor(resource.data?.nextCursor ?? ''); setSelectedId(''); }}>Trang tiếp →</button></div>}
    </section>
    {selected && <section className="panel"><div className="panel-heading"><div><h2>{selected.post.title || 'Bài chưa có tiêu đề'}</h2><p>{selected.post.platform.toLowerCase()} · <a href={selected.post.canonicalUrl} target="_blank" rel="noreferrer">Mở nguồn</a>{selected.post.synthetic ? ' · synthetic demo data' : ''}</p></div><button className="text-button" onClick={() => setSelectedId('')}>Đóng chi tiết</button></div>
      {actionError && <ErrorNotice message={actionError} />}
      <div className="detail-grid"><div><h3>Nội dung gốc</h3><p className="source-body">{selected.post.body}</p><StatusBadge value={selected.post.rights[0]?.reviewStatus ?? 'PENDING'} /><p className="field-help">Rights basis: {selected.post.rights[0]?.basis ?? 'UNKNOWN'} · comments: {selected.post._count?.comments ?? selected.post.comments?.length ?? 0}</p>{selected.post.sensitiveFlags?.length ? <p className="notice">Safety review flags: {selected.post.sensitiveFlags.join(', ')}</p> : null}</div>
        <div><h3>Score breakdown <span className="badge neutral">{selected.modelVersion ?? 'heuristic'}</span></h3><p className="score-total">{selected.score === null ? 'Chưa chấm điểm' : `${Math.round(selected.score)} / 100`}<span className="field-help">{selected.reasoning}</span></p>{selected.factors?.factors && <dl className="detail-list">{Object.entries(selected.factors.factors).map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd>{value === null ? 'Chưa có dữ liệu' : Math.round(value)}</dd></div>)}</dl>}<h3>Số tương tác đã lưu</h3>{selected.post.metricSnapshots?.[0] ? <p>{selected.post.metricSnapshots[0].likes ?? '—'} likes · {selected.post.metricSnapshots[0].replies ?? '—'} comments · {selected.post.metricSnapshots[0].shares ?? '—'} shares · {selected.post.metricSnapshots[0].views ?? '—'} views</p> : <p className="muted">Engagement metrics were unavailable.</p>}</div></div>
      <div className="panel"><h3>Bình luận đã lưu</h3>{selected.post.comments?.length ? <ul>{selected.post.comments.map(comment => <li key={comment.id}>{comment.body}</li>)}</ul> : <p className="muted">No comments were available for this source.</p>}</div>
      <div className="form-actions"><p className="field-help">Approval requires a completed rights review, no unresolved safety flags and a score above the channel threshold.</p>{selected.status === 'NEEDS_RIGHTS_REVIEW' && <Link className="button secondary" href="/reviews">Duyệt quyền trước</Link>}{mayReview(role) && !['APPROVED', 'REJECTED', 'BLOCKED_RIGHTS', 'BLOCKED_SAFETY', 'BELOW_THRESHOLD', 'DUPLICATE'].includes(selected.status) && <><button className="button danger" disabled={busy} onClick={() => void review(selected.id, 'REJECTED')}>Không chọn bài</button><button className="button" disabled={busy || selected.status !== 'PENDING_REVIEW'} onClick={() => void review(selected.id, 'APPROVED')}>Chọn bài</button></>}</div>
    </section>}
    {mayEdit(role) && <ManualImport onImported={refresh} />}{!mayEdit(role) && <div className="notice">Your role has read access to this library. An owner, admin or editor can import source material.</div>}
  </>;
}

function LibraryHub() {
  const [view, setView] = useState<'posts' | 'candidates'>('posts');
  return <><div className="form-actions" role="group" aria-label="Chế độ xem"><button className={`button ${view === 'posts' ? '' : 'secondary'}`} aria-pressed={view === 'posts'} onClick={() => setView('posts')}>Tất cả bài đã lưu</button><button className={`button ${view === 'candidates' ? '' : 'secondary'}`} aria-pressed={view === 'candidates'} onClick={() => setView('candidates')}>Bài đã chấm điểm</button></div>{view === 'posts' ? <Library /> : <CandidateLibrary />}</>;
}

function Library({ reviewMode = false }: { reviewMode?: boolean }) {
  const { role } = useSession(); const [query, setQuery] = useState(''); const [selected, setSelected] = useState<Post | null>(null); const [cursor, setCursor] = useState('');
  const resource = useResource(`/posts?limit=25${query ? `&q=${encodeURIComponent(query)}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, postsListSchema);
  const posts = resource.data?.items.filter((post) => !reviewMode || post.rights.some((right) => right.reviewStatus !== 'APPROVED')) ?? [];
  function refresh() { resource.reload(); setSelected(null); }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setQuery(String(form.get('query')).trim()); setCursor(''); setSelected(null); }
  return <>
    {reviewMode && <div className="notice"><strong>Rights approval is an explicit decision.</strong><span>Verify evidence, territory, attribution, commercial use and target platforms. Unknown or revoked rights cannot be approved.</span></div>}
    <section className="panel"><div className="panel-heading"><div><h2>{reviewMode ? 'Nội dung chờ duyệt quyền' : 'Thư viện bài viết'}</h2><p>{reviewMode ? 'Imported material is held until an authorized reviewer approves its use.' : 'Nội dung gốc luôn đi cùng nguồn và bình luận đã lưu.'}</p></div><form className="search-form" role="search" onSubmit={search}><label className="sr-only" htmlFor="post-search">Tìm bài viết</label><input id="post-search" name="query" type="search" placeholder="Tìm bài viết…" maxLength={200} /><button className="button secondary small">Tìm kiếm</button></form></div>
      {resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading && !resource.data ? <p role="status" className="loading-state">Loading source material…</p> : posts.length ? <div className="table-scroll"><table><caption className="sr-only">{reviewMode ? 'Stories requiring rights review' : 'Bài đã nhập'}</caption><thead><tr><th>Bài viết</th><th>Nguồn</th><th>Bình luận</th><th>Rights review</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{posts.map((post) => <tr key={post.id}><td><strong>{post.title || 'Bài chưa có tiêu đề'}</strong><span className="cell-detail">{post.externalPostId}</span></td><td>{post.platform.toLowerCase()}</td><td>{post._count?.comments ?? 0}</td><td><StatusBadge value={post.rights[0]?.reviewStatus ?? 'PENDING'} /><span className="cell-detail">{(post.rights[0]?.basis ?? 'UNKNOWN').replaceAll('_', ' ').toLowerCase()}</span></td><td><button className="text-button" onClick={() => setSelected(post)}>{reviewMode ? 'Review' : 'Open'} <span aria-hidden="true">↗</span></button></td></tr>)}</tbody></table></div> : <EmptyState title={reviewMode ? 'No pending material on this page' : query ? 'No matching stories' : 'Your library is ready'}>{reviewMode ? 'New imports requiring review will appear here.' : query ? 'Try a different title or phrase.' : 'Import your first authorized story and comments below.'}</EmptyState>}
      {(cursor || resource.data?.nextCursor) && <div className="pagination"><button className="text-button" disabled={!cursor} onClick={() => { setCursor(''); setSelected(null); }}>Trang đầu</button><button className="button small secondary" disabled={!resource.data?.nextCursor} onClick={() => { setCursor(resource.data?.nextCursor ?? ''); setSelected(null); }}>Trang tiếp →</button></div>}
    </section>
    {selected && <PostInspector key={selected.id} post={selected} reviewMode={reviewMode} onClose={() => setSelected(null)} onChanged={refresh} />}
    {!reviewMode && mayEdit(role) && <ManualImport onImported={refresh} />}
    {!reviewMode && !mayEdit(role) && <div className="notice">Your role has read access to this library. An owner, admin or editor can import source material.</div>}
    {reviewMode && !mayReview(role) && <div className="notice">Your role can view source material. An owner, admin or reviewer must make rights decisions.</div>}
  </>;
}

export function PostInspector({ post, reviewMode, onClose, onChanged }: { post: Post; reviewMode: boolean; onClose: () => void; onChanged: () => void }) {
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
  return <section className="panel inspector" aria-label="Selected story detail"><div className="panel-heading"><div><h2>{post.title || 'Bài chưa có tiêu đề'}</h2><a href={post.canonicalUrl} target="_blank" rel="noopener noreferrer" className="source-link">{post.canonicalUrl} ↗</a></div><button className="button small secondary" onClick={onClose}>Đóng</button></div>{error && <ErrorNotice message={error} />}
    <div className="inspector-grid"><div><h3>Original source text</h3><p className="source-body">{post.body}</p><h3>Source comments</h3>{comments.error ? <ErrorNotice message={comments.error} retry={comments.reload} /> : comments.loading && !comments.data ? <p role="status">Loading comments…</p> : comments.data?.items.length ? <ol className="comment-list">{comments.data.items.map((comment) => <li key={comment.id}><span className="comment-id">{comment.externalId}</span><p>{comment.body}</p></li>)}</ol> : <p className="muted">No comments were imported.</p>}</div>
      <div className="rights-summary"><h3>Rights record</h3><dl className="detail-list"><div><dt>Basis</dt><dd><StatusBadge value={right?.basis ?? 'UNKNOWN'} /></dd></div><div><dt>Review</dt><dd><StatusBadge value={right?.reviewStatus ?? 'PENDING'} /></dd></div><div><dt>Attestation</dt><dd>{right?.attested ? 'Thời điểm' : 'Missing'}</dd></div><div><dt>Commercial use</dt><dd>{right?.commercialAllowed ? 'Permitted by attestation' : 'Not permitted'}</dd></div><div><dt>Platforms</dt><dd>{right?.allowedPlatforms.join(', ') || 'None permitted'}</dd></div><div><dt>Lãnh thổ</dt><dd>{right?.territory || 'Unspecified'}</dd></div><div><dt>Expiry</dt><dd>{right?.expiresAt ? new Date(right.expiresAt).toLocaleDateString() : 'No expiry recorded'}</dd></div><div><dt>Ghi công</dt><dd>{right?.attributionRequired ? right.attributionText || 'Required; text missing' : 'Not required'}</dd></div></dl><h4>Bằng chứng</h4><p className="evidence-text">{right?.evidence || 'No supporting evidence supplied yet.'}</p>
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
        <label>Lãnh thổ<input name="territory" defaultValue={right?.territory === 'UNSPECIFIED' ? '' : right?.territory} placeholder="e.g. WORLDWIDE, if your rights permit" maxLength={100} required={decision === 'APPROVED'} /></label>
        <label>Rights valid through (UTC)<input name="expiresAt" type="date" defaultValue={right?.expiresAt?.slice(0, 10) ?? ''} /></label>
        <p className="field-help">Leave blank only when the verified rights have no expiry.</p>
        <label className="checkbox-label"><input type="checkbox" checked={attributionRequired} onChange={(event) => setAttributionRequired(event.target.checked)} /><span>Attribution is required.</span></label>
        <label>Attribution text<input name="attributionText" defaultValue={right?.attributionText ?? ''} maxLength={2000} required={decision === 'APPROVED' && attributionRequired} /></label>
      </div></div>
      <label className="checkbox-label review-attestation"><input name="attested" type="checkbox" required={decision === 'APPROVED'} /><span>I have checked the evidence and confirm this rights basis and permitted use for the post and its comments.</span></label>
      <div className="form-actions"><label>Decision<select aria-label="Decision" value={decision} onChange={(event) => setDecision(event.target.value)}><option value="APPROVED">Approve verified permitted use</option><option value="REJECTED">Reject use</option></select></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Record decision'}</button></div>
      {basis === 'UNKNOWN' && <p className="field-help">Unknown rights remain blocked. Select a verified basis and document its evidence to approve use.</p>}
    </form>}
    {mayAdmin(role) && <details className="takedown-section"><summary>Author deletion or takedown request</summary><p className="field-help">This removes source text and comments, revokes associated rights and blocks downstream use. Keep the reason free of unnecessary personal data.</p><form className="form-actions" onSubmit={takedown}><label>Lý do<input name="reason" required minLength={5} maxLength={500} placeholder="Author requested removal" /></label><button className="button danger" disabled={busy}>Register takedown</button></form></details>}
  </section>;
}

function Settings() {
  const { session, role, refresh } = useSession(); const workspace = session.workspaces.find((item) => item.id === session.activeWorkspaceId);
  return <><div className="split-layout"><section className="panel form-panel"><h2>Workspace đang dùng</h2><dl className="detail-list"><div><dt>Tên</dt><dd>{workspace?.name}</dd></div><div><dt>Vai trò của bạn</dt><dd>{role?.toLowerCase()}</dd></div><div><dt>Workspace ID</dt><dd className="mono">{session.activeWorkspaceId}</dd></div></dl><p className="field-help">Your active workspace is verified against membership on the server for every request.</p><div className="notice"><strong>Kiểm tra quyền trước khi sử dụng</strong><span>Điểm và đề xuất hỗ trợ chọn nội dung. Chúng không tự tạo lịch đăng bài.</span></div></section><section className="panel form-panel"><h2>Tạo workspace khác</h2><p className="muted">Nội dung và quyền được lưu riêng cho từng workspace.</p><WorkspaceForm onCreated={refresh} /></section></div><TopicRules />{mayAdmin(role) && <><Members /><AuditLog /></>}</>;
}

function TopicRules() {
  const { role } = useSession(); const rules = useResource('/topic-rules?limit=100', topicRulesListSchema); const channels = useResource('/channels?limit=100', channelsListSchema);
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
  return <section id="topic-rules" className="panel"><div className="panel-heading"><div><h2>Quy tắc chọn nội dung</h2><p>Set channel vocabulary, excluded topics and minimum candidate scores.</p></div></div>
    {error && <ErrorNotice message={error} />}{rules.error && <ErrorNotice message={rules.error} retry={rules.reload} />}
    {rules.loading && !rules.data ? <p role="status" className="loading-state">Loading topic rules…</p> : rules.data?.items.length ? <div className="channel-grid">{rules.data.items.map(rule => <article key={rule.id} className="channel-item"><div className="panel-heading"><h3>{rule.name}</h3><StatusBadge value={rule.enabled ? 'ENABLED' : 'DISABLED'} /></div><p>{channels.data?.items.find(channel => channel.id === rule.channelId)?.name ?? 'Kênh'}</p><p>Minimum score: {rule.minimumScore}</p><p className="field-help">Keywords: {rule.keywords.join(', ') || 'none'} · topics: {rule.topics.join(', ') || 'none'}</p><p className="field-help">Exclude: {rule.deny.join(', ') || 'none'}</p>{mayAdmin(role) && <div className="form-actions"><button className="text-button" disabled={busy} onClick={() => void toggle(rule.id, rule.enabled)}>{rule.enabled ? 'Tắt' : 'Bật'}</button><button className="text-button" onClick={() => setEditingId(editingId === rule.id ? '' : rule.id)}>Chỉnh sửa</button><button className="text-button" disabled={busy} onClick={() => void remove(rule.id)}>Xóa</button></div>}{editingId === rule.id && mayAdmin(role) && <TopicRuleEditor rule={rule} onSaved={() => { setEditingId(''); rules.reload(); }} />}</article>)}</div> : <EmptyState title="No topic rules yet">Add rules to score candidates against each channel direction.</EmptyState>}
    {mayAdmin(role) && <form className="form-stack member-form" onSubmit={create}><h3>Add topic rule</h3>{channels.error && <ErrorNotice message={channels.error} retry={channels.reload} />}<label>Kênh nội dung<select name="channelId" required defaultValue=""><option value="" disabled>Select a channel</option>{channels.data?.items.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label>Rule name<input name="name" required maxLength={100} placeholder="Local community stories" /></label><label>Từ khóa<input name="keywords" maxLength={2000} placeholder="community, volunteers" /></label><label>Hashtags<input name="hashtags" maxLength={2000} placeholder="#local" /></label><label>Chủ đề<input name="topics" maxLength={2000} placeholder="books, food, repair" /></label><label>Allow terms<input name="allow" maxLength={2000} placeholder="shared space" /></label><label>Exclude terms<input name="deny" maxLength={2000} placeholder="advertisement, giveaway" /></label><label>Ngôn ngữ<input name="language" maxLength={20} placeholder="en or vi" /></label><label>Điểm tối thiểu<input name="minimumScore" type="number" min={0} max={100} defaultValue={55} /></label><label className="checkbox-label"><input name="enabled" type="checkbox" defaultChecked /><span>Rule is enabled</span></label><button className="button" disabled={busy || !channels.data?.items.length}>{busy ? 'Saving…' : 'Add topic rule'}</button></form>}
  </section>;
}

function TopicRuleEditor({ rule, onSaved }: { rule: z.infer<typeof topicRuleSchema>; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await api(`/topic-rules/${rule.id}`, unknownResponseSchema, { method: 'PATCH', body: { name: String(form.get('name')), keywords: csv(form.get('keywords')), hashtags: csv(form.get('hashtags')), topics: csv(form.get('topics')), allow: csv(form.get('allow')), deny: csv(form.get('deny')), language: String(form.get('language') || '') || undefined, minimumScore: Number(form.get('minimumScore')) } }); onSaved(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <form className="form-stack" onSubmit={save}>{error && <ErrorNotice message={error} />}<label>Tên<input name="name" defaultValue={rule.name} maxLength={100} required /></label><label>Từ khóa<input name="keywords" defaultValue={rule.keywords.join(', ')} /></label><label>Hashtags<input name="hashtags" defaultValue={rule.hashtags.join(', ')} /></label><label>Chủ đề<input name="topics" defaultValue={rule.topics.join(', ')} /></label><label>Allow terms<input name="allow" defaultValue={rule.allow.join(', ')} /></label><label>Exclude terms<input name="deny" defaultValue={rule.deny.join(', ')} /></label><label>Ngôn ngữ<input name="language" defaultValue={rule.language ?? ''} maxLength={20} /></label><label>Điểm tối thiểu<input name="minimumScore" type="number" min={0} max={100} defaultValue={rule.minimumScore} /></label><button className="button small" disabled={busy}>{busy ? 'Saving…' : 'Lưu quy tắc'}</button></form>;
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
  return <section className="panel"><div className="panel-heading"><div><h2>Thành viên workspace</h2><p>Quyền truy cập chỉ áp dụng trong workspace này. Chủ sở hữu hiện tại được bảo vệ.</p></div></div>
    {resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}
    {resource.loading && !resource.data ? <p className="loading-state" role="status">Loading members…</p> : resource.data?.items.length ? <div className="table-scroll"><table><caption className="sr-only">Workspace membership roles</caption><thead><tr><th>Member</th><th>Email</th><th>Vai trò</th></tr></thead><tbody>{resource.data.items.map((member) => <tr key={member.userId}><td><strong>{member.name || 'Workspace member'}</strong></td><td>{member.email}</td><td><span className="badge neutral">{member.role.toLowerCase()}</span></td></tr>)}</tbody></table></div> : <EmptyState title="No members to display">Workspace members and their roles appear here.</EmptyState>}
    <form className="member-form" onSubmit={save}><h3>Add or update registered member</h3><p className="field-help">The person must create an account first. Reviewers can review rights; editors can import source material.</p>{error && <ErrorNotice message={error} />}{success && <p className="notice success" role="status">{success}</p>}<div className="form-actions"><label>Email thành viên<input name="email" type="email" required maxLength={254} placeholder="editor@your-team.example" /></label><label>Workspace role<select aria-label="Workspace role" name="role" defaultValue="VIEWER"><option value="VIEWER">Viewer</option><option value="EDITOR">Editor</option><option value="REVIEWER">Reviewer</option><option value="ADMIN">Admin</option></select></label><button className="button" disabled={busy}>{busy ? 'Saving…' : 'Lưu quyền truy cập'}</button></div></form>
  </section>;
}

function AuditLog() {
  const resource = useResource('/audit-logs?limit=25', auditsListSchema);
  return <section className="panel"><div className="panel-heading"><div><h2>Nhật ký gần đây</h2><p>Nhật ký thao tác của workspace, không chứa nội dung riêng tư hay thông tin đăng nhập.</p></div><button className="text-button" onClick={resource.reload}>Làm mới</button></div>{resource.error && <ErrorNotice message={resource.error} retry={resource.reload} />}{resource.loading && !resource.data ? <p role="status" className="loading-state">Đang tải nhật ký…</p> : resource.data?.items.length ? <div className="table-scroll"><table><caption className="sr-only">Workspace audit events</caption><thead><tr><th>Thao tác</th><th>Tài nguyên</th><th>Thời điểm</th></tr></thead><tbody>{resource.data.items.map((event) => <tr key={event.id}><td><strong>{event.action.replaceAll('_', ' ').toLowerCase()}</strong></td><td>{event.resourceType}<span className="cell-detail mono">{event.resourceId}</span></td><td>{new Date(event.occurredAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState title="Chưa có nhật ký">Các thao tác trong workspace sẽ được ghi tại đây.</EmptyState>}</section>;
}
