'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { api, errorMessage } from './api';

export function useResource<T extends z.ZodType>(path: string, schema: T, refreshMs = 0) {
  const [result, setResult] = useState<{ path: string; schema: T; data: z.infer<T> } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setLoading(true); setError('');
    const load = async () => {
      try {
        const data = await api(path, schema, { signal: controller.signal });
        if (active) { setResult({ path, schema, data }); setError(''); }
      } catch (failure) { if (active) setError(errorMessage(failure)); }
      finally {
        if (active) {
          setLoading(false);
          // Wait for this request before scheduling another poll.
          if (refreshMs) timer = setTimeout(() => { void load(); }, refreshMs);
        }
      }
    };
    void load();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [path, schema, revision, refreshMs]);
  return { data: result?.path === path && result.schema === schema ? result.data : null, error, loading, reload };
}
