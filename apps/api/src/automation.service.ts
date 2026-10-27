import type { Request } from 'express';
import { type PrismaClient } from '@shorts-factory/database';
import { automationRuleSchema, assertBudget, schedulePreview } from '@shorts-factory/automation';
import { listVoiceProfiles } from '@shorts-factory/media';
import { activeWorkflowStatuses, cancelAutomation, createAutomationRun, usageSummary } from '@shorts-factory/workflows';
import { AuthService, adminRoles, editRoles } from './auth/auth.service.js';
import { ApiError, notFound } from './errors.js';
import { json, phase5Mutation } from './phase5.common.js';
import { budgetSchema, controlSchema, ruleWriteSchema, runSchema } from './phase5.validation.js';

export class AutomationService {
  constructor(readonly db:PrismaClient,readonly auth:AuthService) {}

  async overview(request:Request) {
    const {workspaceId}=await this.auth.context(request);
    const [rules,runs,pendingApproval,scheduled,usage]=await Promise.all([
      this.db.automationRule.findMany({where:{workspaceId},include:{channel:{select:{id:true,name:true}}},orderBy:{updatedAt:'desc'}}),
      this.db.workflowRun.findMany({where:{workspaceId,entityType:'AUTOPILOT'},orderBy:{createdAt:'desc'},take:100}),
      this.db.video.count({where:{workspaceId,status:'READY_FOR_REVIEW',reviewStatus:'PENDING'}}),
      this.db.publication.count({where:{workspaceId,status:'SCHEDULED'}}),usageSummary(this.db,workspaceId),
    ]);
    return {rules,runs,summary:{activeRules:rules.filter((r)=>r.status==='ACTIVE').length,running:runs.filter((r)=>r.status==='RUNNING').length,queued:runs.filter((r)=>r.status==='QUEUED').length,pendingApproval,scheduled,failed:runs.filter((r)=>r.status.startsWith('FAILED')||r.status==='BLOCKED').length,estimatedSpendUsd:usage.monthlyEstimatedUsd,billedSpendUsd:usage.billedUsd}};
  }

  async accounts(request:Request) {
    const {workspaceId}=await this.auth.context(request);
    return {items:await this.db.socialAccount.findMany({where:{workspaceId},select:{id:true,displayName:true,platform:true,status:true}})};
  }

  async saveRule(request:Request,channelId:string,raw:unknown) {
    const context=await this.auth.context(request,adminRoles);
    const input=ruleWriteSchema.parse(raw);
    if (!listVoiceProfiles().some((v)=>v.id===input.config.voiceProfileId)) throw new ApiError(400,'VOICE_PROFILE_INVALID','Choose a configured voice.');
    return phase5Mutation(this.db,request,context,`/channels/${channelId}/automation`,input,async(tx)=>{
      if (!await tx.contentChannel.findFirst({where:{id:channelId,workspaceId:context.workspaceId}})) return notFound();
      const [sources,accounts]=await Promise.all([
        tx.sourceConfig.count({where:{workspaceId:context.workspaceId,id:{in:input.config.sourceIds},OR:[{channelId:null},{channelId}]}}),
        tx.socialAccount.count({where:{workspaceId:context.workspaceId,id:{in:input.config.accountIds},platform:{in:input.config.targetPlatforms}}}),
      ]);
      if (sources!==input.config.sourceIds.length||accounts!==input.config.accountIds.length) return notFound();
      const old=await tx.automationRule.findUnique({where:{workspaceId_channelId:{workspaceId:context.workspaceId,channelId}}});
      if ((old?.version??0)!==input.expectedVersion) throw new ApiError(409,'RULE_VERSION_CONFLICT','Reload the current configuration before saving.');
      const version=(old?.version??0)+1;
      const rule=await tx.automationRule.upsert({where:{workspaceId_channelId:{workspaceId:context.workspaceId,channelId}},create:{workspaceId:context.workspaceId,channelId,version,config:json(input.config)},update:{version,config:json(input.config)}});
      await tx.automationRuleVersion.create({data:{workspaceId:context.workspaceId,ruleId:rule.id,version,config:json(input.config)}});
      return rule;
    });
  }

