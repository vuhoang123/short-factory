-- CreateEnum
CREATE TYPE "ProductionRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'CANCELLED', 'BLOCKED_RIGHTS', 'BLOCKED_EXTERNAL');

-- CreateEnum
CREATE TYPE "ProductionStageStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "StoryProject" ADD COLUMN     "channelId" TEXT;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "fps" INTEGER,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "productionRunId" TEXT,
ADD COLUMN     "storyVersionId" TEXT,
ADD COLUMN     "width" INTEGER;

-- CreateTable
CREATE TABLE "ProductionRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storyProjectId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ProductionRunStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStage" TEXT,
    "input" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerLeaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionStage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productionRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProductionStageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "output" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storyVersionId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "voiceProfileId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "timingPrecision" TEXT NOT NULL DEFAULT 'APPROXIMATE',
    "usageUnits" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtitleTrack" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storyVersionId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "timingPrecision" TEXT NOT NULL DEFAULT 'APPROXIMATE',
    "timeline" JSONB NOT NULL,
    "srt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtitleTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderManifest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productionRunId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "checksum" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productionRunId" TEXT NOT NULL,
    "videoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionRun_workspaceId_status_createdAt_idx" ON "ProductionRun"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRun_workspaceId_id_key" ON "ProductionRun"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRun_workspaceId_idempotencyKey_key" ON "ProductionRun"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProductionStage_workspaceId_status_updatedAt_idx" ON "ProductionStage"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionStage_workspaceId_id_key" ON "ProductionStage"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionStage_workspaceId_productionRunId_name_key" ON "ProductionStage"("workspaceId", "productionRunId", "name");

-- CreateIndex
CREATE INDEX "AudioAsset_workspaceId_storyVersionId_segmentId_idx" ON "AudioAsset"("workspaceId", "storyVersionId", "segmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AudioAsset_workspaceId_id_key" ON "AudioAsset"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AudioAsset_workspaceId_cacheKey_key" ON "AudioAsset"("workspaceId", "cacheKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubtitleTrack_workspaceId_id_key" ON "SubtitleTrack"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SubtitleTrack_workspaceId_storyVersionId_preset_key" ON "SubtitleTrack"("workspaceId", "storyVersionId", "preset");

-- CreateIndex
CREATE INDEX "RenderManifest_workspaceId_checksum_idx" ON "RenderManifest"("workspaceId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "RenderManifest_workspaceId_id_key" ON "RenderManifest"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RenderManifest_workspaceId_productionRunId_version_key" ON "RenderManifest"("workspaceId", "productionRunId", "version");

-- CreateIndex
CREATE INDEX "RenderJob_workspaceId_status_updatedAt_idx" ON "RenderJob"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RenderJob_workspaceId_id_key" ON "RenderJob"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RenderJob_workspaceId_productionRunId_key" ON "RenderJob"("workspaceId", "productionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "RenderJob_workspaceId_videoId_key" ON "RenderJob"("workspaceId", "videoId");

-- CreateIndex
CREATE UNIQUE INDEX "Video_workspaceId_productionRunId_key" ON "Video"("workspaceId", "productionRunId");

-- AddForeignKey
ALTER TABLE "StoryProject" ADD CONSTRAINT "StoryProject_workspaceId_channelId_fkey" FOREIGN KEY ("workspaceId", "channelId") REFERENCES "ContentChannel"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_workspaceId_storyVersionId_fkey" FOREIGN KEY ("workspaceId", "storyVersionId") REFERENCES "StoryVersion"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_workspaceId_productionRunId_fkey" FOREIGN KEY ("workspaceId", "productionRunId") REFERENCES "ProductionRun"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_workspaceId_storyProjectId_fkey" FOREIGN KEY ("workspaceId", "storyProjectId") REFERENCES "StoryProject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_workspaceId_requestedById_fkey" FOREIGN KEY ("workspaceId", "requestedById") REFERENCES "WorkspaceMember"("workspaceId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStage" ADD CONSTRAINT "ProductionStage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStage" ADD CONSTRAINT "ProductionStage_workspaceId_productionRunId_fkey" FOREIGN KEY ("workspaceId", "productionRunId") REFERENCES "ProductionRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAsset" ADD CONSTRAINT "AudioAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAsset" ADD CONSTRAINT "AudioAsset_workspaceId_storyVersionId_fkey" FOREIGN KEY ("workspaceId", "storyVersionId") REFERENCES "StoryVersion"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAsset" ADD CONSTRAINT "AudioAsset_workspaceId_mediaAssetId_fkey" FOREIGN KEY ("workspaceId", "mediaAssetId") REFERENCES "MediaAsset"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleTrack" ADD CONSTRAINT "SubtitleTrack_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtitleTrack" ADD CONSTRAINT "SubtitleTrack_workspaceId_storyVersionId_fkey" FOREIGN KEY ("workspaceId", "storyVersionId") REFERENCES "StoryVersion"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderManifest" ADD CONSTRAINT "RenderManifest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderManifest" ADD CONSTRAINT "RenderManifest_workspaceId_productionRunId_fkey" FOREIGN KEY ("workspaceId", "productionRunId") REFERENCES "ProductionRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_workspaceId_productionRunId_fkey" FOREIGN KEY ("workspaceId", "productionRunId") REFERENCES "ProductionRun"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_workspaceId_videoId_fkey" FOREIGN KEY ("workspaceId", "videoId") REFERENCES "Video"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

