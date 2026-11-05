import { Suspense, type ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';

export default function WorkspaceLayout({ children }: { children: ReactNode }) { return <Suspense fallback={<main id="main-content" className="initial-loading"><p role="status">Đang mở workspace…</p></main>}><AppShell>{children}</AppShell></Suspense>; }