  async control(request:Request,channelId:string,raw:unknown) {
    const context=await this.auth.context(request,adminRoles);
    const input=controlSchema.parse(raw);
    return phase5Mutation(this.db,request,context,`/channels/${channelId}/automation/control`,input,async(tx)=>{
      const rule=await tx.automationRule.findUnique({where:{workspaceId_channelId:{workspaceId:context.workspaceId,channelId}}});
      if (!rule) return notFound();
      const status={ENABLE:'ACTIVE',RESUME:'ACTIVE',PAUSE:'PAUSED',DISABLE:'DISABLED',EMERGENCY_STOP:'STOPPED'}[input.action];
      const updated=await tx.automationRule.update({where:{workspaceId_id:{workspaceId:context.workspaceId,id:rule.id}},data:{status,nextRunAt:status==='ACTIVE'?new Date():null,controlVersion:{increment:1}}});
      if (input.action==='EMERGENCY_STOP'||input.action==='DISABLE') {
        const runs=await tx.workflowRun.findMany({where:{workspaceId:context.workspaceId,entityType:'AUTOPILOT',entityId:channelId,status:{in:activeWorkflowStatuses}},select:{id:true}});
        for (const run of runs) await cancelAutomation(tx,context.workspaceId,run.id,input.action);
      }
      return updated;
    });
  }

  async run(request:Request,channelId:string,raw:unknown) {
    const context=await this.auth.context(request,editRoles);
    const input=runSchema.parse(raw);
    try {
      return await phase5Mutation(this.db,request,context,`/channels/${channelId}/automation/run`,input,async(tx)=>{
        if (!await tx.automationRule.findUnique({where:{workspaceId_channelId:{workspaceId:context.workspaceId,channelId}}})) return notFound();
        if (input.candidateId&&!await tx.contentCandidate.findFirst({where:{workspaceId:context.workspaceId,id:input.candidateId,post:{OR:[{channelId:null},{channelId}]}}})) return notFound();
        return createAutomationRun(tx,context.workspaceId,channelId,context.userId,input.dryRun,input.candidateId);
      });
    } catch(error) {
      if(error instanceof Error&&/^(DAILY_BUDGET|MONTHLY_BUDGET|AUTOMATION_NOT_ACTIVE|WORKSPACE_CONCURRENCY)/.test(error.message)) throw new ApiError(409,error.message,'The current automation or budget policy prevents starting this run.');
      throw error;
    }
  }

  async detail(request:Request,id:string) {
    const {workspaceId}=await this.auth.context(request);
    const run=await this.db.workflowRun.findFirst({where:{id,workspaceId,entityType:'AUTOPILOT'},include:{steps:{orderBy:{startedAt:'asc'}},qualityReports:true,reservation:true}});
    if(!run) return notFound();
    return run;
  }

  async cancel(request:Request,id:string) {
    const context=await this.auth.context(request,editRoles);
    return phase5Mutation(this.db,request,context,`/automation/runs/${id}/cancel`,{},async(tx)=>{
      if(!await tx.workflowRun.findFirst({where:{id,workspaceId:context.workspaceId,entityType:'AUTOPILOT'}})) return notFound();
      await cancelAutomation(tx,context.workspaceId,id);
      return {id,status:'CANCELLED'};
    });
  }

