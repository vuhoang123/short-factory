export const MAX_VIDEO_COMMENTS = 10;

export interface SelectableComment { id: string; body: string; likes?: number | null; sensitiveFlags?: string[] }

export function selectTopComments<T extends SelectableComment>(comments: readonly T[], durationSec: number) {
  if (!Number.isFinite(durationSec) || durationSec < 10 || durationSec > 120) throw new Error('COMMENT_DURATION_INVALID');
  const targetCount = Math.min(MAX_VIDEO_COMMENTS, Math.max(5, Math.round(durationSec / 12)));
  const eligible = comments.filter((comment) => /[\p{L}\p{N}]/u.test(comment.body) && !comment.sensitiveFlags?.length);
  const ranked = eligible.map((comment, index) => ({ comment, index })).sort((a, b) => (b.comment.likes ?? -1) - (a.comment.likes ?? -1) || a.index - b.index);
  const items = ranked.slice(0, targetCount).map(({ comment }) => comment);
  return { items, targetCount, availableCount: eligible.length, reactionsKnown: eligible.filter((comment) => comment.likes !== null && comment.likes !== undefined).length,
    selectionBasis: eligible.every((comment) => comment.likes !== null && comment.likes !== undefined) && eligible.length > 0 ? 'REACTIONS' as const : 'PARTIAL_OR_MISSING_REACTIONS' as const };
}
