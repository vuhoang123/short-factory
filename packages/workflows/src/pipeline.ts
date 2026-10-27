import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { Prisma, type PrismaClient, type WorkflowRun } from '@shorts-factory/database';
import { automationRuleSchema, rankCandidates, selectComments, evaluateQuality, schedulePreview, evaluateAutomaticPublication, zonedDateKey } from '@shorts-factory/automation';
import { LocalObjectStore, inspectRenderedVideo, listVoiceProfiles, productionInputSchema, renderManifestSchema, type ScriptSource } from '@shorts-factory/media';
import { evaluateRights } from '@shorts-factory/shared';
import { MockPublisherAdapter } from '@shorts-factory/publishers';
import { activeWorkflowStatuses, createAutomationRun, toJson } from './automation.js';

const inputSchema=z.object({config:automationRuleSchema,ruleId:z.string().uuid(),ruleVersion:z.number().int(),controlVersion:z.number().int(),requestedById:z.string().uuid(),dryRun:z.boolean(),candidateId:z.string().uuid().nullable()}).strict();
const outputSchema=z.object({discoveryRunIds:z.array(z.string()).optional(),productionRunId:z.string().optional(),videoId:z.string().optional(),backgroundAssetId:z.string().nullable().optional(),publicationIds:z.array(z.string()).optional(),selection:z.unknown().optional(),quality:z.unknown().optional(),blockers:z.array(z.string()).optional(),failureCount:z.number().int().nonnegative().optional()}).strict();
const maxAttempts=()=>Math.max(1,Number(process.env.AUTOPILOT_MAX_ATTEMPTS??3));
function code(error:unknown) { return error instanceof Error && /^[A-Z][A-Z0-9_]{1,90}$/.test(error.message)?error.message:'AUTOPILOT_FAILED'; }

export class AutopilotPipeline {
  constructor(readonly db:PrismaClient) {}
  async process(workspaceId:string,id:string) {
    const original=await this.db.workflowRun.findFirst({where:{id,workspaceId,entityType:'AUTOPILOT'}});
    if(!original||!activeWorkflowStatuses.includes(original.status)&&original.status!=='FAILED_RETRYABLE') return;
    const input=inputSchema.parse(original.input);
    const rule=await this.db.automationRule.findFirst({where:{id:input.ruleId,workspaceId}});
    if(!rule||(!input.dryRun&&rule.status!=='ACTIVE')) return;
    const now=new Date();
    const claimed=await this.db.workflowRun.updateMany({where:{id,workspaceId,status:original.status,OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},data:{status:'RUNNING',attempts:{increment:1},leaseUntil:new Date(now.getTime()+90000)}});
    if(!claimed.count) return;
    const run=await this.db.workflowRun.findFirstOrThrow({where:{id,workspaceId}});
    const heartbeat=setInterval(()=>{void this.db.workflowRun.updateMany({where:{id,workspaceId,attempts:run.attempts,status:'RUNNING'},data:{leaseUntil:new Date(Date.now()+90000)}}).catch(()=>undefined);},20000);
    try { await this.advance(run,input,original.status==='QUEUED'&&original.attempts>0); }
    catch(error) {
      const errorCode=code(error);
      const permanent=/RIGHTS|BUDGET|UNBOUNDED|QUALITY|UNAVAILABLE|EXTERNAL|REJECTED|MISSING|LIMIT|INVALID|REVOKED/.test(errorCode);
      await this.db.$transaction(async(tx)=>{
        const current=await tx.workflowRun.findFirst({where:{id,workspaceId,attempts:run.attempts,status:'RUNNING'}});
        if(!current)return;
        const output=outputSchema.parse(current.output??{});
        output.failureCount=(output.failureCount??0)+1;
        const exhausted=output.failureCount>=maxAttempts();
        await tx.workflowRun.update({where:{workspaceId_id:{workspaceId,id}},data:{status:permanent?'BLOCKED':exhausted?'FAILED_PERMANENT':'FAILED_RETRYABLE',errorCode,output:toJson(output),leaseUntil:null,nextRunAt:permanent||exhausted?null:new Date(Date.now()+Math.min(3600000,5000*2**output.failureCount!))}});
        await tx.workflowStep.updateMany({where:{workspaceId,workflowRunId:id,status:'RUNNING'},data:{status:'FAILED',errorCode,completedAt:new Date()}});
        if(!output.productionRunId&&(permanent||exhausted))await tx.budgetReservation.updateMany({where:{workspaceId,workflowRunId:id,status:'ACTIVE'},data:{status:'RELEASED'}});
      });
    } finally { clearInterval(heartbeat); }
  }

