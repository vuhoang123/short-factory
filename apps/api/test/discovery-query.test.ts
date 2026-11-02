import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@shorts-factory/database';
import type { AuthService } from '../src/auth/auth.service.js';
import { DiscoveryService } from '../src/discovery.service.js';
import { candidateQuerySchema } from '../src/validation.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const sourcePostId = '00000000-0000-4000-8000-000000000002';

describe('candidate lookup for an imported post', () => {
  it('accepts a UUID source post filter and rejects malformed IDs', () => {
    expect(candidateQuerySchema.parse({ sourcePostId, limit: '1' })).toMatchObject({ sourcePostId, limit: 1 });
    expect(candidateQuerySchema.safeParse({ sourcePostId: 'invalid' }).success).toBe(false);
  });

  it('keeps the authenticated workspace predicate when filtering by a post ID', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { contentCandidate: { findMany } } as unknown as PrismaClient;
    const auth = { context: vi.fn().mockResolvedValue({ workspaceId }) } as unknown as AuthService;
    const service = new DiscoveryService(db, auth);
    expect(await service.candidates({} as Request, { sourcePostId, limit: 1 })).toEqual({ items: [], nextCursor: null });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceId, sourcePostId }),
    }));
  });
});
