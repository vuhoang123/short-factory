'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorMessage } from '../lib/api';

export function usePhase5Resource<T extends z.ZodType>(path: string, schema: T, refreshMs = 0) {
  const [data, setData] = useState<z.infer<T> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = async () => {
      try {
        const next = await api(path, schema);
        if (active) { setData(next); setError(''); }
      } catch (failure) { if (active) setError(errorMessage(failure)); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const timer = refreshMs ? window.setInterval(() => void load(), refreshMs) : null;
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [path, schema, revision, refreshMs]);
  return { data, error, loading, reload };
}

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
