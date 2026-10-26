# 03 — Database Design

`prisma/schema.prisma` provides an implementable starting model, not all long-term entities. Run Prisma validation before migrations. Keep migration history committed.

## Entity families
- Identity: `Workspace`, `User`, `WorkspaceMember`, `ContentChannel`, `SocialAccount`.
- Discovery: `SourceConfig`, `SourceSyncRun`, `SourcePost`, `SourceComment`, `PostMetricSnapshot`, `ContentCandidate`.
- Editorial: `StoryProject`, `StoryVersion`, `StorySegment`, `ContentRight`, `ContentReview`.
- Media/Publishing: `MediaAsset`, `Video`, `ProductionRun`, `Publication`, `PublicationAttempt`, `PublicationMetric`.
- Ops: `WorkflowRun`, `OutboxEvent`, `AuditLog`.

## Important relationships & constraints
- Workspace is parent of all tenant-owned rows; every tenant query includes workspace predicate.
- Unique source post `(workspaceId, platform, externalPostId)` and comment `(sourcePostId, externalId)`.
- One production can generate multiple video versions; multiple publication accounts per video.
- Publication has stable `idempotencyKey` and `remotePostId` set as soon as known; store upload session/reconciliation metadata in attempts.
- `ContentRight` stores basis, evidence, explicit commercial/use scope, expiry, attribution. Missing/expired rights block auto publish.
- Use immutable story versions and render manifests to reproduce files; track asset provenance and checksum.
- Use append-only `OutboxEvent` when transitioning states atomically; relay to BullMQ.

## Schema hardening tasks
1. Ensure FK ownership across tenant tables via composite FK or transactional consistency guard; explicit tests of cross-workspace links.
2. Index `Publication(status, scheduledAt)`, `SourceConfig(nextSyncAt)`, and workflow/asset lookups.
3. Retention cleanup of raw posts, comments, tokens and temporary assets by source contract and creator deletions.
4. Use JSON only for evolving provider payload/config; promote frequently filtered fields into scalar columns.
5. Partition event/metrics tables only after volume justifies it.
