import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { PrismaClient } from '@shorts-factory/database';
import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../src/auth/auth.service.js';
import { ProductionService } from '../src/production.service.js';

function fixture(status = 'QUEUED') {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const runId = randomUUID();
  const findMany = vi.fn().mockResolvedValue([]);
  const run = { id: runId, workspaceId, status, attempts: 1, renderJob: { id: randomUUID() } };
  const database = {
    productionRun: { findFirst: vi.fn().mockResolvedValue(run), findMany, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    idempotencyRecord: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    renderJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    productionStage: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    video: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = { ...database, $transaction: async <T>(work: (tx: typeof database) => Promise<T>) => work(database) } as unknown as PrismaClient;
  const context = vi.fn().mockResolvedValue({ workspaceId, userId, role: 'EDITOR' });
  const auth = { context } as unknown as AuthService;
  const request = { header: (name: string) => name.toLowerCase() === 'idempotency-key' ? 'phase6-operation-key' : undefined } as Request;
  return { service: new ProductionService(db, auth), database, context, request, runId, workspaceId };
}

describe('production history and cancellation', () => {
  it('keeps history scoped to the authenticated workspace and validates status filters', async () => {
    const f = fixture();
    expect(await f.service.productionRuns(f.request, { status: 'RUNNING', limit: '2' })).toEqual({ items: [], nextCursor: null });
    expect(f.database.productionRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: f.workspaceId, status: 'RUNNING' }, take: 3,
    }));
    await expect(f.service.productionRuns(f.request, { status: 'INVALID' })).rejects.toThrow();
  });

  it('cancels active work atomically with audit and current membership checks', async () => {
    const f = fixture('RUNNING');
    await expect(f.service.cancelRun(f.request, f.runId, {})).resolves.toEqual({ runId: f.runId, status: 'CANCELLED' });
    expect(f.context).toHaveBeenCalledWith(f.request, expect.arrayContaining(['EDITOR']));
    expect(f.database.productionRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: f.runId, workspaceId: f.workspaceId, status: 'RUNNING', attempts: 1 }),
      data: expect.objectContaining({ status: 'CANCELLED', errorCode: 'USER_CANCELLED' }),
    }));
    expect(f.database.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect or cancel finished outputs and repeated cancellation is harmless', async () => {
    const done = fixture('SUCCEEDED');
    await expect(done.service.cancelRun(done.request, done.runId, {})).rejects.toMatchObject({ response: { code: 'RUN_NOT_CANCELLABLE' } });
    expect(done.database.productionRun.updateMany).not.toHaveBeenCalled();
    const cancelled = fixture('CANCELLED');
    await expect(cancelled.service.cancelRun(cancelled.request, cancelled.runId, {})).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(cancelled.database.productionRun.updateMany).not.toHaveBeenCalled();
    expect(cancelled.database.auditLog.create).not.toHaveBeenCalled();
  });
});
