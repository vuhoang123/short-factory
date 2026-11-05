'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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

const tools = [
  { path: '/dashboard', label: 'Tổng quan' }, { path: '/export', label: 'Lịch sử & phục hồi' },
  { path: '/channels', label: 'Kênh nội dung' }, { path: '/sources', label: 'Nguồn nội dung' },
  { path: '/library/posts', label: 'Bài đã lưu' }, { path: '/reviews', label: 'Duyệt quyền sử dụng' },
  { path: '/publish', label: 'Bàn giao video' }, { path: '/analytics', label: 'Số liệu nội dung' },
  { path: '/autopilot', label: 'Tự động hóa' }, { path: '/settings', label: 'Cài đặt workspace' },
  { path: '/guide', label: 'Hướng dẫn sử dụng' },
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
    <label>Tên workspace<input name="name" required minLength={2} maxLength={100} placeholder="Không gian sáng tạo của bạn" /></label>
    <label>Mã workspace<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" minLength={3} maxLength={60} placeholder="studio-cua-ban" aria-describedby="workspace-slug-help" /></label>
    <p className="field-help" id="workspace-slug-help">Dùng chữ thường không dấu, số và dấu gạch ngang.</p>
    <button className="button" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo workspace'}</button>
  </form>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(); const searchParams = useSearchParams(); const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const sessionRequest = useRef(0);
  const [error, setError] = useState(''); const [switching, setSwitching] = useState(false);
  const refresh = useCallback(async () => {
    const request = ++sessionRequest.current;
    try {
      const next = await api('/auth/me', sessionSchema);
      if (request !== sessionRequest.current) return;
      setSession(next); setError('');
    } catch (failure) {
      if (request !== sessionRequest.current) return;
      if (failure instanceof ApiError && failure.status === 401) { setSession(null); router.replace('/login'); } else setError(errorMessage(failure));
    }
  }, [router]);
  useEffect(() => { void refresh(); return () => { sessionRequest.current++; }; }, [refresh]);

  if (!session) return <main id="main-content" className="initial-loading">{error ? <ErrorNotice message={error} retry={() => void refresh()} /> : <p role="status">Đang mở workspace của bạn…</p>}</main>;
  const workspace = session.workspaces.find((item) => item.id === session.activeWorkspaceId);
  const value: SessionContextValue = { session, refresh, role: workspace?.role };

  async function selectWorkspace(id: string) {
    sessionRequest.current++;
    setSwitching(true); setError('');
    try { await api('/auth/workspace', unknownResponseSchema, { method: 'POST', body: { workspaceId: id } }); setSession(null); await refresh(); router.refresh(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setSwitching(false); }
  }
  async function logout() {
    sessionRequest.current++;
    try { await api('/auth/logout', unknownResponseSchema, { method: 'POST' }); router.replace('/login'); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  return <SessionContext.Provider value={value}>
    <div className="app-layout">
      <header className="site-header">
        <Link href="/studio" className="brand">Shorts Factory</Link>
        <nav className="primary-navigation" aria-label="Điều hướng chính">{[
          { path: '/studio', label: 'Tạo video', active: pathname === '/studio' && searchParams.get('view') !== 'videos' },
          { path: '/studio?view=videos', label: 'Video của bạn', active: pathname === '/studio' && searchParams.get('view') === 'videos' },
          { path: '/discover', label: 'Thư viện', active: pathname === '/discover' },
        ].map(item => <Link key={item.path} href={item.path} className={`nav-link${item.active ? ' active' : ''}`} aria-current={item.active ? 'page' : undefined}>{item.label}</Link>)}</nav>
        <details className="account-menu" key={pathname + searchParams.toString()}>
          <summary>Công cụ & tài khoản</summary>
          <div className="account-menu-content">
            <div className="workspace-picker"><label htmlFor="active-workspace">Workspace đang dùng</label><select id="active-workspace" value={session.activeWorkspaceId ?? ''} onChange={event => void selectWorkspace(event.target.value)} disabled={switching || session.workspaces.length === 0}>{!workspace && <option value="">Chưa chọn workspace</option>}{session.workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{workspace && <span className="workspace-role">Vai trò: {workspace.role}</span>}</div>
            <nav className="secondary-navigation" aria-label="Công cụ workspace">{tools.map(item => <Link key={item.path} href={item.path} className="nav-link" aria-current={pathname === item.path ? 'page' : undefined}>{item.label}</Link>)}</nav>
            <div className="account-footer"><strong>{session.user.name || session.user.email}</strong><button className="text-button" onClick={() => void logout()}>Đăng xuất</button></div>
          </div>
        </details>
      </header>
      <div className="workspace-main">
        <main id="main-content" className="page-content" key={session.activeWorkspaceId ?? 'unselected'}>
          {error && <ErrorNotice message={error} />}
          {workspace || pathname === '/guide' ? children : <section className="welcome-panel"><h1>Tạo workspace của bạn</h1><p className="muted">Lưu bài viết, kịch bản và video trong cùng một nơi.</p><WorkspaceForm onCreated={refresh} /></section>}
        </main>
      </div>
    </div>
  </SessionContext.Provider>;
}
