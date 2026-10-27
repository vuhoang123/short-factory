import type { PrismaClient } from '@shorts-factory/database';
import { jobEnvelopeSchema } from '@shorts-factory/shared';
import type { Queue } from 'bullmq';
export async function relayAutomationOutbox(db:PrismaClient,queue:Queue,batch=25) {
  const events=await db.outboxEvent.findMany({where:{publishedAt:null,eventType:{in:['AUTOPILOT_RUN_REQUESTED','ANALYTICS_SYNC_REQUESTED']}},orderBy:{createdAt:'asc'},take:batch});
  for(const event of events) {
    const envelope=jobEnvelopeSchema.parse({jobId:event.id,workspaceId:event.workspaceId,entityId:event.aggregateId,step:event.eventType,version:1,idempotencyKey:event.id,traceId:event.id,attempt:0,scheduledAt:event.createdAt.toISOString()});
    await queue.add(event.eventType,envelope,{jobId:event.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:{count:1000},removeOnFail:{count:2000}});
    await db.outboxEvent.updateMany({where:{workspaceId:event.workspaceId,id:event.id,publishedAt:null},data:{publishedAt:new Date()}});
  }
  return events.length;
}
