# Phase 5 — AI Content Autopilot, Analytics & Optimization

## Delivery status

The local synthetic/manual-review workflow is implemented and verified. Automation configuration is versioned; each run stores an immutable rule/control snapshot. PostgreSQL transactions create runs, budget reservations and outbox events atomically. Resumable workers recheck tenant membership, rights, budget and stop controls at workflow boundaries. The existing media pipeline creates and validates content, then waits for explicit reviewer approval.

Analytics stores nullable observations with provider, metric definition, scope, period, freshness and synthetic-data metadata. Trend/cohort summaries keep incompatible scopes apart. Recommendations cite their samples and evidence; experiments require human approval and distinct eligible stories. `/autopilot` and `/analytics` expose controls, run/QC status, approval, budgets, data availability, history and evidence.

**The Phase 4 publishing gate is still incomplete in this checkout.** `/publications` remains blocked and there are no verified production OAuth/publisher adapters here. The tested Autopilot flow used only explicit development mock accounts. Phase 5 does not claim live publishing or provider analytics as shipped.

## Changed files

- `prisma/schema.prisma` and `prisma/migrations/20261028000000_phase5_autopilot/migration.sql`: rule versions, workflow snapshots/steps, reservations, usage, analytics syncs/recommendations/experiments and tenant-scoped relations.
- `packages/automation/`: validated rule defaults, deterministic candidate/comment selection, rights/QC and automatic-publish gates, time-zone schedule preview, budget checks and experiment helpers.
- `packages/analytics/`: nullable metric contracts, manual/mock/official-provider adapters, freshness, scope-aware summaries, evidence-backed recommendations and sample uncertainty.
- `packages/workflows/`: run creation/cancellation, budget reservations, durable workflow orchestration, discovery/media handoff, quality reports, mock-only publication and analytics sync/recommendation jobs.
- `apps/api/src/automation.service.ts`, `analytics.service.ts`, `phase5.common.ts`, `phase5.validation.ts`, and `app.ts`: tenant-authorized, Zod-validated, idempotent APIs for rules, controls, runs, budgets, QC approvals, analytics, recommendations and experiments. `production.service.ts` also enforces the quality-report gate on video approval.
- `workers/automation/` and `workers/media/src/pipeline.ts`: outbox/queue relay, scheduler/recovery and worker-side pause, stop, reservation and cancellation checks.
- `apps/web/app/(workspace)/autopilot/`, `apps/web/app/(workspace)/analytics/`, their dashboard components, `apps/web/test/phase5-ui.spec.ts`, and `apps/web/playwright-phase5.config.ts`.
- `scripts/smoke-autopilot.ts`, root/package manifests, `pnpm-lock.yaml`, `.env.example`, `infrastructure/Dockerfile`, and `infrastructure/compose.yaml`.
- `README.md`, `AGENTS.md`, `docs/07-API.md`, `docs/08-DELIVERY-PLAN.md`, `docs/10-UI-SCREENS.md`, and `docs/11-LOCAL-DEVELOPMENT.md`.

## Verification

- `pnpm db:validate` — passed.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed across all 13 workspace packages.
- `pnpm test` — 92 tests passed.
- `pnpm test:integration` — 59 PostgreSQL tests passed across API, Phase 5, discovery, workflow and database constraints. After adding the running-child cancellation case, the focused Phase 5 integration file also passed all 6 tests.
- `pnpm build` — all 13 workspace package builds passed, including the Next.js production build for `/autopilot` and `/analytics`.
- `pnpm --filter @shorts-factory/web exec playwright test --config playwright-phase5.config.ts` — 2 browser tests passed. Screenshots: `apps/web/test-results/phase5-ui/autopilot-fixture.png` and `apps/web/test-results/phase5-ui/analytics-fixture.png`.
- `pnpm smoke:autopilot` against `shorts_factory_test` — passed; rendered a playable `test-results/phase5-smoke.mp4`, created two synthetic mock publications and two synthetic analytics snapshots. QC correctly returned `NEEDS_REVIEW`; the fixture records an explicit reviewer approval. Two observations were insufficient for a performance recommendation.
- `git diff --check` — passed.

The browser suite initially exposed an invalid experiment fixture; the fixture was corrected to match the API contract, then both browser tests passed. The production build reports a non-fatal Turbo warning for TypeScript-only packages that emit no build files.

## Known blockers and limits

- The current checkout lacks Phase 4 production publishing. Mock YouTube/Facebook publishing is restricted to development/test. TikTok API posting is not enabled; any direct post remains `BLOCKED_EXTERNAL` pending eligibility, permissions and creator approval.
- Live analytics is disabled by default. Provider refresh requires verified adapters, scopes and secret references; no real provider metrics were fetched in these tests.
- The end-to-end QC result is `NEEDS_REVIEW` because local speech/subtitle timing is approximate and silence checks are not fully measured. Mock test-tone audio cannot satisfy automatic-publish QC. Full-auto also requires an authorized provider capability and a `PASS` quality report.
- Source discovery in the smoke is synthetic. No scraper or unapproved external-source adapter was added.
- Remote takedown reconciliation and automated retention schedules remain operational work; the existing local takedown path does not call a platform removal API.
- Run budgets are configured USD estimates/reservations. Provider billed cost stays `null` when no billing metric is available.

## Local commands

After configuring `.env` and generating the Prisma client on a clean checkout:

```sh
pnpm db:deploy
pnpm check
pnpm test:integration
pnpm build
pnpm test:browser
```

The database-backed media/Autopilot smoke requires `TEST_DATABASE_URL` pointed at a dedicated migrated database whose name ends in `_test`, plus a local speech voice and Chrome/Edge/Chromium:

```sh
pnpm smoke:autopilot
```