  private async guard(tx:Prisma.TransactionClient,run:WorkflowRun) {
    const current=await tx.workflowRun.findFirst({where:{id:run.id,workspaceId:run.workspaceId,attempts:run.attempts,status:'RUNNING',leaseUntil:{gt:new Date()}}});
    const input=inputSchema.parse(run.input);
    const [rule,member]=await Promise.all([
      tx.automationRule.findFirst({where:{id:input.ruleId,workspaceId:run.workspaceId}}),
      tx.workspaceMember.findUnique({where:{workspaceId_userId:{workspaceId:run.workspaceId,userId:input.requestedById}},select:{role:true}}),
    ]);
    if(!member||!['OWNER','ADMIN','EDITOR'].includes(member.role))throw new Error('REQUESTER_ACCESS_REVOKED');
    if(!current||!rule||(!input.dryRun&&rule.status!=='ACTIVE')) throw new Error('AUTOMATION_CANCELLED');
  }
  private async step(run:WorkflowRun,name:string,status='SUCCEEDED',output:unknown={}) {
    await this.db.$transaction(async(tx)=>{
      await this.guard(tx,run);
      await tx.workflowStep.upsert({where:{workflowRunId_name:{workflowRunId:run.id,name}},create:{workspaceId:run.workspaceId,workflowRunId:run.id,name,status,startedAt:new Date(),completedAt:status==='SUCCEEDED'?new Date():null,output:toJson(output)},update:{status,errorCode:null,completedAt:status==='SUCCEEDED'?new Date():null,output:toJson(output)}});
      await tx.workflowRun.update({where:{workspaceId_id:{workspaceId:run.workspaceId,id:run.id}},data:{currentStep:name}});
    });
  }
  private async wait(run:WorkflowRun,status:string,output:unknown,seconds=15) {
    await this.db.$transaction(async(tx)=>{
      await this.guard(tx,run);
      await tx.workflowRun.update({where:{workspaceId_id:{workspaceId:run.workspaceId,id:run.id}},data:{status,output:toJson(output),leaseUntil:null,nextRunAt:new Date(Date.now()+seconds*1000)}});
    });
  }

