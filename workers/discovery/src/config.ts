import { z } from 'zod';

export const workerConfigSchema = z.object({
  DATABASE_URL: z.string().url(), REDIS_URL: z.string().url(), NODE_ENV: z.string().default('development'),
  DISCOVERY_QUEUE_NAME: z.string().min(1).max(80).default('content-discovery'),
  DISCOVERY_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(4),
  DISCOVERY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(30),
  DISCOVERY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  DISCOVERY_RELAY_INTERVAL_MS: z.coerce.number().int().min(1000).max(300000).default(3000),
  DISCOVERY_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).max(3600000).default(30000),
  DISCOVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25),
  DISCOVERY_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  DISCOVERY_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(10),
  DISCOVERY_COMMENT_LIMIT: z.coerce.number().int().min(0).max(100).default(50),
  DISCOVERY_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  DISCOVERY_RETRY_DELAY_MS: z.coerce.number().int().min(100).max(300000).default(5000),
  DISCOVERY_PAGE_DELAY_MS: z.coerce.number().int().min(0).max(60000).default(250),
}).strict();

export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const values = Object.fromEntries(Object.keys(workerConfigSchema.shape).map(key => [key, env[key]]));
  return workerConfigSchema.parse(values);
}
