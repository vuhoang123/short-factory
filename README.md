# Shorts Factory

A hybrid editorial MVP with workspace isolation from the first import. Phase 0–3 provide the identity, discovery, rights and media workflow. Phase 5 adds a versioned Autopilot workflow, estimated-cost controls, human review, permitted analytics snapshots and evidence-backed recommendations. The current checkout's Phase 4 publishing integration remains blocked; mock publishing is restricted to development/test.

## Start locally

Install Node.js 22.12 or later, pnpm 11.25.0 and Docker with Compose, then run from the repository root:

```sh
pnpm install
pnpm local:up
```

`local:up` creates an ignored `.env` with random local PostgreSQL and Redis credentials, builds the applications, applies migrations and starts the local stack. Do not copy the placeholder values in `.env.example` into a working `.env`.

Open [http://localhost:3000](http://localhost:3000), choose **Create account**, and create a workspace. No vendor account, provider secret or seeded password is required. Docker publishes application and database ports on the local machine only.

See [local development](docs/11-LOCAL-DEVELOPMENT.md) for worker commands and the sample-render workflow. See the [Phase 0/1 report](docs/12-PHASE-0-1-REPORT.md), [Phase 2 report](docs/13-PHASE-2-REPORT.md), [Phase 3 report](docs/14-PHASE-3-REPORT.md), and [Phase 5 report](docs/15-PHASE-5-REPORT.md) for verification results and remaining gates.

## Available now

- Password sign-in, opaque hashed sessions, workspace creation and membership roles.
- Tenant-scoped CRUD for sources and topic rules; manual imports and explicitly labeled synthetic demo discovery.
- PostgreSQL transactional outbox, BullMQ relay/scheduler, idempotent sync runs, normalized comments/metrics and duplicate counts.
- Deterministic five-factor viral scoring, safety flags, rights prechecks and explainable content candidates.
- Rights evidence, permitted destinations, commercial scope, territory, expiry, attribution and explicit review.
- Server-side rights eligibility checks, author deletion/takedown handling and audit records.
- Dashboard, channels, source controls and sync history, all-post and candidate-library views, rights review and workspace/topic settings.
- PostgreSQL migrations, Redis/BullMQ worker, immutable local object storage, typed adapter contracts and development mocks.
- `/studio` selects approved candidates, creates source-grounded scripts, edits versions, queues production, shows durable stage progress, previews completed MP4s, and downloads authorized media. Runs and media are workspace-scoped and rights-checked again before access.
- Remotion renders two deterministic vertical templates with stylized Reddit, Threads, Facebook and manual post/comment cards, approved static image backgrounds, narration audio, SRT/subtitle timelines and metadata checks. The committed smoke command renders a real sample MP4.
- Script generation has deterministic and optional OpenAI adapters. TTS has deterministic tone, local speech (SAPI/eSpeak NG), and optional OpenAI adapters. Approximate subtitle word timings are marked as approximate.
- `/autopilot` stores immutable rule versions and per-run snapshots, schedules work with timezone-aware rules, ranks eligible candidates, reserves estimated budget, supports dry run/cancel/retry/emergency stop, and routes output through the existing media worker and human QC approval.
- `/analytics` records nullable metrics with provider/scope/freshness metadata, shows history and sample-backed recommendations, and keeps experiments review-required. Missing metrics are not represented as zeros.
- A PostgreSQL outbox-backed automation worker resumes runs and analytics syncs. Test-only YouTube/Facebook publication uses the explicit mock adapter; provider publishing and live analytics remain blocked pending verified access.

Unknown, expired, revoked or unreviewed rights block production. The default mock TTS emits a clearly labeled deterministic test tone; configure local speech or a provider for usable narration. Background video processing, remote R2 storage, advanced script editing, and some preview controls remain outside the current Phase 3 slice. External source adapters, production publisher adapters, TikTok direct posting and live analytics remain `BLOCKED_EXTERNAL`; no live platform posting is shipped.

## Architecture and specifications

The implemented foundation uses pnpm/Turborepo, Next.js, NestJS, PostgreSQL/Prisma, Zod, BullMQ and Vitest/Playwright. PostgreSQL remains authoritative; Redis carries repeatable queue delivery. Local content-addressed storage is used in development. Remotion and its managed FFmpeg renderer produce media; production object storage and approved platform integrations still require deployment work.

Read the original specifications before extending affected modules:

1. [AGENTS.md](AGENTS.md): implementation standards and Ponytail usage.
2. [Product requirements](docs/01-PRD.md): MVP scope and full-product definition of done.
3. [Architecture](docs/02-ARCHITECTURE.md): services, security and deployment boundaries.
4. [Data model](docs/03-DATA-MODEL.md) and [Prisma schema](prisma/schema.prisma).
5. [Durable workflows](docs/04-WORKFLOWS.md): transitions, idempotency and recovery.
6. [Source connectors and rights](docs/05-SOURCES.md).
7. [Publishing integrations](docs/06-PUBLISHING.md).
8. [REST API contract](docs/07-API.md).
9. [Sequential delivery plan](docs/08-DELIVERY-PLAN.md).
10. [Decisions and external blockers](docs/09-DECISIONS-AND-RISKS.md), [UI requirements](docs/10-UI-SCREENS.md), [starter prompt](CODEX_START_HERE.md), [adapter contracts](contracts/) and [fixtures](examples/).

The original full-product specifications remain requirements for future work; a documented endpoint or database table is not evidence that its later-phase behavior is implemented. Never infer platform permissions or reuse rights from public visibility, and never simulate successful third-party publication in production.
