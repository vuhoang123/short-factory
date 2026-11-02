import { z } from 'zod';

const commentSchema = z.object({ externalId: z.string().trim().min(1).max(200).optional(), body: z.string().trim().min(1).max(10000), likes: z.number().int().min(0).max(2147483647).optional() }).strict();

export function parseCommentImport(input: string) {
  const text = input.trim();
  if (!text) return [];
  if (text.length > 200000) throw new Error('Khối bình luận vượt 200.000 ký tự.');
  const raw: unknown = text.startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const match = /^(\d+)\t(.+)$/u.exec(line);
    return match ? { body: match[2], likes: Number(match[1]) } : { body: line };
  });
  const comments = z.array(commentSchema).max(500, 'Tối đa 500 bình luận mỗi lần nhập.').parse(raw).map((comment, index) => ({ ...comment, externalId: comment.externalId ?? `c${index + 1}` }));
  if (new Set(comments.map((comment) => comment.externalId)).size !== comments.length) throw new Error('Mã bình luận bị trùng.');
  return comments;
}
