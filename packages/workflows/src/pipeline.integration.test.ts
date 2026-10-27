import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@shorts-factory/database';
import { automationRuleSchema } from '@shorts-factory/automation';
import { createAutomationRun, toJson } from './automation.js';
import { AutopilotPipeline } from './pipeline.js';

const testUrl=process.env.TEST_DATABASE_URL;
if(testUrl&&!new URL(testUrl).pathname.endsWith('_test'))throw new Error('Use a dedicated database ending in _test.');
const integration=testUrl?describe.sequential:describe.skip;

integration('Autopilot PostgreSQL checkpoints and tenant boundaries',()=>{
  let db:PrismaClient;
  const workspaces:string[]=[];
  const users:string[]=[];
  beforeAll(()=>{
    db=new PrismaClient({datasourceUrl:testUrl});
    vi.stubEnv('TTS_PROVIDER','mock');
    vi.stubEnv('SCRIPT_PROVIDER','mock');
  });
  afterAll(async()=>{
    const scope={workspaceId:{in:workspaces}};
    if(db&&workspaces.length)await db.$transaction([
      db.workflowStep.deleteMany({where:scope}),db.contentQualityReport.deleteMany({where:scope}),db.candidateSelectionDecision.deleteMany({where:scope}),db.usageEvent.deleteMany({where:scope}),db.budgetReservation.deleteMany({where:scope}),db.workflowRun.deleteMany({where:scope}),
      db.renderJob.deleteMany({where:scope}),db.productionStage.deleteMany({where:scope}),db.audioAsset.deleteMany({where:scope}),db.subtitleTrack.deleteMany({where:scope}),db.renderManifest.deleteMany({where:scope}),db.video.deleteMany({where:scope}),db.storyVersion.deleteMany({where:scope}),db.productionRun.deleteMany({where:scope}),db.storyProject.deleteMany({where:scope}),
      db.contentRight.deleteMany({where:scope}),db.contentCandidate.deleteMany({where:scope}),db.sourceComment.deleteMany({where:scope}),db.sourcePost.deleteMany({where:scope}),db.automationRuleVersion.deleteMany({where:scope}),db.automationRule.deleteMany({where:scope}),db.contentChannel.deleteMany({where:scope}),db.budgetPolicy.deleteMany({where:scope}),db.outboxEvent.deleteMany({where:scope}),db.auditLog.deleteMany({where:scope}),db.workspaceMember.deleteMany({where:scope}),db.workspace.deleteMany({where:{id:{in:workspaces}}}),db.user.deleteMany({where:{id:{in:users}}}),
    ]);
    if(db)await db.$disconnect();
    vi.unstubAllEnvs();
  });

  async function fixture(dailyLimit=3){
    const key=randomUUID();
    const workspace=await db.workspace.create({data:{slug:`autopilot-${key}`,name:'Autopilot fixture'}});workspaces.push(workspace.id);
    const user=await db.user.create({data:{email:`${key}@example.org`,passwordHash:'unusable-integration-fixture'}});users.push(user.id);
    await db.workspaceMember.create({data:{workspaceId:workspace.id,userId:user.id,role:'OWNER'}});
    const channel=await db.contentChannel.create({data:{workspaceId:workspace.id,name:'Autopilot channel',topicConfig:{},automationConfig:{}}});
    const config=automationRuleSchema.parse({voiceProfileId:'mock:default',mode:'SEMI_AUTO',dailyLimit});
    await db.automationRule.create({data:{workspaceId:workspace.id,channelId:channel.id,status:'ACTIVE',config:toJson(config)}});
    const post=await db.sourcePost.create({data:{workspaceId:workspace.id,channelId:channel.id,platform:'MANUAL',externalPostId:key,canonicalUrl:'https://example.org/owned-story',body:'A permitted story about an interesting trip to a quiet garden.',contentHash:createHash('sha256').update(key).digest('hex'),language:'vi',synthetic:true}});
    await db.contentRight.create({data:{workspaceId:workspace.id,sourcePostId:post.id,basis:'OWNED',reviewStatus:'APPROVED',attested:true,commercialAllowed:true,allowedPlatforms:['YOUTUBE'],territory:'WORLDWIDE'}});
    const candidate=await db.contentCandidate.create({data:{workspaceId:workspace.id,sourcePostId:post.id,status:'APPROVED',score:85}});
    return {workspaceId:workspace.id,userId:user.id,channelId:channel.id,candidateId:candidate.id};
  }

  it('persists one child and outbox across repeated polling and refuses cross-workspace processing',async()=>{
    const f=await fixture();
    const run=await db.$transaction((tx)=>createAutomationRun(tx,f.workspaceId,f.channelId,f.userId));
    const pipeline=new AutopilotPipeline(db);
    await pipeline.process(randomUUID(),run.id);
    expect(await db.productionRun.count({where:{workspaceId:f.workspaceId}})).toBe(0);
    await pipeline.process(f.workspaceId,run.id);
    await pipeline.process(f.workspaceId,run.id);
    expect(await db.productionRun.count({where:{workspaceId:f.workspaceId}})).toBe(1);
    expect(await db.outboxEvent.count({where:{workspaceId:f.workspaceId,eventType:'PRODUCTION_RUN_REQUESTED'}})).toBe(1);
    expect((await db.workflowRun.findUniqueOrThrow({where:{id:run.id}})).status).toBe('WAITING_PRODUCTION');
    const child=await db.productionRun.findFirstOrThrow({where:{workspaceId:f.workspaceId}});
    await db.productionRun.update({where:{id:child.id},data:{status:'FAILED_RETRYABLE',errorCode:'AUTOMATION_PAUSED',attempts:1}});
    await pipeline.process(f.workspaceId,run.id);
    await pipeline.process(f.workspaceId,run.id);
    expect(await db.productionRun.count({where:{workspaceId:f.workspaceId}})).toBe(1);
    expect(await db.outboxEvent.count({where:{workspaceId:f.workspaceId,eventType:'PRODUCTION_RUN_REQUESTED'}})).toBe(2);
    expect((await db.productionRun.findUniqueOrThrow({where:{id:child.id}})).status).toBe('QUEUED');
  });

  it('does not enqueue work while paused and blocks a revoked requester before child creation',async()=>{
    const f=await fixture();
    const run=await db.$transaction((tx)=>createAutomationRun(tx,f.workspaceId,f.channelId,f.userId));
    await db.automationRule.update({where:{workspaceId_channelId:{workspaceId:f.workspaceId,channelId:f.channelId}},data:{status:'PAUSED'}});
    const pipeline=new AutopilotPipeline(db);
    await pipeline.process(f.workspaceId,run.id);
    expect(await db.productionRun.count({where:{workspaceId:f.workspaceId}})).toBe(0);
    await db.automationRule.update({where:{workspaceId_channelId:{workspaceId:f.workspaceId,channelId:f.channelId}},data:{status:'ACTIVE'}});
    await db.workspaceMember.update({where:{workspaceId_userId:{workspaceId:f.workspaceId,userId:f.userId}},data:{role:'VIEWER'}});
    await pipeline.process(f.workspaceId,run.id);
    expect((await db.workflowRun.findUniqueOrThrow({where:{id:run.id}})).errorCode).toBe('REQUESTER_ACCESS_REVOKED');
    expect(await db.productionRun.count({where:{workspaceId:f.workspaceId}})).toBe(0);
    expect((await db.budgetReservation.findUniqueOrThrow({where:{workflowRunId:run.id}})).status).toBe('RELEASED');
  });

  it('reserves budget atomically and refuses the next run when the hard cap is reached',async()=>{
    const f=await fixture();
    await db.budgetPolicy.create({data:{workspaceId:f.workspaceId,dailyLimitUsd:0.1,monthlyLimitUsd:1}});
    await db.$transaction((tx)=>createAutomationRun(tx,f.workspaceId,f.channelId,f.userId));
    await expect(db.$transaction((tx)=>createAutomationRun(tx,f.workspaceId,f.channelId,f.userId))).rejects.toThrow('DAILY_BUDGET_EXCEEDED');
    expect(await db.workflowRun.count({where:{workspaceId:f.workspaceId,entityType:'AUTOPILOT'}})).toBe(1);
  });
});
