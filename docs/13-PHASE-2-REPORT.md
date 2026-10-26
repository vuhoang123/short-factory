# 13 — Phase 2 Content Discovery Engine report

Report date: 27 October 2026, Asia/Saigon. This report covers the requested Phase 2 Content Discovery Engine slice. It does not mark grounded script generation or the full product definition of done as complete.

## Delivered

- Workspace-scoped source CRUD, access checks, sync histories, enable/disable, channel association, keywords, hashtags, topics, language and configurable frequency. Sources with imported content cannot be hard-deleted; disable them to preserve provenance.
- Manual-import and deterministic synthetic-only adapters. Reddit, Threads and Facebook report `NOT_CONFIGURED` or `ACCESS_NOT_APPROVED`; there is no scraper or unverified live network client. Demo fixtures are disabled in production.
- Transactional PostgreSQL sync-run + outbox writes; BullMQ relay uses the durable outbox event ID, configurable concurrency/rate limits, exponential retry and retained failed jobs. A scheduler locks due demo sources, and partial pagination resumes from its saved cursor.
- Normalized posts, comments and metric snapshots; workspace/platform ID and content-hash dedupe; duplicate counts; configurable comment/page/retry settings; structured logs contain IDs and error codes, not source text or secrets.
- Deterministic `heuristic-v1` score factors: engagement velocity 20%, hook/curiosity 25%, comment quality 25%, topic relevance 15%, short-video suitability 15%. Missing metrics are excluded and remaining weights are normalized. Scores, factor details and reasoning are stored; channel and topic-rule thresholds are applied.
- Rights and safety holds before candidate review. Unknown rights remain pending; sensitive email/phone/address patterns are redacted and flagged. Candidate approval requires reviewed commercial/platform rights, a passing score and no unresolved safety flags. Nothing is scheduled or published by this phase.
- UI for source setup/access/sync history, all-post import, candidate filters and score breakdown, candidate review, topic rules and channel score thresholds.

## Schema and files

The additive migrations preserve existing rows:

- `prisma/migrations/20261026010000_discovery_engine/migration.sql`
- `prisma/migrations/20261026020000_discovery_counts/migration.sql`

Implementation spans `apps/api/src/` source and candidate routes/services, `workers/discovery/` worker/relay/scheduler/pipeline, `packages/sources/` adapters/scoring, `packages/shared/` redaction, `contracts/source-adapter.ts`, `prisma/schema.prisma`, `apps/web/` discovery/settings views, and `infrastructure/` Compose/Docker support. Unit/API/worker tests were added under `packages/sources/`, `apps/api/test/` and `workers/discovery/src/`.

Project documentation and run instructions are updated in `README.md`, `docs/05-SOURCES.md`, `docs/07-API.md`, `docs/08-DELIVERY-PLAN.md`, `docs/10-UI-SCREENS.md`, `docs/11-LOCAL-DEVELOPMENT.md`, `.env.example`, and this report.

## Environment and commands

Required runtime connections are `DATABASE_URL` and `REDIS_URL`; local Compose supplies them. Optional worker settings are `DISCOVERY_QUEUE_NAME`, `DISCOVERY_WORKER_CONCURRENCY`, `DISCOVERY_RATE_LIMIT_MAX`, `DISCOVERY_RATE_LIMIT_WINDOW_MS`, `DISCOVERY_RELAY_INTERVAL_MS`, `DISCOVERY_SCHEDULER_INTERVAL_MS`, `DISCOVERY_BATCH_SIZE`, `DISCOVERY_PAGE_SIZE`, `DISCOVERY_MAX_PAGES`, `DISCOVERY_COMMENT_LIMIT`, `DISCOVERY_RETRY_ATTEMPTS`, `DISCOVERY_RETRY_DELAY_MS` and `DISCOVERY_PAGE_DELAY_MS`. Defaults are in the worker config and `.env.example`.

```sh
pnpm install
pnpm local:up
pnpm dev:worker       # optional when running the API/web on the host; Compose already runs the worker
pnpm db:validate
pnpm check
pnpm test:integration # requires PostgreSQL and Redis; uses a dedicated *_test database
pnpm build
pnpm test:browser
```

Provider variable names are documented as inert placeholders in `.env.example`. Setting credentials/approval flags alone will still report `NOT_CONFIGURED` until a live adapter is separately implemented and verified.

## Verification

| Command | Result |
|---|---|
| `pnpm db:validate` and migration deployment | PASS — schema valid; Compose migration reported no pending migrations. |
| `pnpm check` | PASS — lint, strict TypeScript checks across 8 packages, 8 unit-test files / 53 tests. |
| `pnpm test:integration` | PASS — 3 test files / 48 tests, including PostgreSQL/Redis worker flow. |
| `pnpm build` | PASS — all 8 Turbo tasks and optimized Next.js production build. |
| `pnpm local:up` and health checks | PASS — PostgreSQL, Redis, API, web and discovery worker running; API and web health endpoints returned HTTP 200; worker emitted `worker_started`. |
| `pnpm test:browser` and screenshots | PASS — 2/2 Playwright tests, including tenant/editorial flow and mobile overflow check. Captured `docs/screenshots/dashboard.png` and `docs/screenshots/mobile-dashboard.png`. |

## Blockers and limits

- No approved external provider credentials or live API adapters were available. Real Reddit, Threads and Facebook discovery remains `BLOCKED_EXTERNAL`; no unauthorized scraping is used.
- The repository has no AI-provider abstraction for scoring. `heuristic-v1` is the deterministic fallback; it is not an AI evaluation or a platform virality guarantee.
- This is the discovery slice of Phase 2. Script generation grounded to comments/story versions remains unimplemented; no Phase 3 video, rendering or publishing work was started.
- BullMQ retains failed jobs for inspection and retries are tested. A separate dead-letter queue/operations UI, production monitoring, distributed provider-specific quotas and live adapter approval/reconciliation remain future work.
- Human rights and safety review remains mandatory. A public source URL or a synthetic demo score does not grant content reuse rights.
