import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';
import { PrismaClient } from '@shorts-factory/database';
import { jobEnvelopeSchema } from '@shorts-factory/shared';
import { AutopilotPipeline, scheduleAutomation, processAnalyticsSync } from '@shorts-factory/workflows';
import { relayAutomationOutbox } from './outbox.js';

const config=z.object({DATABASE_URL:z.string().url(),REDIS_URL:z.string().url(),AUTOPILOT_POLL_MS:z.coerce.number().min(1000).max(300000).default(5000),AUTOPILOT_WORKER_CONCURRENCY:z.coerce.number().int().min(1).max(8).default(2),AUTOPILOT_QUEUE:z.string().default('automation')}).parse(process.env);
const db=new PrismaClient();
const redis=new IORedis(config.REDIS_URL,{maxRetriesPerRequest:1});
const workerRedis=new IORedis(config.REDIS_URL,{maxRetriesPerRequest:null});
const queue=new Queue(config.AUTOPILOT_QUEUE,{connection:redis});
const pipeline=new AutopilotPipeline(db);
const log=(event:string)=>process.stdout.write(`${JSON.stringify({service:'automation-worker',event,timestamp:new Date().toISOString()})}\n`);
const worker=new Worker(config.AUTOPILOT_QUEUE,async(job)=>{
  const data=jobEnvelopeSchema.parse(job.data);
  if(data.step==='AUTOPILOT_RUN_REQUESTED') await pipeline.process(data.workspaceId,data.entityId);
  else if(data.step==='ANALYTICS_SYNC_REQUESTED') await processAnalyticsSync(db,data.workspaceId,data.entityId);
  else throw new Error('UNSUPPORTED_EVENT');
},{connection:workerRedis,concurrency:config.AUTOPILOT_WORKER_CONCURRENCY});
worker.on('failed',()=>log('job_failed'));worker.on('error',()=>log('worker_error'));
let polling=false;
async function poll() {
  if(polling)return;polling=true;
  try {
    await scheduleAutomation(db);
    const now=new Date();
    const retry=await db.analyticsSyncRun.findMany({where:{OR:[{status:'QUEUED',createdAt:{lt:new Date(Date.now()-60000)},OR:[{nextRunAt:null},{nextRunAt:{lte:now}}]},{status:'RUNNING',leaseUntil:{lt:now}},{status:'FAILED_RETRYABLE',nextRunAt:{lte:now}}]},take:25});
    for(const run of retry) await db.$transaction(async(tx)=>{
      const claimed=await tx.analyticsSyncRun.updateMany({where:{id:run.id,workspaceId:run.workspaceId,status:run.status,attempts:run.attempts},data:{status:'QUEUED',nextRunAt:new Date(Date.now()+60000)}});
      if(claimed.count)await tx.outboxEvent.create({data:{workspaceId:run.workspaceId,eventType:'ANALYTICS_SYNC_REQUESTED',aggregateId:run.id,payload:{entityId:run.id,workspaceId:run.workspaceId,version:run.attempts+1}}});
    });
    const refreshSince=new Date(Date.now()-Number(process.env.ANALYTICS_REFRESH_HOURS??24)*3600000);
    const published=await db.publication.findMany({where:{
      status:'PUBLISHED',remotePostId:{not:null},
      AND:[
        {analyticsSyncRuns:{none:{status:{in:['QUEUED','RUNNING','FAILED_RETRYABLE']}}}},
        {analyticsSyncRuns:{none:{createdAt:{gte:refreshSince}}}},
      ],
    },take:25});
    for(const p of published)await db.$transaction(async(tx)=>{
      await tx.$queryRaw`SELECT "id" FROM "Publication" WHERE "id"=${p.id} AND "workspaceId"=${p.workspaceId} FOR UPDATE`;
      if(await tx.analyticsSyncRun.count({where:{workspaceId:p.workspaceId,publicationId:p.id,createdAt:{gte:new Date(Date.now()-Number(process.env.ANALYTICS_REFRESH_HOURS??24)*3600000)}}}))return;
      const run=await tx.analyticsSyncRun.create({data:{workspaceId:p.workspaceId,publicationId:p.id}});
      await tx.outboxEvent.create({data:{workspaceId:p.workspaceId,eventType:'ANALYTICS_SYNC_REQUESTED',aggregateId:run.id,payload:{entityId:run.id,workspaceId:p.workspaceId,version:1}}});
    });
    await relayAutomationOutbox(db,queue);
  } catch {log('poll_failed');}finally{polling=false;}
}
const timer=setInterval(()=>{void poll();},config.AUTOPILOT_POLL_MS);
async function shutdown(){clearInterval(timer);await worker.close();await queue.close();await Promise.all([redis.quit(),workerRedis.quit()]);await db.$disconnect();}
process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});void poll();log('started');
