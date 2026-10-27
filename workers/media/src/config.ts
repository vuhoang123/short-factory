import { z } from 'zod';

export const mediaWorkerConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  NODE_ENV: z.string().default('development'),
  MEDIA_QUEUE_NAME: z.string().min(1).max(80).default('media-production'),
  MEDIA_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  MEDIA_RELAY_INTERVAL_MS: z.coerce.number().int().min(1000).max(300000).default(3000),
  MEDIA_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  MEDIA_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  MEDIA_RETRY_DELAY_MS: z.coerce.number().int().min(100).max(300000).default(5000),
  MEDIA_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  MEDIA_MAX_RENDER_SECONDS: z.coerce.number().int().min(10).max(3600).default(600),
  STORAGE_LOCAL_ROOT: z.string().min(1).default('.data/objects'),
  TTS_PROVIDER: z.enum(['mock', 'local', 'openai']).default('mock'),
  SCRIPT_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
}).strict();

export type MediaWorkerConfig = z.infer<typeof mediaWorkerConfigSchema>;
export function readMediaWorkerConfig(env: NodeJS.ProcessEnv = process.env): MediaWorkerConfig {
  return mediaWorkerConfigSchema.parse(Object.fromEntries(Object.keys(mediaWorkerConfigSchema.shape).map((key) => [key, env[key]])));
}
