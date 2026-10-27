-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "input" JSONB,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "output" JSONB;

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DISABLED',
    "controlVersion" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "nextRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRuleVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "output" JSONB,

    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSelectionDecision" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "reasoning" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateSelectionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentQualityReport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentQualityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dailyLimitUsd" DECIMAL(12,6) NOT NULL,
    "monthlyLimitUsd" DECIMAL(12,6) NOT NULL,
    "warningThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,

    CONSTRAINT "BudgetPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetReservation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "amountUsd" DECIMAL(12,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT,
    "workflowRunId" TEXT,
    "key" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "estimatedUsd" DECIMAL(12,6),
    "billedUsd" DECIMAL(12,6),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSyncRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AnalyticsSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceRecommendation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PerformanceRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "variants" JSONB NOT NULL,
    "minSamples" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_status_nextRunAt_idx" ON "AutomationRule"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_workspaceId_id_key" ON "AutomationRule"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_workspaceId_channelId_key" ON "AutomationRule"("workspaceId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRuleVersion_workspaceId_id_key" ON "AutomationRuleVersion"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRuleVersion_ruleId_version_key" ON "AutomationRuleVersion"("ruleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStep_workspaceId_id_key" ON "WorkflowStep"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStep_workflowRunId_name_key" ON "WorkflowStep"("workflowRunId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSelectionDecision_workspaceId_id_key" ON "CandidateSelectionDecision"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSelectionDecision_workspaceId_channelId_sourcePost_key" ON "CandidateSelectionDecision"("workspaceId", "channelId", "sourcePostId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentQualityReport_workspaceId_id_key" ON "ContentQualityReport"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContentQualityReport_workflowRunId_videoId_key" ON "ContentQualityReport"("workflowRunId", "videoId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPolicy_workspaceId_key" ON "BudgetPolicy"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPolicy_workspaceId_id_key" ON "BudgetPolicy"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "BudgetReservation_workspaceId_status_idx" ON "BudgetReservation"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetReservation_workspaceId_id_key" ON "BudgetReservation"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetReservation_workflowRunId_key" ON "BudgetReservation"("workflowRunId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetReservation_workspaceId_workflowRunId_key" ON "BudgetReservation"("workspaceId", "workflowRunId");

-- CreateIndex
CREATE INDEX "UsageEvent_workspaceId_occurredAt_idx" ON "UsageEvent"("workspaceId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_workspaceId_id_key" ON "UsageEvent"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_workspaceId_key_key" ON "UsageEvent"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "AnalyticsSyncRun_status_nextRunAt_idx" ON "AnalyticsSyncRun"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSyncRun_workspaceId_id_key" ON "AnalyticsSyncRun"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceRecommendation_workspaceId_id_key" ON "PerformanceRecommendation"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceRecommendation_workspaceId_key_key" ON "PerformanceRecommendation"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_workspaceId_id_key" ON "Experiment"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentAssignment_workspaceId_id_key" ON "ExperimentAssignment"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentAssignment_experimentId_sourcePostId_key" ON "ExperimentAssignment"("experimentId", "sourcePostId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentAssignment_experimentId_videoId_key" ON "ExperimentAssignment"("experimentId", "videoId");

-- CreateIndex
CREATE INDEX "WorkflowRun_entityType_status_nextRunAt_idx" ON "WorkflowRun"("entityType", "status", "nextRunAt");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_workspaceId_channelId_fkey" FOREIGN KEY ("workspaceId", "channelId") REFERENCES "ContentChannel"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRuleVersion" ADD CONSTRAINT "AutomationRuleVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRuleVersion" ADD CONSTRAINT "AutomationRuleVersion_workspaceId_ruleId_fkey" FOREIGN KEY ("workspaceId", "ruleId") REFERENCES "AutomationRule"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_workspaceId_workflowRunId_fkey" FOREIGN KEY ("workspaceId", "workflowRunId") REFERENCES "WorkflowRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelectionDecision" ADD CONSTRAINT "CandidateSelectionDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelectionDecision" ADD CONSTRAINT "CandidateSelectionDecision_workspaceId_channelId_fkey" FOREIGN KEY ("workspaceId", "channelId") REFERENCES "ContentChannel"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelectionDecision" ADD CONSTRAINT "CandidateSelectionDecision_workspaceId_sourcePostId_fkey" FOREIGN KEY ("workspaceId", "sourcePostId") REFERENCES "SourcePost"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSelectionDecision" ADD CONSTRAINT "CandidateSelectionDecision_workspaceId_workflowRunId_fkey" FOREIGN KEY ("workspaceId", "workflowRunId") REFERENCES "WorkflowRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentQualityReport" ADD CONSTRAINT "ContentQualityReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentQualityReport" ADD CONSTRAINT "ContentQualityReport_workspaceId_workflowRunId_fkey" FOREIGN KEY ("workspaceId", "workflowRunId") REFERENCES "WorkflowRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentQualityReport" ADD CONSTRAINT "ContentQualityReport_workspaceId_videoId_fkey" FOREIGN KEY ("workspaceId", "videoId") REFERENCES "Video"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPolicy" ADD CONSTRAINT "BudgetPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_workspaceId_workflowRunId_fkey" FOREIGN KEY ("workspaceId", "workflowRunId") REFERENCES "WorkflowRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_workspaceId_channelId_fkey" FOREIGN KEY ("workspaceId", "channelId") REFERENCES "ContentChannel"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_workspaceId_workflowRunId_fkey" FOREIGN KEY ("workspaceId", "workflowRunId") REFERENCES "WorkflowRun"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSyncRun" ADD CONSTRAINT "AnalyticsSyncRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSyncRun" ADD CONSTRAINT "AnalyticsSyncRun_workspaceId_publicationId_fkey" FOREIGN KEY ("workspaceId", "publicationId") REFERENCES "Publication"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceRecommendation" ADD CONSTRAINT "PerformanceRecommendation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_workspaceId_channelId_fkey" FOREIGN KEY ("workspaceId", "channelId") REFERENCES "ContentChannel"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_workspaceId_experimentId_fkey" FOREIGN KEY ("workspaceId", "experimentId") REFERENCES "Experiment"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_workspaceId_sourcePostId_fkey" FOREIGN KEY ("workspaceId", "sourcePostId") REFERENCES "SourcePost"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_workspaceId_videoId_fkey" FOREIGN KEY ("workspaceId", "videoId") REFERENCES "Video"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
