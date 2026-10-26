-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('MANUAL', 'REDDIT', 'THREADS', 'FACEBOOK', 'YOUTUBE', 'TIKTOK');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "RightsBasis" AS ENUM ('OWNED', 'LICENSED', 'CONSENTED', 'EXCEPTION_REVIEWED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'QUEUED', 'UPLOADING', 'PROCESSING', 'PUBLISHED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'NEEDS_ACTION', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeWorkspaceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateTable
CREATE TABLE "ContentChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'vi',
    "topicConfig" JSONB NOT NULL,
    "automationConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT,
    "platform" "Platform" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "capabilityStatus" TEXT NOT NULL DEFAULT 'BLOCKED_EXTERNAL',
    "nextSyncAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSyncRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceConfigId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cursor" TEXT,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SourceSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcePost" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceConfigId" TEXT,
    "channelId" TEXT,
    "platform" "Platform" NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "authorAlias" TEXT,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SourcePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceComment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "parentExternalId" TEXT,
    "body" TEXT NOT NULL,
    "likes" INTEGER,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "SourceComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMetricSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likes" INTEGER,
    "replies" INTEGER,
    "shares" INTEGER,
    "views" INTEGER,

    CONSTRAINT "PostMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCandidate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "factors" JSONB,
    "modelVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRight" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "basis" "RightsBasis" NOT NULL DEFAULT 'UNKNOWN',
    "evidenceAssetId" TEXT,
    "evidence" TEXT,
    "attested" BOOLEAN NOT NULL DEFAULT false,
    "allowedPlatforms" "Platform"[] DEFAULT ARRAY[]::"Platform"[],
    "commercialAllowed" BOOLEAN NOT NULL DEFAULT false,
    "territory" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "attributionRequired" BOOLEAN NOT NULL DEFAULT false,
    "attributionText" TEXT,
    "expiresAt" TIMESTAMP(3),
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryProject" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "StoryProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "storyProjectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "script" JSONB NOT NULL,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "metadata" JSONB,
    "rightsMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "storyProjectId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "renderManifest" JSONB,
    "mediaAssetId" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "secretRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "capabilityFlags" JSONB,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "remotePostId" TEXT,
    "remoteUrl" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationAttempt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "operationId" TEXT,
    "uploadSessionRef" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PublicationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationMetric" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "PublicationMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentStep" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE INDEX "ContentChannel_workspaceId_createdAt_idx" ON "ContentChannel"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentChannel_workspaceId_id_key" ON "ContentChannel"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "SourceConfig_enabled_nextSyncAt_idx" ON "SourceConfig"("enabled", "nextSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceConfig_workspaceId_id_key" ON "SourceConfig"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SourceConfig_workspaceId_platform_sourceKey_key" ON "SourceConfig"("workspaceId", "platform", "sourceKey");

-- CreateIndex
CREATE INDEX "SourceSyncRun_workspaceId_sourceConfigId_startedAt_idx" ON "SourceSyncRun"("workspaceId", "sourceConfigId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSyncRun_workspaceId_id_key" ON "SourceSyncRun"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "SourcePost_workspaceId_discoveredAt_idx" ON "SourcePost"("workspaceId", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePost_workspaceId_id_key" ON "SourcePost"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePost_workspaceId_platform_externalPostId_key" ON "SourcePost"("workspaceId", "platform", "externalPostId");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePost_workspaceId_platform_contentHash_key" ON "SourcePost"("workspaceId", "platform", "contentHash");

-- CreateIndex
CREATE INDEX "SourceComment_workspaceId_sourcePostId_idx" ON "SourceComment"("workspaceId", "sourcePostId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceComment_workspaceId_id_key" ON "SourceComment"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SourceComment_sourcePostId_externalId_key" ON "SourceComment"("sourcePostId", "externalId");

-- CreateIndex
CREATE INDEX "PostMetricSnapshot_workspaceId_sourcePostId_measuredAt_idx" ON "PostMetricSnapshot"("workspaceId", "sourcePostId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostMetricSnapshot_workspaceId_id_key" ON "PostMetricSnapshot"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "ContentCandidate_workspaceId_status_score_idx" ON "ContentCandidate"("workspaceId", "status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "ContentCandidate_workspaceId_id_key" ON "ContentCandidate"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "ContentRight_workspaceId_reviewStatus_idx" ON "ContentRight"("workspaceId", "reviewStatus");

-- CreateIndex
CREATE INDEX "ContentRight_workspaceId_sourcePostId_idx" ON "ContentRight"("workspaceId", "sourcePostId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRight_workspaceId_id_key" ON "ContentRight"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "StoryProject_workspaceId_sourcePostId_idx" ON "StoryProject"("workspaceId", "sourcePostId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryProject_workspaceId_id_key" ON "StoryProject"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StoryVersion_workspaceId_id_key" ON "StoryVersion"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StoryVersion_storyProjectId_version_key" ON "StoryVersion"("storyProjectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_workspaceId_id_key" ON "MediaAsset"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_workspaceId_storageKey_key" ON "MediaAsset"("workspaceId", "storageKey");

-- CreateIndex
CREATE INDEX "Video_workspaceId_status_idx" ON "Video"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Video_workspaceId_id_key" ON "Video"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_workspaceId_id_key" ON "SocialAccount"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_workspaceId_platform_externalId_key" ON "SocialAccount"("workspaceId", "platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_idempotencyKey_key" ON "Publication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Publication_status_scheduledAt_idx" ON "Publication"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Publication_workspaceId_videoId_idx" ON "Publication"("workspaceId", "videoId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_workspaceId_id_key" ON "Publication"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationAttempt_workspaceId_id_key" ON "PublicationAttempt"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationAttempt_publicationId_attemptNo_key" ON "PublicationAttempt"("publicationId", "attemptNo");

-- CreateIndex
CREATE INDEX "PublicationMetric_workspaceId_publicationId_measuredAt_idx" ON "PublicationMetric"("workspaceId", "publicationId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMetric_workspaceId_id_key" ON "PublicationMetric"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "WorkflowRun_workspaceId_entityType_entityId_idx" ON "WorkflowRun"("workspaceId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_workspaceId_id_key" ON "WorkflowRun"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_workspaceId_id_key" ON "OutboxEvent"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_occurredAt_idx" ON "AuditLog"("workspaceId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_workspaceId_id_key" ON "AuditLog"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_workspaceId_id_key" ON "IdempotencyRecord"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_workspaceId_userId_route_key_key" ON "IdempotencyRecord"("workspaceId", "userId", "route", "key");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_activeWorkspaceId_userId_fkey" FOREIGN KEY ("activeWorkspaceId", "userId") REFERENCES "WorkspaceMember"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentChannel" ADD CONSTRAINT "ContentChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceConfig" ADD CONSTRAINT "SourceConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceConfig" ADD CONSTRAINT "SourceConfig_workspaceId_channelId_fkey" FOREIGN KEY ("workspaceId", "channelId") REFERENCES "ContentChannel"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSyncRun" ADD CONSTRAINT "SourceSyncRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSyncRun" ADD CONSTRAINT "SourceSyncRun_workspaceId_sourceConfigId_fkey" FOREIGN KEY ("workspaceId", "sourceConfigId") REFERENCES "SourceConfig"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcePost" ADD CONSTRAINT "SourcePost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcePost" ADD CONSTRAINT "SourcePost_workspaceId_sourceConfigId_fkey" FOREIGN KEY ("workspaceId", "sourceConfigId") REFERENCES "SourceConfig"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcePost" ADD CONSTRAINT "SourcePost_workspaceId_channelId_fkey" FOREIGN KEY ("workspaceId", "channelId") REFERENCES "ContentChannel"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceComment" ADD CONSTRAINT "SourceComment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceComment" ADD CONSTRAINT "SourceComment_workspaceId_sourcePostId_fkey" FOREIGN KEY ("workspaceId", "sourcePostId") REFERENCES "SourcePost"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetricSnapshot" ADD CONSTRAINT "PostMetricSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetricSnapshot" ADD CONSTRAINT "PostMetricSnapshot_workspaceId_sourcePostId_fkey" FOREIGN KEY ("workspaceId", "sourcePostId") REFERENCES "SourcePost"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCandidate" ADD CONSTRAINT "ContentCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCandidate" ADD CONSTRAINT "ContentCandidate_workspaceId_sourcePostId_fkey" FOREIGN KEY ("workspaceId", "sourcePostId") REFERENCES "SourcePost"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRight" ADD CONSTRAINT "ContentRight_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRight" ADD CONSTRAINT "ContentRight_workspaceId_sourcePostId_fkey" FOREIGN KEY ("workspaceId", "sourcePostId") REFERENCES "SourcePost"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRight" ADD CONSTRAINT "ContentRight_workspaceId_evidenceAssetId_fkey" FOREIGN KEY ("workspaceId", "evidenceAssetId") REFERENCES "MediaAsset"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRight" ADD CONSTRAINT "ContentRight_workspaceId_reviewedById_fkey" FOREIGN KEY ("workspaceId", "reviewedById") REFERENCES "WorkspaceMember"("workspaceId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryProject" ADD CONSTRAINT "StoryProject_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryProject" ADD CONSTRAINT "StoryProject_workspaceId_sourcePostId_fkey" FOREIGN KEY ("workspaceId", "sourcePostId") REFERENCES "SourcePost"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryVersion" ADD CONSTRAINT "StoryVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryVersion" ADD CONSTRAINT "StoryVersion_workspaceId_storyProjectId_fkey" FOREIGN KEY ("workspaceId", "storyProjectId") REFERENCES "StoryProject"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_workspaceId_channelId_fkey" FOREIGN KEY ("workspaceId", "channelId") REFERENCES "ContentChannel"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_workspaceId_storyProjectId_fkey" FOREIGN KEY ("workspaceId", "storyProjectId") REFERENCES "StoryProject"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_workspaceId_mediaAssetId_fkey" FOREIGN KEY ("workspaceId", "mediaAssetId") REFERENCES "MediaAsset"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_workspaceId_videoId_fkey" FOREIGN KEY ("workspaceId", "videoId") REFERENCES "Video"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_workspaceId_socialAccountId_fkey" FOREIGN KEY ("workspaceId", "socialAccountId") REFERENCES "SocialAccount"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_workspaceId_publicationId_fkey" FOREIGN KEY ("workspaceId", "publicationId") REFERENCES "Publication"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMetric" ADD CONSTRAINT "PublicationMetric_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMetric" ADD CONSTRAINT "PublicationMetric_workspaceId_publicationId_fkey" FOREIGN KEY ("workspaceId", "publicationId") REFERENCES "Publication"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "WorkspaceMember"("workspaceId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "WorkspaceMember"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