  async retry(request:Request,id:string) {
    const context=await this.auth.context(request,adminRoles);
    return phase5Mutation(this.db,request,context,`/automation/runs/${id}/retry`,{},async(tx)=>{
      const run=await tx.workflowRun.findFirst({where:{id,workspaceId:context.workspaceId,entityType:'AUTOPILOT'}});
      if(!run) return notFound();
      if(!['FAILED_RETRYABLE','FAILED_PERMANENT','BLOCKED'].includes(run.status)) throw new ApiError(409,'RUN_NOT_RETRYABLE','Only failed or blocked workflows can be retried.');
      const rule=await tx.automationRule.findUnique({where:{workspaceId_channelId:{workspaceId:context.workspaceId,channelId:run.entityId}}});
      if(rule?.status!=='ACTIVE') throw new ApiError(409,'AUTOMATION_NOT_ACTIVE','Resume this channel before retrying.');
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${context.workspaceId} FOR UPDATE`;
      const reservation=await tx.budgetReservation.findUnique({where:{workflowRunId:run.id}});
      const snapshot=automationRuleSchema.parse((run.input as {config:unknown}).config);
      if(reservation?.status==='RELEASED') {
        const usage=await usageSummary(tx,context.workspaceId);
        const policy=await tx.budgetPolicy.findUnique({where:{workspaceId:context.workspaceId}});
        try {assertBudget({dailySpentUsd:usage.dailyEstimatedUsd,monthlySpentUsd:usage.monthlyEstimatedUsd,reservedUsd:usage.reservedUsd,requestedUsd:Number(reservation.amountUsd),dailyLimitUsd:Math.min(Number(policy?.dailyLimitUsd??5),snapshot.dailyBudgetUsd),monthlyLimitUsd:Math.min(Number(policy?.monthlyLimitUsd??50),snapshot.monthlyBudgetUsd)});}
        catch(error) {throw new ApiError(409,error instanceof Error?error.message:'BUDGET_EXCEEDED','The current budget prevents retrying this workflow.');}
        await tx.budgetReservation.update({where:{workflowRunId:run.id},data:{status:'ACTIVE'}});
      }
      const childId=(run.output as {productionRunId?:string}|null)?.productionRunId;
      if(childId) {
        const child=await tx.productionRun.findFirst({where:{id:childId,workspaceId:context.workspaceId}});
        if(child&&['FAILED_RETRYABLE','FAILED_PERMANENT'].includes(child.status)) {
          await tx.productionRun.update({where:{workspaceId_id:{workspaceId:context.workspaceId,id:child.id}},data:{status:'QUEUED',errorCode:null,completedAt:null}});
          await tx.outboxEvent.create({data:{workspaceId:context.workspaceId,eventType:'PRODUCTION_RUN_REQUESTED',aggregateId:child.id,payload:{entityId:child.id,workspaceId:context.workspaceId,version:child.attempts+1}}});
        }
      }
      const next=await tx.workflowRun.update({where:{workspaceId_id:{workspaceId:context.workspaceId,id}},data:{status:'QUEUED',errorCode:null,version:{increment:1},nextRunAt:new Date(),leaseUntil:null}});
      await tx.outboxEvent.create({data:{workspaceId:context.workspaceId,eventType:'AUTOPILOT_RUN_REQUESTED',aggregateId:id,payload:{entityId:id,workspaceId:context.workspaceId,version:next.version}}});
      return next;
    });
  }

  async approvals(request:Request) {
    const {workspaceId}=await this.auth.context(request);
    const videos=await this.db.video.findMany({where:{workspaceId,status:'READY_FOR_REVIEW',reviewStatus:'PENDING'},include:{story:{include:{post:{include:{rights:{orderBy:{createdAt:'desc'},take:1}}}}},qualityReports:{orderBy:{createdAt:'desc'},take:1}},take:100});
    return {items:videos.map((video)=>({...video,qualityReport:video.qualityReports[0]?.report??null,targetPlatforms:video.story?.post.rights[0]?.allowedPlatforms??[]}))};
  }

  async previewSchedule(request:Request,channelId:string) {
    const {workspaceId}=await this.auth.context(request);
    const rule=await this.db.automationRule.findUnique({where:{workspaceId_channelId:{workspaceId,channelId}}});
    if(!rule) return notFound();
    const config=automationRuleSchema.parse(rule.config);
    const existing=await this.db.publication.findMany({where:{workspaceId,video:{channelId},scheduledAt:{gte:new Date()},status:{not:'CANCELLED'}},select:{scheduledAt:true,socialAccountId:true}});
    return {items:schedulePreview({now:new Date(),timezone:config.timezone,postingTimes:config.postingTimes,count:7,existing:existing.flatMap((p)=>p.scheduledAt?[{at:p.scheduledAt,accountId:p.socialAccountId}]:[]),cooldownMinutes:config.cooldownMinutes,dailyLimit:config.dailyLimit})};
  }

  async usage(request:Request) { const {workspaceId}=await this.auth.context(request);return usageSummary(this.db,workspaceId); }
  async budget(request:Request) { const {workspaceId}=await this.auth.context(request);const policy=await this.db.budgetPolicy.findUnique({where:{workspaceId}});return policy?{dailyLimitUsd:Number(policy.dailyLimitUsd),monthlyLimitUsd:Number(policy.monthlyLimitUsd),warningThreshold:policy.warningThreshold}:{dailyLimitUsd:5,monthlyLimitUsd:50,warningThreshold:0.8}; }
  async saveBudget(request:Request,raw:unknown) {
    const context=await this.auth.context(request,adminRoles);const input=budgetSchema.parse(raw);
    return phase5Mutation(this.db,request,context,'/budget-policy',input,async(tx)=>{
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${context.workspaceId} FOR UPDATE`;
      return tx.budgetPolicy.upsert({where:{workspaceId:context.workspaceId},create:{workspaceId:context.workspaceId,...input},update:input});
    });
  }
}
