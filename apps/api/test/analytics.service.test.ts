import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@shorts-factory/database';
import { AnalyticsService } from '../src/analytics.service.js';
import type { AuthService } from '../src/auth/auth.service.js';

function fixture() {
  const records = new Map<string, { requestHash: string; response: unknown }>();
  const tx = {
    workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    idempotencyRecord: {
      findUnique: vi.fn((input: { where: { workspaceId_userId_route_key: { key: string } } }) => records.get(input.where.workspaceId_userId_route_key.key) ?? null),
      create: vi.fn((input: { data: { key: string; requestHash: string; response: unknown } }) => { records.set(input.data.key, input.data); return input.data; }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    publication: { findFirst: vi.fn().mockResolvedValue({ id: 'publication-a', remotePostId: 'remote-a', status: 'PUBLISHED' }) },
    analyticsSyncRun: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'sync-a', status: 'QUEUED' }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'event-a' }) },
    publicationMetric: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const db = { ...tx, $transaction: vi.fn(async (work: (transaction: Prisma.TransactionClient) => Promise<unknown>) => work(tx as unknown as Prisma.TransactionClient)) };
  const auth = { context: vi.fn().mockResolvedValue({ workspaceId: 'workspace-a', userId: 'editor-a', role: 'EDITOR' }) };
  const request = { header: (name: string) => name.toLowerCase() === 'idempotency-key' ? 'request-key-a' : 'workspace-b' } as unknown as Request;
  return { tx, db, auth, request, service: new AnalyticsService(db as unknown as PrismaClient, auth as unknown as AuthService) };
}

describe('analytics service security and replay behavior', () => {
  it('queues one durable refresh on replay and derives tenant scope from authentication', async () => {
    const { tx, service, request } = fixture();
    const first = await service.refresh(request, 'publication-a');
    expect(await service.refresh(request, 'publication-a')).toEqual(first);
    expect(tx.analyticsSyncRun.create).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.publication.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'publication-a', workspaceId: 'workspace-a' } }));
    const event = tx.outboxEvent.create.mock.calls[0]?.[0];
    expect(event).toMatchObject({ data: { workspaceId: 'workspace-a', eventType: 'ANALYTICS_SYNC_REQUESTED', aggregateId: 'sync-a' } });
    expect(JSON.stringify(event)).not.toContain('remote-a');
  });

  it('hides other-workspace history before reading metric rows', async () => {
    const { tx, service, request } = fixture();
    tx.publication.findFirst.mockResolvedValue(null);
    await expect(service.history(request, 'publication-b')).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(tx.publicationMetric.findMany).not.toHaveBeenCalled();
    expect(tx.publication.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'publication-b', workspaceId: 'workspace-a' } }));
  });

  it('does not enqueue analytics for an unconfirmed publication', async () => {
    const { tx, service, request } = fixture();
    tx.publication.findFirst.mockResolvedValue({ id: 'publication-a', remotePostId: 'remote-a', status: 'PROCESSING' });
    await expect(service.refresh(request, 'publication-a')).rejects.toMatchObject({ response: { code: 'METRICS_UNAVAILABLE' } });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('rechecks membership inside mutations and stops after permission changes', async () => {
    const { tx, service, request } = fixture();
    tx.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' });
    await expect(service.refresh(request, 'publication-a')).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(tx.publication.findFirst).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});
