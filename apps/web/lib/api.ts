import { z } from 'zod';

const apiErrorSchema = z.object({ code: z.string().optional(), message: z.string(), requestId: z.string().optional() });

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly requestId?: string) { super(message); }
}

export async function api<T extends z.ZodTypeAny>(path: string, schema: T, options: { method?: string; body?: unknown } = {}): Promise<z.infer<T>> {
  const method = options.method ?? 'GET';
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'GET' ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new ApiError(error.success ? error.data.message : 'The server could not complete this request. Please try again.', response.status, error.success ? error.data.code : undefined, error.success ? error.data.requestId : undefined);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError('The server returned an unexpected response. Please reload or contact your administrator.', 502, 'INVALID_RESPONSE');
  return result.data;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? `${error.message}${error.requestId ? ` (Request ${error.requestId})` : ''}` : 'Unable to connect. Check that the API is running and try again.';
}
