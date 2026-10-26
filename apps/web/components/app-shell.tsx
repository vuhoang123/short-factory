'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, errorMessage } from '../lib/api';
import { sessionSchema, unknownResponseSchema, type Session } from '../lib/contracts';
import { ErrorNotice } from './feedback';

type SessionContextValue = { session: Session; refresh: () => Promise<void>; role: Session['workspaces'][number]['role'] | undefined };
const SessionContext = createContext<SessionContextValue | null>(null);
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('Workspace UI needs an authenticated session.');
  return context;
}

const navigation = [
  { path: '/dashboard', label: 'Overview', mark: '▦' },
  { path: '/channels', label: 'Content channels', mark: '▤' },
  { path: '/sources', label: 'Sources', mark: '↗' },
  { path: '/library/posts', label: 'Post library', mark: '▧' },
  { path: '/reviews', label: 'Rights reviews', mark: '✓' },
  { path: '/settings', label: 'Workspace settings', mark: '⚙' },
];

export function WorkspaceForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      await api('/workspaces', unknownResponseSchema, { method: 'POST', body: { name: String(form.get('name')), slug: String(form.get('slug')) } });
      await onCreated();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  return <form className="form-stack" onSubmit={create}>
    {error && <ErrorNotice message={error} />}
    <label>Workspace name<input name="name" required minLength={2} maxLength={100} placeholder="Your editorial team" /></label>
    <label>Workspace slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" minLength={3} maxLength={60} placeholder="your-team" aria-describedby="workspace-slug-help" /></label>
    <p className="field-help" id="workspace-slug-help">Use lowercase letters, numbers and hyphens.</p>
    <button className="button" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
  </form>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState(''); const [switching, setSwitching] = useState(false);
  const refresh = useCallback(async () => {
    setSession(null);
    try { setSession(await api('/auth/me', sessionSchema)); setError(''); }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) router.replace('/login'); else setError(errorMessage(failure)); }
  }, [router]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!session) return <main id="main-content" className="initial-loading">{error ? <ErrorNotice message={error} retry={() => void refresh()} /> : <p role="status">Opening your workspace…</p>}</main>;
  const workspace = session.workspaces.find((item) => item.id === session.activeWorkspaceId);
  const value: SessionContextValue = { session, refresh, role: workspace?.role };

  async function selectWorkspace(id: string) {
    setSwitching(true); setError('');
    try { await api('/auth/workspace', unknownResponseSchema, { method: 'POST', body: { workspaceId: id } }); await refresh(); router.refresh(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setSwitching(false); }
  }
  async function logout() {
    try { await api('/auth/logout', unknownResponseSchema, { method: 'POST' }); router.replace('/login'); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  return <SessionContext.Provider value={value}>
    <div className="app-layout">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand"><span className="brand-mark" aria-hidden="true">sf</span>shorts factory</Link>
        <div className="workspace-picker"><label htmlFor="active-workspace">Workspace</label><select id="active-workspace" value={session.activeWorkspaceId ?? ''} onChange={(event) => void selectWorkspace(event.target.value)} disabled={switching || session.workspaces.length === 0}>{!workspace && <option value="">No workspace selected</option>}{session.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{workspace && <span className="workspace-role">{workspace.role.toLowerCase()} access</span>}</div>
        <nav aria-label="Main navigation">{navigation.map((item) => <Link key={item.path} href={item.path} className={`nav-link${pathname === item.path ? ' active' : ''}`} aria-current={pathname === item.path ? 'page' : undefined}><span aria-hidden="true">{item.mark}</span>{item.label}</Link>)}</nav>
        <div className="sidebar-bottom"><div className="phase-note"><span className="status-dot" aria-hidden="true" /><strong>Human-reviewed workspace</strong><p>Discover, score and check rights.</p></div><div className="user-row"><span className="avatar" aria-hidden="true">{(session.user.name || session.user.email).slice(0, 1).toUpperCase()}</span><div><strong>{session.user.name || 'Workspace member'}</strong><span>{session.user.email}</span></div></div><button className="text-button signout" onClick={() => void logout()}>Sign out <span aria-hidden="true">↪</span></button></div>
      </aside>
      <div className="workspace-main"><header className="topbar"><span>Editorial workspace</span><span className="topbar-mode"><span className="status-dot" aria-hidden="true" />Manual import enabled</span><button className="text-button mobile-signout" onClick={() => void logout()}>Sign out</button></header>
        <main id="main-content" className="page-content" key={session.activeWorkspaceId ?? 'unselected'}>
          {error && <ErrorNotice message={error} />}
          {workspace ? children : <section className="welcome-panel"><span className="eyebrow">LET’S GET STARTED</span><h1>Create your workspace</h1><p className="muted">Keep your channels, source material and rights reviews together. You will be its owner.</p><WorkspaceForm onCreated={refresh} /></section>}
        </main>
      </div>
    </div>
  </SessionContext.Provider>;
}
