import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '../packages/database/src/index.js';
import { automationRuleSchema } from '../packages/automation/src/index.js';
import { analyticsSnapshotSchema } from '../packages/analytics/src/index.js';
import { AutopilotPipeline, createAutomationRun, processAnalyticsSync, refreshPerformanceRecommendations, toJson } from '../packages/workflows/src/index.js';
import { listVoiceProfiles } from '../packages/media/src/index.js';
import { DiscoveryPipeline } from '../workers/discovery/src/pipeline.js';
import { readWorkerConfig } from '../workers/discovery/src/config.js';
import { MediaProductionPipeline } from '../workers/media/src/pipeline.js';
import { readMediaWorkerConfig } from '../workers/media/src/config.js';

if(process.env.NODE_ENV==='production')throw new Error('Smoke is disabled in production.');
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Set TEST_DATABASE_URL to a migrated, dedicated database ending in _test.');
Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:url,TTS_PROVIDER:'local',SCRIPT_PROVIDER:'mock',ANALYTICS_MIN_SAMPLES:'3'});
if(!process.env.REMOTION_BROWSER_EXECUTABLE)for(const file of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','/usr/bin/chromium'])if(existsSync(file)){process.env.REMOTION_BROWSER_EXECUTABLE=file;break;}
const profile=listVoiceProfiles().find((p)=>p.provider==='local'&&p.language==='en');
if(!profile)throw new Error('Install an English local voice/eSpeak NG; the QC gate rejects mock test tones.');
const db=new PrismaClient({datasourceUrl:url});
const envelope=(workspaceId:string,entityId:string,step:string)=>({jobId:randomUUID(),workspaceId,entityId,step,version:1,idempotencyKey:randomUUID(),traceId:randomUUID(),attempt:0,scheduledAt:new Date().toISOString()});
const namespace=randomUUID();
let workspaceId='';
try {
  const user=await db.user.create({data:{email:`autopilot-${namespace}@example.org`,passwordHash:'disabled-smoke-login'}});
  const workspace=await db.workspace.create({data:{name:'Synthetic Autopilot smoke',slug:`smoke-${namespace}`,members:{create:{userId:user.id,role:'OWNER'}}}});workspaceId=workspace.id;
  const channel=await db.contentChannel.create({data:{workspaceId,name:'English fixture channel',language:'en',minimumCandidateScore:0,topicConfig:{},automationConfig:{}}});
  const source=await db.sourceConfig.create({data:{workspaceId,channelId:channel.id,platform:'MANUAL',sourceKey:`smoke-${namespace}`,enabled:false,capabilityStatus:'AVAILABLE',config:{mode:'MOCK_FIXTURE',language:'en'}}});
  const discovery=await db.sourceSyncRun.create({data:{workspaceId,sourceConfigId:source.id,status:'QUEUED',idempotencyKey:namespace}});
  // Enable only while running the synthetic adapter; no live source is contacted.
  await db.sourceConfig.update({where:{id:source.id},data:{enabled:true}});
  const discoveryPipeline=new DiscoveryPipeline(db,readWorkerConfig({...process.env,REDIS_URL:process.env.REDIS_URL??'redis://127.0.0.1:6379'}));
  await discoveryPipeline.process(envelope(workspaceId,discovery.id,'SOURCE_SYNC_REQUESTED'));
  await db.sourceConfig.update({where:{id:source.id},data:{enabled:false}});
  const candidates=await db.contentCandidate.findMany({where:{workspaceId},include:{post:true}});
  assert.ok(candidates.length>0,'Discovery must create real candidate rows.');
  for(const candidate of candidates){
    await db.contentRight.updateMany({where:{workspaceId,sourcePostId:candidate.post.id},data:{basis:'OWNED',attested:true,commercialAllowed:true,allowedPlatforms:['YOUTUBE','FACEBOOK'],territory:'WORLDWIDE',reviewStatus:'APPROVED',reviewedById:user.id,reviewedAt:new Date(),evidence:'Synthetic fixture explicitly approved for this test.'}});
    await db.contentCandidate.update({where:{id:candidate.id},data:{status:'APPROVED'}});
  }
  const accounts=await Promise.all(['YOUTUBE','FACEBOOK'].map((platform)=>db.socialAccount.create({data:{workspaceId,platform:platform as 'YOUTUBE'|'FACEBOOK',externalId:`fixture-${platform}`,displayName:`Synthetic ${platform}`,status:'MOCK',capabilityFlags:{provider:'mock',authorized:true,analyticsProvider:'mock'}}})));
  const config=automationRuleSchema.parse({mode:'SEMI_AUTO',voiceProfileId:profile.id,languages:['en'],minScore:0,sourceIds:[source.id],accountIds:accounts.map((a)=>a.id),targetPlatforms:['YOUTUBE','FACEBOOK'],durationSec:25,commentCount:1,estimatedRunCostUsd:0.1});
  const rule=await db.automationRule.create({data:{workspaceId,channelId:channel.id,status:'ACTIVE',config:toJson(config)}});
  await db.automationRuleVersion.create({data:{workspaceId,ruleId:rule.id,version:1,config:toJson(config)}});
  const run=await db.$transaction((tx)=>createAutomationRun(tx,workspaceId,channel.id,user.id));
  const pipeline=new AutopilotPipeline(db);
  await pipeline.process(workspaceId,run.id);
  const prepared=await db.workflowRun.findUniqueOrThrow({where:{id:run.id}});
  const productionRunId=(prepared.output as {productionRunId?:string})?.productionRunId;
  assert.ok(productionRunId,'Autopilot must queue the existing media worker.');
  const media=new MediaProductionPipeline(db,readMediaWorkerConfig({...process.env,REDIS_URL:process.env.REDIS_URL??'redis://127.0.0.1:6379'}));
  await media.process(envelope(workspaceId,productionRunId,'PRODUCTION_RUN_REQUESTED'));
  await pipeline.process(workspaceId,run.id);
  const quality=await db.contentQualityReport.findFirstOrThrow({where:{workspaceId,workflowRunId:run.id}});
  assert.notEqual(quality.status,'BLOCKED',JSON.stringify(quality.report));
  const video=await db.video.findFirstOrThrow({where:{workspaceId,productionRunId},include:{mediaAsset:true}});
  assert.ok(video.mediaAsset,'Real MP4 must be stored.');
  // Explicit fixture reviewer decision. Unmeasured silence/timing remains NEEDS_REVIEW in its report.
  await db.$transaction(async(tx)=>{await tx.video.update({where:{id:video.id},data:{status:'APPROVED',reviewStatus:'APPROVED'}});await tx.auditLog.create({data:{workspaceId,actorId:user.id,action:'SMOKE_FIXTURE_REVIEW_APPROVED',resourceType:'Video',resourceId:video.id}});});
  await pipeline.process(workspaceId,run.id);
  await db.publication.updateMany({where:{workspaceId,status:'SCHEDULED'},data:{scheduledAt:new Date()}});
  await pipeline.process(workspaceId,run.id);
  const publications=await db.publication.findMany({where:{workspaceId}});
  assert.equal(publications.length,2);assert.ok(publications.every((p)=>p.status==='PUBLISHED'&&p.remotePostId?.startsWith('mock:')));
  await pipeline.process(workspaceId,run.id);
  assert.equal(await db.publicationAttempt.count({where:{workspaceId}}),2,'Retry must preserve one attempt per synthetic destination.');
  const syncs=await db.analyticsSyncRun.findMany({where:{workspaceId}});
  for(const sync of syncs)await processAnalyticsSync(db,workspaceId,sync.id);
  const snapshots=await db.publicationMetric.findMany({where:{workspaceId}});
  assert.equal(snapshots.length,2);for(const metric of snapshots)assert.equal(analyticsSnapshotSchema.parse(metric.metrics).synthetic,true);
  const recommendations=await refreshPerformanceRecommendations(db,workspaceId);
  assert.equal(recommendations,0,'Two publications are insufficient evidence; no recommendation should be fabricated.');
  await mkdir(path.resolve('test-results'),{recursive:true});
  const output=path.resolve('test-results/phase5-smoke.mp4');
  await copyFile(path.resolve(process.env.STORAGE_LOCAL_ROOT??'.data/objects',video.mediaAsset.storageKey),output);
  process.stdout.write(`${JSON.stringify({status:'PASS',workspaceId,workflowRunId:run.id,output,quality:quality.status,publications:2,snapshots:2,recommendations:'INSUFFICIENT_DATA',note:'Synthetic mock publishing only; fixture records retained in the dedicated test database for inspection.'})}\n`);
} finally {await db.$disconnect();}
