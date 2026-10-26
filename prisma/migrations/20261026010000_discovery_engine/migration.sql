-- AlterTable
ALTER TABLE "ContentCandidate" ADD COLUMN     "eligibility" JSONB,
ADD COLUMN     "minimumScore" DOUBLE PRECISION NOT NULL DEFAULT 55,
ADD COLUMN     "reasoning" TEXT,
ADD COLUMN     "scoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ContentChannel" ADD COLUMN     "minimumCandidateScore" DOUBLE PRECISION NOT NULL DEFAULT 55;

-- AlterTable
ALTER TABLE "PostMetricSnapshot" ADD COLUMN     "sourceSyncRunId" TEXT;

-- AlterTable
ALTER TABLE "SourceComment" ADD COLUMN     "sensitiveFlags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "SourceConfig" ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "lastSyncStatus" TEXT NOT NULL DEFAULT 'NEVER',
ADD COLUMN     "syncFrequencyMinutes" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "SourcePost" ADD COLUMN     "language" TEXT,
ADD COLUMN     "rawPayload" JSONB,
ADD COLUMN     "sensitiveFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "synthetic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "topicTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "SourceSyncRun" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "nextCursor" TEXT;

-- CreateTable
CREATE TABLE "TopicRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT,
    "allow" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deny" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minimumScore" DOUBLE PRECISION NOT NULL DEFAULT 55,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TopicRule_workspaceId_enabled_idx" ON "TopicRule"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "TopicRule_workspaceId_id_key" ON "TopicRule"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TopicRule_workspaceId_channelId_name_key" ON "TopicRule"("workspaceId", "channelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ContentCandidate_workspaceId_sourcePostId_key" ON "ContentCandidate"("workspaceId", "sourcePostId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSyncRun_workspaceId_sourceConfigId_idempotencyKey_key" ON "SourceSyncRun"("workspaceId", "sourceConfigId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "PostMetricSnapshot" ADD CONSTRAINT "PostMetricSnapshot_workspaceId_sourceSyncRunId_fkey" FOREIGN KEY ("workspaceId", "sourceSyncRunId") REFERENCES "SourceSyncRun"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicRule" ADD CONSTRAINT "TopicRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicRule" ADD CONSTRAINT "TopicRule_workspaceId_channelId_fkey" FOREIGN KEY ("workspaceId", "channelId") REFERENCES "ContentChannel"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
