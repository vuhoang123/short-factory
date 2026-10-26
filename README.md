# Shorts Factory

A hybrid editorial MVP with workspace isolation from the first import. Phase 0/1 provide the foundation and manual editorial workflow. The Phase 2 Content Discovery Engine adds synthetic demo discovery, the durable outbox/BullMQ path, explainable scoring, candidate review and source management. Video generation and publishing remain in later phases.

## Start locally

Install Node.js 22.12 or later, pnpm 11.25.0 and Docker with Compose, then run from the repository root:

```sh
pnpm install
pnpm local:up
```

`local:up` creates an ignored `.env` with random local PostgreSQL and Redis credentials, builds the applications, applies migrations and starts the local stack. Do not copy the placeholder values in `.env.example` into a working `.env`.

Open [http://localhost:3000](http://localhost:3000), choose **Create account**, and create a workspace. No vendor account, provider secret or seeded password is required. Docker publishes application and database ports on the local machine only.

See [local development](docs/11-LOCAL-DEVELOPMENT.md) for host development, worker commands, permissions and troubleshooting. See the [Phase 0/1 report](docs/12-PHASE-0-1-REPORT.md) and the [Phase 2 discovery report](docs/13-PHASE-2-REPORT.md) for verification results and remaining gates.

## Available now

- Password sign-in, opaque hashed sessions, workspace creation and membership roles.
- Tenant-scoped CRUD for sources and topic rules; manual imports and explicitly labeled synthetic demo discovery.
- PostgreSQL transactional outbox, BullMQ relay/scheduler, idempotent sync runs, normalized comments/metrics and duplicate counts.
- Deterministic five-factor viral scoring, safety flags, rights prechecks and explainable content candidates.
- Rights evidence, permitted destinations, commercial scope, territory, expiry, attribution and explicit review.
- Server-side rights eligibility checks, author deletion/takedown handling and audit records.
- Dashboard, channels, source controls and sync history, all-post and candidate-library views, rights review and workspace/topic settings.
- PostgreSQL migrations, Redis/BullMQ worker, immutable local object storage, typed adapter contracts and development mocks.

Unknown, expired, revoked or unreviewed rights block downstream use. External source adapters report `NOT_CONFIGURED` or `ACCESS_NOT_APPROVED` and remain `BLOCKED_EXTERNAL` until verified official API/licensed integrations exist. Scoring uses a deterministic heuristic because this codebase has no AI provider abstraction. No script generation, video rendering, external publishing or TikTok export feature is shipped here.

## Architecture and specifications

The implemented foundation uses pnpm/Turborepo, Next.js, NestJS, PostgreSQL/Prisma, Zod, BullMQ and Vitest/Playwright. PostgreSQL remains authoritative; Redis carries repeatable queue delivery. Local content-addressed object storage is available for development. Remotion, FFmpeg and production object storage belong to the later media phase.

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
