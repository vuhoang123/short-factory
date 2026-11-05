'use client';

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="notice error" role="alert"><span>{message}</span>{retry && <button className="button small secondary" onClick={retry}>Thử lại</button>}</div>;
}

export function StatusBadge({ value }: { value: string }) {
  const tone = ['APPROVED', 'AVAILABLE', 'ACTIVE', 'OWNED'].includes(value) ? 'positive' : ['REJECTED', 'BLOCKED', 'BLOCKED_RIGHTS', 'UNKNOWN'].includes(value) ? 'negative' : 'neutral';
  return <span className={`badge ${tone}`}>{value.replaceAll('_', ' ').toLowerCase()}</span>;
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="empty-state"><h3>{title}</h3><p>{children}</p></div>;
}
