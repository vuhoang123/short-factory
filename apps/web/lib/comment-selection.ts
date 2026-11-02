import { z } from 'zod';
export const commentPlanSchema = z.object({ items: z.array(z.object({ id: z.string(), body: z.string(), likes: z.number().nullable(), sensitiveFlags: z.array(z.string()) })), targetCount: z.number(), availableCount: z.number(), reactionsKnown: z.number(), selectionBasis: z.enum(['REACTIONS', 'PARTIAL_OR_MISSING_REACTIONS']) });
export type CommentMode = 'TOP_REACTIONS' | 'MANUAL';
