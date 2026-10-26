import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function mutationIdentity(request: Request, input: unknown) {
  return {
    key: z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/).parse(request.header('idempotency-key')),
    requestHash: createHash('sha256').update(stableJson(input)).digest('hex'),
  };
}
