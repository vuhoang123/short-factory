import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@shorts-factory/database';
import { createApp } from '../src/app.js';

describe('Nest API smoke with an explicit database mock', () => {
  let app: INestApplication;
  const query = vi.fn().mockResolvedValue([{ ready: 1 }]);
  const disconnect = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    app = await createApp({ $queryRaw: query, $disconnect: disconnect } as unknown as PrismaClient);
  });

  afterAll(async () => { await app.close(); });

  it('boots health without provider credentials and exposes safe response headers', async () => {
    const response = await supertest(app.getHttpServer()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', database: 'ok', phase: 'PHASE_2', integrations: 'synthetic-demo-and-manual-only' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('authenticates before any private content query', async () => {
    const response = await supertest(app.getHttpServer()).get('/api/v1/posts');
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', requestId: expect.any(String) });
  });

  it('returns structured malformed-JSON and route errors', async () => {
    const response = await supertest(app.getHttpServer()).post('/api/v1/auth/register').set('Content-Type', 'application/json').send('{invalid');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    const unknown = await supertest(app.getHttpServer()).get('/api/v1/no-such-route');
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('NOT_FOUND');
  });
});
