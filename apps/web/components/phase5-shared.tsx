'use client';

export { useResource as usePhase5Resource } from '../lib/use-resource';

export function formatCount(value: number | null | undefined) { return value === null || value === undefined ? 'Unavailable' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value); }
export function formatUsd(value: number | null | undefined) { return value === null || value === undefined ? 'Unavailable' : new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(value); }
export function formatPercent(value: number | null | undefined) { return value === null || value === undefined ? 'Unavailable' : `${(value * 100).toFixed(1)}%`; }
export function formatTime(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : 'Not recorded'; }
export function commaList(value: FormDataEntryValue | null) { return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean); }

export function DataDetails({ value, label = 'View details' }: { value: unknown; label?: string }) {
  if (value === null || value === undefined) return null;
  return <details className="phase5-details"><summary>{label}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}

export function Stat({ title, value, note }: { title: string; value: string | number; note?: string }) {
  return <article className="metric"><div>{title}</div><strong className={value === 'Unavailable' ? 'phase5-metric-unavailable' : undefined}>{value}</strong>{note && <p>{note}</p>}</article>;
}
