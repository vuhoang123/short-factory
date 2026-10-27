import { Prisma, type PrismaClient } from '@shorts-factory/database';
import { automationRuleSchema, assertBudget } from '@shorts-factory/automation';

export function toJson(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
export const activeWorkflowStatuses = ['QUEUED','RUNNING','WAITING_DISCOVERY','WAITING_PRODUCTION','AWAITING_APPROVAL','WAITING_PUBLICATION'];

export async function usageSummary(db: PrismaClient | Prisma.TransactionClient, workspaceId: string, now = new Date()) {
  const day = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
  const [daily,monthly,reservations,groups,policy] = await Promise.all([
    db.usageEvent.aggregate({where:{workspaceId,occurredAt:{gte:day}},_sum:{estimatedUsd:true}}),
    db.usageEvent.aggregate({where:{workspaceId,occurredAt:{gte:month}},_sum:{estimatedUsd:true,billedUsd:true}}),
    db.budgetReservation.aggregate({where:{workspaceId,status:{in:['ACTIVE','CLOSING']}},_sum:{amountUsd:true}}),
    db.usageEvent.groupBy({by:['stage','unit'],where:{workspaceId,occurredAt:{gte:month}},_sum:{estimatedUsd:true,units:true}}),
    db.budgetPolicy.findUnique({where:{workspaceId}}),
  ]);
  const dailyEstimatedUsd = Number(daily._sum.estimatedUsd ?? 0);
  const monthlyEstimatedUsd = Number(monthly._sum.estimatedUsd ?? 0);
  const reservedUsd = Number(reservations._sum.amountUsd ?? 0);
  const threshold = policy?.warningThreshold ?? 0.8;
  const alerts = [dailyEstimatedUsd+reservedUsd >= Number(policy?.dailyLimitUsd ?? 5)*threshold ? 'DAILY_BUDGET_WARNING':null,monthlyEstimatedUsd+reservedUsd >= Number(policy?.monthlyLimitUsd ?? 50)*threshold ? 'MONTHLY_BUDGET_WARNING':null].filter((v):v is string=>v!==null);
  return { dailyEstimatedUsd,monthlyEstimatedUsd,reservedUsd,billedUsd:monthly._sum.billedUsd === null ? null:Number(monthly._sum.billedUsd),byStage:groups.map((g)=>({stage:g.stage,unit:g.unit,estimatedUsd:Number(g._sum.estimatedUsd??0),units:g._sum.units??0})),alerts };
}

export async function createAutomationRun(tx: Prisma.TransactionClient, workspaceId:string, channelId:string, requestedById:string, dryRun=false, candidateId?:string) {
  // The workspace lock serializes concurrency and budget reservations across channels.
  await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${workspaceId} FOR UPDATE`;
  const rule=await tx.automationRule.findUniqueOrThrow({where:{workspaceId_channelId:{workspaceId,channelId}}});
  const config=automationRuleSchema.parse(rule.config);
  if (!dryRun && (rule.status!=='ACTIVE' || config.mode==='MANUAL'&&!candidateId)) throw new Error('AUTOMATION_NOT_ACTIVE');
  if (!dryRun && await tx.workflowRun.count({where:{workspaceId,entityType:'AUTOPILOT',status:{in:activeWorkflowStatuses},input:{path:['dryRun'],equals:false}}}) >= Number(process.env.AUTOPILOT_WORKSPACE_CONCURRENCY ?? 2)) throw new Error('WORKSPACE_CONCURRENCY_LIMIT');
  const usage=await usageSummary(tx,workspaceId);
  const policy=await tx.budgetPolicy.findUnique({where:{workspaceId}});
  if (!dryRun) assertBudget({dailySpentUsd:usage.dailyEstimatedUsd,monthlySpentUsd:usage.monthlyEstimatedUsd,reservedUsd:usage.reservedUsd,requestedUsd:config.estimatedRunCostUsd,dailyLimitUsd:Math.min(Number(policy?.dailyLimitUsd??5),config.dailyBudgetUsd),monthlyLimitUsd:Math.min(Number(policy?.monthlyLimitUsd??50),config.monthlyBudgetUsd)});
  const run=await tx.workflowRun.create({data:{workspaceId,entityType:'AUTOPILOT',entityId:channelId,status:'QUEUED',currentStep:'DISCOVERY',nextRunAt:new Date(),input:toJson({config,ruleId:rule.id,ruleVersion:rule.version,controlVersion:rule.controlVersion,requestedById,dryRun,candidateId:candidateId??null})}});
  if (!dryRun) await tx.budgetReservation.create({data:{workspaceId,workflowRunId:run.id,amountUsd:config.estimatedRunCostUsd}});
  await tx.outboxEvent.create({data:{workspaceId,eventType:'AUTOPILOT_RUN_REQUESTED',aggregateId:run.id,payload:{entityId:run.id,workspaceId,version:run.version}}});
  await tx.auditLog.create({data:{workspaceId,actorId:requestedById,action:dryRun?'AUTOPILOT_DRY_RUN':'AUTOPILOT_RUN_CREATED',resourceType:'WorkflowRun',resourceId:run.id,metadata:{ruleVersion:rule.version}}});
  return run;
}

export async function cancelAutomation(tx: Prisma.TransactionClient,workspaceId:string,runId:string,reason='USER_CANCELLED') {
  const run=await tx.workflowRun.findFirst({where:{id:runId,workspaceId,entityType:'AUTOPILOT'}});
  if (!run || ![...activeWorkflowStatuses,'FAILED_RETRYABLE','FAILED_PERMANENT','BLOCKED'].includes(run.status)) return;
  const output=run.output && typeof run.output==='object' && !Array.isArray(run.output) ? run.output as Record<string,Prisma.JsonValue> : {};
  await tx.workflowRun.update({where:{workspaceId_id:{workspaceId,id:runId}},data:{status:'CANCELLED',errorCode:reason,leaseUntil:null,nextRunAt:null,version:{increment:1}}});
  const child=typeof output.productionRunId==='string'?await tx.productionRun.findFirst({where:{id:output.productionRunId,workspaceId}}):null;
  const childStillRunning=child?.status==='RUNNING';
  await tx.budgetReservation.updateMany({where:{workspaceId,workflowRunId:runId,status:'ACTIVE'},data:{status:childStillRunning?'CLOSING':'RELEASED'}});
  // A running worker owns its lease. Let it observe the parent cancellation at its next
  // stage boundary, then settle the child and release the closing reservation itself.
  if (child && !childStillRunning) await tx.productionRun.updateMany({where:{id:child.id,workspaceId,status:{in:['QUEUED','FAILED_RETRYABLE']}},data:{status:'CANCELLED',errorCode:reason,completedAt:new Date()}});
  const ids=Array.isArray(output.publicationIds)?output.publicationIds.filter((id):id is string=>typeof id==='string'):[];
  if (ids.length) await tx.publication.updateMany({where:{workspaceId,id:{in:ids},status:{in:['DRAFT','SCHEDULED','QUEUED','FAILED_RETRYABLE']}},data:{status:'CANCELLED',errorCode:reason}});
}
