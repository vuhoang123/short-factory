# 02 — Architecture

## Style
Modular monolith API with role-specific background workers. Repo:
```
apps/web                 Next.js App Router + Tailwind/shadcn
apps/api                 NestJS REST, OpenAPI, authz, modules
apps/renderer            Remotion video templates
workers/discovery        source sync
workers/intelligence     ranking + story generation
workers/media            TTS + caption alignment + render
workers/publishing       official APIs + reconciliation
workers/analytics        metric sync
packages/database        Prisma schema/migrations/seed
packages/shared          typed contracts and Zod
packages/sources         source adapters
packages/publishers      publisher adapters
packages/workflows       transitions/outbox/job helpers
packages/media           storage/ffmpeg helpers
packages/ui              common components
infrastructure/          compose/deployment config
```
Prefer a single worker binary selecting queues by environment variable in MVP; split deployable workers later. One database; no network microservice calls between internal modules.

## Logical pipeline
`Scheduler → SourceAdapter → normalize/dedupe → rights eligibility → AI rank → candidate → script draft → TTS → subtitle alignment → render → QC → approval → per-account publication → analytics`.

## Data plane
Postgres authoritative. Redis queue/cache only. R2 for immutable blobs referenced by content-addressed keys. Store durations, checksums, mime types, licensing, dimensions. Use object versioning and temporary URL policies. External tokens stored as encrypted references (KMS/secret manager, suitable encrypted store for dev); only workers get decrypt privilege.

## Security boundaries
- Session/OIDC; workspace context derived from membership; server checks roles and resource workspace ownership.
- Deny private/cross-workspace data reads. DB constraints and consider Postgres RLS when moving SaaS scale.
- Import URLs: allowlisted schemes/hosts, redirect checks, DNS/IP SSRF protection, request size/time limits.
- Content privacy: redact personal identifiers, respect source deletion/takedown, retention and lawful rights.
- Webhooks: verify signature per provider, replay protection, store event ID; do not trust webhook status blindly.
- Audit mutations, export/delete/access to sensitive content and rights evidence.

## Deployment
Docker Compose: web, api, worker, renderer, postgres, redis, optional local S3 emulator for dev. Production: HTTPS proxy, managed Postgres/backups, monitoring, secrets, R2. Start render concurrency 1 and tune using measured CPU/codec loads.

## Observability
OpenTelemetry traces, JSON logs with `workspaceId`, `workflowRunId`, `publicationId` excluding personal content and tokens; metrics queue lag/failures/AI spending/render duration/publishing reconciliation; DLQ dashboard.
