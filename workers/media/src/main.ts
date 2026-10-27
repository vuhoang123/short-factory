import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@shorts-factory/database';
import { jobEnvelopeSchema } from '@shorts-factory/shared';
import { readMediaWorkerConfig } from './config.js';
import { relayMediaOutbox, type MediaEnvelope } from './outbox.js';
import { MediaProductionPipeline } from './pipeline.js';

const config = readMediaWorkerConfig();
const db = new PrismaClient();
const queueRedis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
const workerRedis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue<MediaEnvelope>(config.MEDIA_QUEUE_NAME, { connection: queueRedis });
const pipeline = new MediaProductionPipeline(db, config);
const worker = new Worker<MediaEnvelope>(config.MEDIA_QUEUE_NAME, async (job: Job<MediaEnvelope>) => {
  const envelope = jobEnvelopeSchema.parse(job.data);
  await pipeline.process(envelope, job.attemptsMade, Number(job.opts.attempts ?? config.MEDIA_RETRY_ATTEMPTS));
  return { status: 'SUCCEEDED', traceId: envelope.traceId };
}, { connection: workerRedis, concurrency: config.MEDIA_WORKER_CONCURRENCY });

let pollingOutbox = false;
function log(fields: Record<string, string | number | boolean | null>) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), service: 'media-worker', ...fields })}\n`);
}
worker.on('completed', (job) => log({ level: 'info', event: 'job_completed', jobId: job.id ?? null, traceId: job.data.traceId }));
worker.on('failed', (job, error) => {
  const code = error.message && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message) ? error.message : 'MEDIA_PRODUCTION_FAILED';
  log({ level: 'error', event: 'job_failed', jobId: job?.id ?? null, errorCode: code });
});
worker.on('error', () => log({ level: 'error', event: 'worker_runtime_error', errorCode: 'WORKER_RUNTIME_ERROR' }));

const outboxTimer = setInterval(() => {
  if (pollingOutbox) return;
  pollingOutbox = true;
  void relayMediaOutbox(db, queue, config).then((count) => { if (count) log({ level: 'info', event: 'outbox_relayed', count }); })
    .catch(() => log({ level: 'error', event: 'outbox_relay_failed', errorCode: 'OUTBOX_RELAY_FAILED' }))
    .finally(() => { pollingOutbox = false; });
}, config.MEDIA_RELAY_INTERVAL_MS);

async function shutdown(signal: string) {
  clearInterval(outboxTimer);
  log({ level: 'info', event: 'shutdown_started', signal });
  await worker.close();
  await queue.close();
  await Promise.all([queueRedis.quit(), workerRedis.quit()]);
  await db.$disconnect();
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
void relayMediaOutbox(db, queue, config).catch(() => log({ level: 'error', event: 'outbox_relay_failed', errorCode: 'OUTBOX_RELAY_FAILED' }));
log({ level: 'info', event: 'worker_started', queue: config.MEDIA_QUEUE_NAME, concurrency: config.MEDIA_WORKER_CONCURRENCY });
