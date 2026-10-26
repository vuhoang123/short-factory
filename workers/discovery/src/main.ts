import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@shorts-factory/database';
import { jobEnvelopeSchema } from '@shorts-factory/shared';
import { readWorkerConfig } from './config.js';
import { relayPendingOutbox } from './outbox.js';
import { DiscoveryPipeline, type DiscoveryEnvelope } from './pipeline.js';
import { scheduleDueSources } from './scheduler.js';

const config = readWorkerConfig();
const db = new PrismaClient();
const queueRedis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
const workerRedis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue<DiscoveryEnvelope>(config.DISCOVERY_QUEUE_NAME, { connection: queueRedis });
const pipeline = new DiscoveryPipeline(db, config);
const worker = new Worker<DiscoveryEnvelope>(config.DISCOVERY_QUEUE_NAME, async (job: Job<DiscoveryEnvelope>) => {
  const envelope = jobEnvelopeSchema.parse(job.data);
  await pipeline.process(envelope, job.attemptsMade, Number(job.opts.attempts ?? config.DISCOVERY_RETRY_ATTEMPTS));
  return { status: 'SUCCEEDED', traceId: envelope.traceId };
}, {
  connection: workerRedis,
  concurrency: config.DISCOVERY_WORKER_CONCURRENCY,
  limiter: { max: config.DISCOVERY_RATE_LIMIT_MAX, duration: config.DISCOVERY_RATE_LIMIT_WINDOW_MS },
});

let pollingOutbox = false;
let pollingSchedule = false;

function log(fields: Record<string, string | number | boolean | null>) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), service: 'discovery-worker', ...fields })}\n`);
}

worker.on('completed', job => log({ level: 'info', event: 'job_completed', jobId: job.id ?? null, step: job.data.step, traceId: job.data.traceId }));
worker.on('failed', (job, error) => {
  const code = error.message && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message) ? error.message : 'DISCOVERY_JOB_FAILED';
  log({ level: 'error', event: 'job_failed', jobId: job?.id ?? null, step: job?.data.step ?? null, errorCode: code });
});
worker.on('error', () => log({ level: 'error', event: 'worker_runtime_error', errorCode: 'WORKER_RUNTIME_ERROR' }));

const outboxTimer = setInterval(() => {
  if (pollingOutbox) return;
  pollingOutbox = true;
  void relayPendingOutbox(db, queue, config).then(count => { if (count) log({ level: 'info', event: 'outbox_relayed', count }); }).catch(() => log({ level: 'error', event: 'outbox_relay_failed', errorCode: 'OUTBOX_RELAY_FAILED' })).finally(() => { pollingOutbox = false; });
}, config.DISCOVERY_RELAY_INTERVAL_MS);
const scheduleTimer = setInterval(() => {
  if (config.NODE_ENV === 'production') return;
  if (pollingSchedule) return;
  pollingSchedule = true;
  void scheduleDueSources(db, config.DISCOVERY_BATCH_SIZE).then(count => { if (count) log({ level: 'info', event: 'sources_scheduled', count }); }).catch(() => log({ level: 'error', event: 'scheduler_failed', errorCode: 'SOURCE_SCHEDULER_FAILED' })).finally(() => { pollingSchedule = false; });
}, config.DISCOVERY_SCHEDULER_INTERVAL_MS);

async function shutdown(signal: string) {
  clearInterval(outboxTimer);
  clearInterval(scheduleTimer);
  log({ level: 'info', event: 'shutdown_started', signal });
  await worker.close();
  await queue.close();
  await Promise.all([queueRedis.quit(), workerRedis.quit()]);
  await db.$disconnect();
  process.exit(0);
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
void relayPendingOutbox(db, queue, config).catch(() => log({ level: 'error', event: 'outbox_relay_failed', errorCode: 'OUTBOX_RELAY_FAILED' }));
log({ level: 'info', event: 'worker_started', queue: config.DISCOVERY_QUEUE_NAME, concurrency: config.DISCOVERY_WORKER_CONCURRENCY });