  private async advance(run:WorkflowRun,input:z.infer<typeof inputSchema>,manualRetry=false) {
    const config=input.config;
    const output=outputSchema.parse(run.output??{});
    if(!output.productionRunId) {
      if(!output.discoveryRunIds&&!input.dryRun) {
        const ids=await this.db.$transaction(async(tx)=>{
          await this.guard(tx,run);
          const sources=await tx.sourceConfig.findMany({where:{workspaceId:run.workspaceId,enabled:true,capabilityStatus:'AVAILABLE',...(config.sourceIds.length?{id:{in:config.sourceIds}}:{channelId:run.entityId})}});
          const ids:string[]=[];
          for(const source of sources) {
            const old=await tx.sourceSyncRun.findFirst({where:{workspaceId:run.workspaceId,sourceConfigId:source.id,status:{in:['QUEUED','RUNNING','RETRYING']}}});
            if(old) {ids.push(old.id);continue;}
            const sync=await tx.sourceSyncRun.create({data:{workspaceId:run.workspaceId,sourceConfigId:source.id,status:'QUEUED',idempotencyKey:`autopilot:${run.id}:${source.id}`}});
            await tx.outboxEvent.create({data:{workspaceId:run.workspaceId,eventType:'SOURCE_SYNC_REQUESTED',aggregateId:sync.id,payload:{entityId:sync.id,workspaceId:run.workspaceId,version:1}}});
            ids.push(sync.id);
          }
          output.discoveryRunIds=ids;
          await tx.workflowRun.update({where:{workspaceId_id:{workspaceId:run.workspaceId,id:run.id}},data:{output:toJson(output)}});
          return ids;
        });
        output.discoveryRunIds=ids;
        await this.step(run,'DISCOVERY','SUCCEEDED',{runIds:ids});
        if(ids.length) {await this.wait(run,'WAITING_DISCOVERY',output);return;}
      }
      if(output.discoveryRunIds?.length) {
        const pending=await this.db.sourceSyncRun.count({where:{workspaceId:run.workspaceId,id:{in:output.discoveryRunIds},status:{in:['QUEUED','RUNNING','RETRYING']}}});
        if(pending) {await this.wait(run,'WAITING_DISCOVERY',output);return;}
      }
      const candidates=await this.db.contentCandidate.findMany({where:{workspaceId:run.workspaceId,...(input.candidateId?{id:input.candidateId}:{}),post:{OR:[{channelId:run.entityId},{channelId:null}]}},include:{post:{include:{comments:true,rights:{orderBy:{createdAt:'desc'},take:1}}}},orderBy:{createdAt:'desc'},take:200});
      const used=await this.db.candidateSelectionDecision.findMany({where:{workspaceId:run.workspaceId,channelId:run.entityId},include:{post:{select:{topicTags:true}}},orderBy:{createdAt:'desc'},take:1000});
      const decisions=rankCandidates(candidates.map((candidate)=>({id:candidate.id,sourcePostId:candidate.post.id,score:candidate.score,status:candidate.status,body:candidate.post.body,title:candidate.post.title,sourceConfigId:candidate.post.sourceConfigId,language:candidate.post.language,topics:candidate.post.topicTags,publishedAt:candidate.post.publishedAt,rights:candidate.post.rights[0]??null,sensitiveFlags:[...candidate.post.sensitiveFlags,...candidate.post.comments.flatMap((c)=>c.sensitiveFlags)],deletedAt:candidate.post.deletedAt,estimatedCostUsd:config.estimatedRunCostUsd})),config,{usedSourcePostIds:used.map((u)=>u.sourcePostId),recentTopics:used.slice(0,5).flatMap((u)=>u.post.topicTags)});
      const selected=decisions.find((d)=>d.eligible);
      await this.step(run,'SCORING','SUCCEEDED',{algorithmVersion:'autopilot-ranking-v1',decisions});
      if(!selected) {
        if(input.dryRun) {await this.wait(run,'SUCCEEDED',{selection:decisions,blockers:['NO_ELIGIBLE_CANDIDATE']},0);return;}
        throw new Error('NO_ELIGIBLE_CANDIDATE');
      }
      const candidate=candidates.find((c)=>c.id===selected.id)!;
      const comments=selectComments(candidate.post.comments,{maxCount:config.commentCount,maxDurationSec:config.commentDurationSec,sourceText:candidate.post.body});
      output.selection={candidateId:candidate.id,sourcePostId:candidate.post.id,decision:selected,comments};
      await this.step(run,'CANDIDATE_SELECTION','SUCCEEDED',output.selection);
      await this.step(run,'RIGHTS_PRECHECK');
      if(input.dryRun) {await this.wait(run,'SUCCEEDED',{...output,blockers:['DRY_RUN_NO_SIDE_EFFECTS']},0);return;}
      const profile=listVoiceProfiles().find((p)=>p.id===config.voiceProfileId);
      if(!profile) throw new Error('VOICE_PROFILE_UNAVAILABLE');
      if(profile.language!=='multilingual'&&!config.languages[0]?.toLocaleLowerCase().startsWith(profile.language.toLocaleLowerCase()))throw new Error('VOICE_LANGUAGE_MISMATCH');
      if(profile.requiresCredentials||process.env.SCRIPT_PROVIDER==='openai') throw new Error('PAID_PROVIDER_BUDGET_UNBOUNDED');
      const backgrounds=await this.db.mediaAsset.findMany({where:{workspaceId:run.workspaceId,kind:'BACKGROUND'},orderBy:{createdAt:'asc'},take:200});
      const available=backgrounds.filter((b)=>{const rights=z.object({approved:z.literal(true),attested:z.literal(true),basis:z.enum(['OWNED','LICENSED','CONSENTED']),expiresAt:z.string().optional()}).passthrough().safeParse(b.rightsMetadata);const category=z.object({category:z.string().optional()}).passthrough().safeParse(b.metadata);return rights.success&&(!rights.data.expiresAt||Date.parse(rights.data.expiresAt)>Date.now())&&(!config.backgroundCategories.length||category.success&&config.backgroundCategories.includes(category.data.category??''));});
      if(config.backgroundCategories.length&&!available.length) throw new Error('BACKGROUND_UNAVAILABLE');
      const priorBackgrounds=await this.db.workflowRun.findMany({where:{workspaceId:run.workspaceId,entityId:run.entityId,entityType:'AUTOPILOT',id:{not:run.id}},orderBy:{createdAt:'desc'},take:3,select:{output:true}});
      const recent=new Set(priorBackgrounds.flatMap((r)=>{const parsed=outputSchema.safeParse(r.output);return parsed.success&&parsed.data.backgroundAssetId?[parsed.data.backgroundAssetId]:[];}));
      const background=(available.find((b)=>!recent.has(b.id))??available[0])?.id??null;
      output.backgroundAssetId=background;
      const queued=await this.db.$transaction(async(tx)=>{
        await this.guard(tx,run);
        await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id"=${input.ruleId} AND "workspaceId"=${run.workspaceId} FOR UPDATE`;
        const now=new Date();
        const recentSelections=await tx.candidateSelectionDecision.findMany({where:{workspaceId:run.workspaceId,channelId:run.entityId,createdAt:{gte:new Date(now.getTime()-7*86400000)}},select:{createdAt:true}});
        const today=recentSelections.filter((item)=>zonedDateKey(item.createdAt,config.timezone)===zonedDateKey(now,config.timezone)).length;
        const week=recentSelections.length;
        if(today>=config.dailyLimit||week>=config.weeklyLimit) throw new Error('PRODUCTION_FREQUENCY_LIMIT');
        const latest=await tx.contentCandidate.findFirstOrThrow({where:{id:candidate.id,workspaceId:run.workspaceId},include:{post:{include:{comments:{where:{id:{in:comments.commentIds}}},rights:{orderBy:{createdAt:'desc'},take:1}}}}});
        if(latest.status!=='APPROVED'||latest.post.deletedAt||latest.post.sensitiveFlags.length||latest.post.comments.some((comment)=>comment.sensitiveFlags.length)||latest.post.comments.length!==comments.commentIds.length||config.targetPlatforms.some((p)=>!evaluateRights(latest.post.rights[0],p).eligible)) throw new Error('BLOCKED_RIGHTS');
        await tx.candidateSelectionDecision.create({data:{workspaceId:run.workspaceId,channelId:run.entityId,sourcePostId:candidate.post.id,workflowRunId:run.id,candidateId:candidate.id,algorithmVersion:selected.algorithmVersion,reasoning:toJson(output.selection)}});
        const story=await tx.storyProject.findFirst({where:{workspaceId:run.workspaceId,sourcePostId:candidate.post.id,channelId:run.entityId}})??await tx.storyProject.create({data:{workspaceId:run.workspaceId,sourcePostId:candidate.post.id,channelId:run.entityId}});
        const productionInput=productionInputSchema.parse({mode:'CREATE',candidateId:candidate.id,channelId:run.entityId,language:config.languages[0],targetDurationSec:config.durationSec,style:'STORYTELLING',voiceProfileId:profile.id,voiceId:profile.voiceId,speakingRate:1,templateId:config.templateId,backgroundAssetId:background,subtitlePreset:config.subtitlePreset,theme:'dark',anonymizeAuthors:true,showEngagement:true,selectedSegmentIds:[],storyVersionId:null,commentIds:comments.commentIds});
        const production=await tx.productionRun.create({data:{workspaceId:run.workspaceId,storyProjectId:story.id,requestedById:input.requestedById,idempotencyKey:`autopilot:${run.id}`,input:toJson(productionInput),status:'QUEUED',currentStage:'SCRIPT_GENERATION'}});
        await tx.renderJob.create({data:{workspaceId:run.workspaceId,productionRunId:production.id,status:'QUEUED'}});
        await tx.outboxEvent.create({data:{workspaceId:run.workspaceId,eventType:'PRODUCTION_RUN_REQUESTED',aggregateId:production.id,payload:{entityId:production.id,workspaceId:run.workspaceId,version:1}}});
        output.productionRunId=production.id;
        await tx.workflowRun.update({where:{workspaceId_id:{workspaceId:run.workspaceId,id:run.id}},data:{status:'WAITING_PRODUCTION',currentStep:'VIDEO_RENDERING',output:toJson(output),nextRunAt:new Date(Date.now()+15000),leaseUntil:null}});
        return production;
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      return queued;
    }

    const production=await this.db.productionRun.findFirstOrThrow({
      where:{id:output.productionRunId,workspaceId:run.workspaceId},
      include:{stages:true,videos:{include:{
        mediaAsset:true,
        storyVersion:{include:{audioAssets:{include:{mediaAsset:true}},subtitleTracks:true}},
        story:{include:{post:{include:{comments:true,rights:{orderBy:{createdAt:'desc'},take:1}}}}},
      }}},
    });
    for(const stage of production.stages) await this.db.workflowStep.upsert({where:{workflowRunId_name:{workflowRunId:run.id,name:stage.name}},create:{workspaceId:run.workspaceId,workflowRunId:run.id,name:stage.name,status:stage.status,startedAt:stage.startedAt,completedAt:stage.completedAt,errorCode:stage.errorCode},update:{status:stage.status,startedAt:stage.startedAt,completedAt:stage.completedAt,errorCode:stage.errorCode}});
    if(production.status!=='SUCCEEDED') {
      if(production.status==='FAILED_RETRYABLE'&&production.errorCode==='AUTOMATION_PAUSED'||manualRetry&&['FAILED_RETRYABLE','FAILED_PERMANENT'].includes(production.status)) {
        await this.db.$transaction(async(tx)=>{
          await this.guard(tx,run);
          const requeued=await tx.productionRun.updateMany({where:{id:production.id,workspaceId:run.workspaceId,status:production.status,attempts:production.attempts},data:{status:'QUEUED',errorCode:null,completedAt:null,workerLeaseUntil:null}});
          if(requeued.count){
            await tx.renderJob.updateMany({where:{workspaceId:run.workspaceId,productionRunId:production.id},data:{status:'QUEUED',errorCode:null,completedAt:null}});
            await tx.outboxEvent.create({data:{workspaceId:run.workspaceId,eventType:'PRODUCTION_RUN_REQUESTED',aggregateId:production.id,payload:{entityId:production.id,workspaceId:run.workspaceId,version:production.attempts+1}}});
          }
        });
        await this.wait(run,'WAITING_PRODUCTION',output);return;
      }
      if(production.status.startsWith('FAILED')||production.status.startsWith('BLOCKED')||production.status==='CANCELLED') throw new Error(production.errorCode??'CHILD_PRODUCTION_FAILED');
      await this.wait(run,'WAITING_PRODUCTION',output);return;
    }
    const video=production.videos[0];
    if(!video?.mediaAsset||!video.storyVersion||!video.story) throw new Error('VIDEO_ASSET_MISSING');
    output.videoId=video.id;
    let storedReport=await this.db.contentQualityReport.findUnique({where:{workflowRunId_videoId:{workflowRunId:run.id,videoId:video.id}}});
    if(!storedReport) {
      await this.step(run,'QUALITY_VALIDATION','RUNNING');
      const store=new LocalObjectStore(path.resolve(process.env.STORAGE_LOCAL_ROOT??'.data/objects'));
      const bytes=await store.get(run.workspaceId,video.mediaAsset.checksum);
      const dir=await mkdtemp(path.join(os.tmpdir(),'sf-quality-'));
      let report;
      try {
        const file=path.join(dir,'video.mp4');await writeFile(file,bytes);
        const measured=await inspectRenderedVideo(file);
        const manifest=renderManifestSchema.parse(video.renderManifest);
        const requiredIds=[...manifest.audioAssets.map((a)=>a.assetId),...(manifest.backgroundAssetId?[manifest.backgroundAssetId]:[])];
        const assets=await this.db.mediaAsset.findMany({where:{workspaceId:run.workspaceId,id:{in:requiredIds}}});
        for(const asset of assets) await store.get(run.workspaceId,asset.checksum);
        const source:ScriptSource={id:video.story.post.id,platform:manifest.platform,title:video.story.post.title,body:video.story.post.body,comments:video.story.post.comments.map((c)=>({id:c.id,body:c.body}))};
        const bg=assets.find((a)=>a.id===manifest.backgroundAssetId);
        const bgRights=z.object({approved:z.literal(true),attested:z.literal(true),basis:z.enum(['OWNED','LICENSED','CONSENTED']),commercialAllowed:z.literal(true),expiresAt:z.string().optional()}).passthrough().safeParse(bg?.rightsMetadata);
        const sourceSafe=!video.story.post.deletedAt&&!video.story.post.sensitiveFlags.length&&!video.story.post.comments.some((comment)=>comment.sensitiveFlags.length);
        report=evaluateQuality({media:{...measured,readable:true},manifest,script:video.storyVersion.script,source,rights:sourceSafe?video.story.post.rights[0]??null:null,platforms:config.targetPlatforms,minScore:config.minQualityScore,maxDurationSec:120,availableAssetIds:assets.map((a)=>a.id),backgroundRightsApproved:!bg||bgRights.success&&(!bgRights.data.expiresAt||Date.parse(bgRights.data.expiresAt)>Date.now()),timingPrecision:video.storyVersion.subtitleTracks[0]?.timingPrecision==='PROVIDER'?'PROVIDER':'APPROXIMATE',audioProvider:video.storyVersion.audioAssets[0]?.provider});
      } finally {await rm(dir,{recursive:true,force:true});}
      storedReport=await this.db.$transaction(async(tx)=>{
        await this.guard(tx,run);
        const record=await tx.contentQualityReport.create({data:{workspaceId:run.workspaceId,workflowRunId:run.id,videoId:video.id,status:report.status,score:report.score,report:toJson(report)}});
        const reservation=await tx.budgetReservation.findUnique({where:{workflowRunId:run.id}});
        await tx.usageEvent.upsert({where:{workspaceId_key:{workspaceId:run.workspaceId,key:`automation:${run.id}`}},create:{workspaceId:run.workspaceId,channelId:run.entityId,workflowRunId:run.id,key:`automation:${run.id}`,stage:'PRODUCTION_ESTIMATE',units:1,unit:'video',estimatedUsd:reservation?.amountUsd??config.estimatedRunCostUsd,metadata:{basis:'Configured reservation estimate, not a billed cost.'}},update:{}});
        for(const audio of video.storyVersion!.audioAssets){
          if(audio.usageUnits===null)continue;
          const key=`audio:${audio.id}`;
          await tx.usageEvent.upsert({where:{workspaceId_key:{workspaceId:run.workspaceId,key}},create:{workspaceId:run.workspaceId,channelId:run.entityId,workflowRunId:run.id,key,stage:'TTS_GENERATION',units:audio.usageUnits,unit:'characters',estimatedUsd:null,billedUsd:null,metadata:{provider:audio.provider,providerEstimatedCostUsd:audio.estimatedCostUsd,basis:'Measured provider usage; any provider estimate is metadata to avoid double counting the run estimate.'}},update:{}});
        }
        const render=production.stages.find((stage)=>stage.name==='VIDEO_RENDER');
        if(render?.startedAt&&render.completedAt){
          const key=`render:${production.id}`;
          await tx.usageEvent.upsert({where:{workspaceId_key:{workspaceId:run.workspaceId,key}},create:{workspaceId:run.workspaceId,channelId:run.entityId,workflowRunId:run.id,key,stage:'VIDEO_RENDER',units:Math.max(0,(render.completedAt.getTime()-render.startedAt.getTime())/1000),unit:'seconds',estimatedUsd:null,billedUsd:null,metadata:{basis:'Measured stage wall time, not CPU time or billed compute.'}},update:{}});
        }
        const storageKey=`storage:${video.mediaAsset!.id}`;
        await tx.usageEvent.upsert({where:{workspaceId_key:{workspaceId:run.workspaceId,key:storageKey}},create:{workspaceId:run.workspaceId,channelId:run.entityId,workflowRunId:run.id,key:storageKey,stage:'STORAGE_UPLOAD',units:bytes.length,unit:'bytes',estimatedUsd:null,billedUsd:null,metadata:{mediaAssetId:video.mediaAsset!.id,basis:'Measured finished MP4 bytes; storage billing is unavailable.'}},update:{}});
        await tx.budgetReservation.updateMany({where:{workspaceId:run.workspaceId,workflowRunId:run.id,status:'ACTIVE'},data:{status:'CONSUMED'}});
        return record;
      });
      await this.step(run,'QUALITY_VALIDATION','SUCCEEDED',report);
    }
    output.quality=storedReport.report;
    if(storedReport.status==='BLOCKED') {await this.wait(run,'BLOCKED',{...output,blockers:['QUALITY_BLOCKED']},0);return;}
    if(video.reviewStatus==='REJECTED'||video.reviewStatus==='BLOCKED') throw new Error('VIDEO_REJECTED');
    await this.step(run,'APPROVAL_GATE',video.reviewStatus==='APPROVED'?'SUCCEEDED':'WAITING',{videoId:video.id,qualityStatus:storedReport.status});
    if(video.reviewStatus!=='APPROVED') {await this.wait(run,'AWAITING_APPROVAL',output,30);return;}
    if(!config.accountIds.length) {await this.wait(run,'SUCCEEDED',{...output,blockers:['NO_PUBLICATION_DESTINATIONS']},0);return;}
    if(!output.publicationIds) {
      const accounts=await this.db.socialAccount.findMany({where:{workspaceId:run.workspaceId,id:{in:config.accountIds},platform:{in:config.targetPlatforms}},orderBy:{id:'asc'}});
      const ids=await this.db.$transaction(async(tx)=>{
        await this.guard(tx,run);
        const ids:string[]=[];
        for(const account of accounts) {
          await tx.$queryRaw`SELECT "id" FROM "SocialAccount" WHERE "workspaceId"=${run.workspaceId} AND "id"=${account.id} FOR UPDATE`;
          const flags=z.object({provider:z.string().optional(),directPost:z.boolean().optional(),authorized:z.boolean().optional(),creatorConsent:z.boolean().optional(),productApproved:z.boolean().optional()}).passthrough().safeParse(account.capabilityFlags);
          if(!evaluateRights(video.story!.post.rights[0],account.platform).eligible) throw new Error('BLOCKED_RIGHTS');
          if(account.platform==='TIKTOK') throw new Error('TIKTOK_CREATOR_ACTION_REQUIRED');
          const mock=process.env.NODE_ENV!=='production'&&account.status==='MOCK'&&flags.success&&flags.data.provider==='mock';
          if(!mock) throw new Error('BLOCKED_EXTERNAL');
          if(config.mode==='FULL_AUTO'&&!evaluateAutomaticPublication({rule:config,videoReviewStatus:video.reviewStatus,quality:{status:storedReport!.status as 'PASS'|'NEEDS_REVIEW'|'BLOCKED',score:storedReport!.score},rights:video.story!.post.rights[0]??null,platform:account.platform as 'YOUTUBE'|'FACEBOOK',capabilities:{directPost:true,authorized:flags.success&&flags.data.authorized===true}}).eligible) throw new Error('AUTOMATIC_PUBLICATION_NOT_AUTHORIZED');
          const prior=await tx.publication.findMany({where:{workspaceId:run.workspaceId,socialAccountId:account.id,status:{not:'CANCELLED'},scheduledAt:{gte:new Date(Date.now()-86400000)}},select:{scheduledAt:true}});
          const date=schedulePreview({now:new Date(),timezone:config.timezone,postingTimes:config.postingTimes,count:1,existing:prior.flatMap((p)=>p.scheduledAt?[{at:p.scheduledAt,accountId:account.id}]:[]),cooldownMinutes:config.cooldownMinutes,dailyLimit:config.accountDailyLimit,accountId:account.id})[0];
          if(!date) throw new Error('SCHEDULE_UNAVAILABLE');
          const publication=await tx.publication.upsert({where:{idempotencyKey:`autopilot:${run.id}:${account.id}`},create:{workspaceId:run.workspaceId,videoId:video.id,socialAccountId:account.id,idempotencyKey:`autopilot:${run.id}:${account.id}`,status:'SCHEDULED',scheduledAt:date,metadata:{privacy:'PRIVATE',provider:'mock',automationRunId:run.id}},update:{}});
          ids.push(publication.id);
        }
        return ids;
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      output.publicationIds=ids;
      await this.step(run,'PUBLISHING_SCHEDULE','SUCCEEDED',{publicationIds:ids});
      await this.wait(run,'WAITING_PUBLICATION',output);return;
    }
    await this.publishMocks(run,input,output.publicationIds);
    const pending=await this.db.publication.count({where:{workspaceId:run.workspaceId,id:{in:output.publicationIds},status:{not:'PUBLISHED'}}});
    if(pending) {await this.wait(run,'WAITING_PUBLICATION',output,30);return;}
    await this.step(run,'AUTHORIZED_PUBLICATION');
    await this.step(run,'ANALYTICS_COLLECTION','SUCCEEDED',{status:'QUEUED'});
    await this.wait(run,'SUCCEEDED',output,0);
  }

  private async publishMocks(run:WorkflowRun,input:z.infer<typeof inputSchema>,ids:string[]) {
    for(const id of ids) {
      const publication=await this.db.publication.findFirst({
        where:{id,workspaceId:run.workspaceId},
        include:{account:true,video:{include:{story:{include:{post:{include:{comments:true,rights:{orderBy:{createdAt:'desc'},take:1}}}}}}}},
      });
      if(!publication||publication.status==='PUBLISHED'||publication.status==='CANCELLED'||(publication.scheduledAt&&publication.scheduledAt>new Date())) continue;
      if(process.env.NODE_ENV==='production'||publication.account.status!=='MOCK'||!['YOUTUBE','FACEBOOK'].includes(publication.account.platform)) throw new Error('BLOCKED_EXTERNAL');
      const adapter=new MockPublisherAdapter(publication.account.platform as 'YOUTUBE'|'FACEBOOK');
      const mayPublish=await this.db.$transaction(async(tx)=>{
        await this.guard(tx,run);
        const current=await tx.publication.findFirstOrThrow({where:{id,workspaceId:run.workspaceId},include:{account:true,video:{include:{story:{include:{post:{include:{comments:true,rights:{orderBy:{createdAt:'desc'},take:1}}}}}}}}});
        if(current.status==='PUBLISHED'||current.status==='CANCELLED')return false;
        const post=current.video.story?.post;
        const report=await tx.contentQualityReport.findUnique({where:{workflowRunId_videoId:{workflowRunId:run.id,videoId:current.videoId}}});
        const flags=z.object({provider:z.literal('mock'),authorized:z.boolean().optional()}).passthrough().safeParse(current.account.capabilityFlags);
        if(current.account.status!=='MOCK'||!flags.success||!['YOUTUBE','FACEBOOK'].includes(current.account.platform))throw new Error('BLOCKED_EXTERNAL');
        if(current.video.reviewStatus!=='APPROVED'||!current.video.mediaAssetId||!post||post.deletedAt||post.sensitiveFlags.length||post.comments.some((comment)=>comment.sensitiveFlags.length)||!evaluateRights(post.rights[0],current.account.platform).eligible||!report||report.status==='BLOCKED')throw new Error('BLOCKED_RIGHTS');
        if(input.config.mode==='FULL_AUTO'&&!evaluateAutomaticPublication({rule:input.config,videoReviewStatus:current.video.reviewStatus,quality:{status:report.status as 'PASS'|'NEEDS_REVIEW'|'BLOCKED',score:report.score},rights:post.rights[0]??null,platform:current.account.platform as 'YOUTUBE'|'FACEBOOK',capabilities:{directPost:true,authorized:flags.data.authorized===true}}).eligible)throw new Error('AUTOMATIC_PUBLICATION_NOT_AUTHORIZED');
        await tx.publicationAttempt.upsert({where:{publicationId_attemptNo:{publicationId:id,attemptNo:1}},create:{workspaceId:run.workspaceId,publicationId:id,attemptNo:1,stage:'MOCK_UPLOAD'},update:{}});
        return true;
      });
      if(!mayPublish)continue;
      const result=await adapter.publish({publicationId:id,workspaceId:run.workspaceId,accountId:publication.socialAccountId,mediaAssetId:publication.video.mediaAssetId??'',title:publication.video.title,description:'Synthetic development publication',privacy:'PRIVATE',idempotencyKey:publication.idempotencyKey});
      if(result.status!=='PUBLISHED'||!result.remoteId) throw new Error('MOCK_PUBLICATION_FAILED');
      await this.db.$transaction(async(tx)=>{
        await this.guard(tx,run);
        await tx.publication.update({where:{workspaceId_id:{workspaceId:run.workspaceId,id}},data:{status:'PUBLISHED',remotePostId:result.remoteId,publishedAt:new Date(),errorCode:null}});
        await tx.publicationAttempt.update({where:{publicationId_attemptNo:{publicationId:id,attemptNo:1}},data:{stage:'MOCK_CONFIRMED',completedAt:new Date(),operationId:result.remoteId}});
        const sync=await tx.analyticsSyncRun.create({data:{workspaceId:run.workspaceId,publicationId:id}});
        await tx.outboxEvent.create({data:{workspaceId:run.workspaceId,eventType:'ANALYTICS_SYNC_REQUESTED',aggregateId:sync.id,payload:{entityId:sync.id,workspaceId:run.workspaceId,version:1}}});
        await tx.auditLog.create({data:{workspaceId:run.workspaceId,actorId:input.requestedById,action:'MOCK_PUBLICATION_CONFIRMED',resourceType:'Publication',resourceId:id}});
      });
    }
  }
}

export async function scheduleAutomation(db:PrismaClient,batch=20,now=new Date()) {
  for(let i=0;i<batch;i++) {
    const created=await db.$transaction(async(tx)=>{
      const rows=await tx.$queryRaw<Array<{id:string;workspaceId:string;channelId:string;config:Prisma.JsonValue}>>`SELECT "id","workspaceId","channelId","config" FROM "AutomationRule" WHERE "status"='ACTIVE' AND "nextRunAt"<=${now} ORDER BY "nextRunAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      const rule=rows[0];if(!rule)return false;
      const config=automationRuleSchema.parse(rule.config);
      await tx.automationRule.update({where:{workspaceId_id:{workspaceId:rule.workspaceId,id:rule.id}},data:{nextRunAt:new Date(now.getTime()+config.intervalMinutes*60000)}});
      if(config.mode==='MANUAL')return true;
      const owner=await tx.workspaceMember.findFirst({where:{workspaceId:rule.workspaceId,role:{in:['OWNER','ADMIN']}},select:{userId:true}});
      if(!owner)return true;
      const active=await tx.workflowRun.count({where:{workspaceId:rule.workspaceId,entityType:'AUTOPILOT',entityId:rule.channelId,status:{in:activeWorkflowStatuses}}});
      if(active)return true;
      try {await createAutomationRun(tx,rule.workspaceId,rule.channelId,owner.userId);} catch(error) {if(!/BUDGET|CONCURRENCY/.test(code(error)))throw error;}
      return true;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    if(!created)break;
  }
  const due=await db.workflowRun.findMany({where:{entityType:'AUTOPILOT',status:{in:[...activeWorkflowStatuses,'FAILED_RETRYABLE']},nextRunAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},take:batch});
  for(const run of due) await db.$transaction(async(tx)=>{
    const claim=await tx.workflowRun.updateMany({where:{id:run.id,workspaceId:run.workspaceId,version:run.version,nextRunAt:{lte:now},OR:[{leaseUntil:null},{leaseUntil:{lt:now}}]},data:{version:{increment:1},nextRunAt:new Date(now.getTime()+60000)}});
    if(claim.count)await tx.outboxEvent.create({data:{workspaceId:run.workspaceId,eventType:'AUTOPILOT_RUN_REQUESTED',aggregateId:run.id,payload:{entityId:run.id,workspaceId:run.workspaceId,version:run.version+1}}});
  });
}
