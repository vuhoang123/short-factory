# 08 — Implementation Plan for Codex

## Phase 0 — Scaffold
Create pnpm/Turborepo, Next.js app, NestJS API, shared strict types, Prisma package, Docker Compose Postgres/Redis/local object store, CI lint/typecheck/test, `.env.example` and health endpoints.
**Gate:** one-command local startup; smoke tests green; no provider credentials needed.

## Phase 1 — Identity + manual data
Implement workspace membership authz, channels, source configs, manual owned/licensed post+comment import, normalized DB records, content rights, basic dashboard and API tests.
**Gate:** workspace A cannot access or relate to B data; unknown rights block downstream publication.

## Phase 2 — Content discovery and grounded workflow
Source CRUD and access checks; approved/manual/mock adapter boundaries; PostgreSQL outbox + BullMQ relay; scheduled and manual sync; normalized posts/comments, pagination, dedupe, metric snapshots, explainable scoring, topic rules, rights/safety prechecks and candidate review.
**Discovery gate:** implemented with deterministic synthetic fixtures, manual imports, tenant-scoped APIs and retry-safe jobs. External adapters remain `BLOCKED_EXTERNAL` until their permissions and live implementations are verified.
**Remaining Phase 2 scope:** grounded script generation/versioning moved into the Phase 3 story engine; see `docs/14-PHASE-3-REPORT.md` for its deterministic and optional provider adapters.

## Phase 3 — Media
Media assets, test backgrounds, mock/provider TTS, timings, Remotion template, FFmpeg render, video preview, storage and QC.
**Status:** Phase 3 vertical slice implemented: durable production runs/stages, grounded/editable/reorderable script versions, mock/local/optional provider TTS, approximate timing metadata, static background image processing, two Remotion template IDs, authorized preview/download, media worker leases and a connected `/studio` workflow with audited video review decisions. See `docs/14-PHASE-3-REPORT.md` for limitations and verification.
**Gate:** `pnpm smoke:media` must produce a playable 9:16 MP4 with synced captions and repeatable manifest; the full repo check/build and database-backed workflow tests must pass before calling the phase complete. Features requiring platform approval stay `BLOCKED_EXTERNAL`.

## Phase 4 — Publishing
Publisher interfaces/mocks, publication tables, state machine, retries/reconciliation, YouTube and Facebook Page integration only behind enabled credentials, TikTok export; connected accounts UI.
**Status:** The current checkout still has mock publisher code only; publication scheduling is blocked. It does not contain verified OAuth, YouTube/Facebook direct publishing, or TikTok export/manual handoff. Treat this phase as incomplete even if its brief was completed elsewhere.
**Gate:** mock E2E safe retries; production accounts require real approval and permissions.

## Phase 5 — Automation/ops
Schedules, budgets, alerts, dashboard publication states, permitted analytics, takedown and retention, observability, end-to-end tests.
**Status:** Rule versions, workflow snapshots, channel scheduling, candidate ranking, budget reservations, pause/stop controls, media QC, review queue, analytics adapters/snapshots, recommendation evidence, experiments, dashboard routes and an automation worker are implemented. The synthetic manual-review slice is covered by tests. Provider connections and direct publication are not shipped.
**Gate:** operate one permitted channel with manual review; failure recovery, cost budgets and tenant isolation pass against PostgreSQL. External posting and live analytics remain `BLOCKED_EXTERNAL` until verified provider access is available.

## Phase 6 — Local export reliability

**Scope approved by the project owner on 28 October 2026:** stabilize the existing local manual-export workflow with render history, resume, cancellation, wall-clock render deadlines, PostgreSQL-backed delivery recovery and regression tests. This phase does not enable live source fetching, paid providers or social publication, and does not mark Phase 4/5 production integrations as shipped.

1. Add tenant-scoped paginated production history and explicit idempotent cancellation for queued/running/retryable runs. Completed outputs cannot be cancelled or overwritten by stale worker attempts.
2. Add `/export` history/resume, status/error display and role-authorized cancel/retry controls. A fresh browser tab can find prior runs without private source text in browser storage.
3. Isolate rendering in an owned child process; cancellation/deadline covers bundle, browser selection and encoding. Fence progress/stage writes by the active production attempt; preserve cancellation instead of misclassifying it as a rights failure.
4. Recover lost media deliveries from PostgreSQL without taking a live lease or reviving terminal/cancelled jobs. Recover the local manual-import-to-candidate delivery and queued synthetic sync deliveries. Full reclaim of a RUNNING synthetic source sync is deferred until it has a durable lease/fencing model.
5. Bound recovery/retries using durable counters, retain transactional outbox and tenant authorization, and test fault cases with isolated `_test` database fixtures and Redis queue names. Never flush/reset shared Redis or application data.

**Gate:** current lint/typecheck/unit/contract/PostgreSQL integration/build/browser checks pass; cancellation and timeout terminate actual owned render work; a missing delivered queue job recovers from the DB without duplicate outputs; history/resume and cross-workspace denial pass. Keep the baseline three-comment local MP4 review/download slice working. Record exact evidence, limitations and commands in `docs/17-PHASE-6-REPORT.md` before marking this scope complete.

**Status:** local scope complete and verified on 28 October 2026: 161 unit/contract tests, 64 PostgreSQL integration tests, 8 browser tests, lint/root+13-package typecheck/build and the actual cancellation/timeout/retry/download smoke pass. See `docs/17-PHASE-6-REPORT.md` and the updated `docs/audits/PRE_PHASE_6_AUDIT.md` for exact evidence and deferred scope. Remote CI, Docker rebuild and production load/soak remain unverified; external approvals remain `BLOCKED_EXTERNAL`.

## Future
Approved Threads/Reddit source adapters, expanded templates, provider-backed analytics experiments, OAuth multi-tenant audit, billing, tenant quotas, RLS and scaling.

## Tests (must implement)
Unit: score rules, rights gate, state transitions, Zod, scheduling TZ.
Integration: SQL tenant guards, transactional outbox, dedupe, retry + DLQ.
Contract: SourceAdapter/PublisherAdapter mocks, platform capability mismatch.
E2E: synthetic/manual source → script → local/mock TTS → video → quality report → human approval → mock publication → nullable analytics; unknown rights and unverified provider access block.

## Every phase report
- Paths added/changed; commands and migrations.
- Tests executed and results.
- Features implemented vs external blockers.
- Screenshot(s) if front-end screens added.
- Security/privacy considerations and outstanding issues.
