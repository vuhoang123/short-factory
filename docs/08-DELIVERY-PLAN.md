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
**Remaining Phase 2 scope:** grounded script generation/versioning and its AI-provider adapter are not included in the Content Discovery Engine delivery. See `docs/13-PHASE-2-REPORT.md`.

## Phase 3 — Media
Media assets, test backgrounds, mock/provider TTS, timings, Remotion template, FFmpeg render, video preview, storage and QC.
**Gate:** fixture produces playable 9:16 video with synced captions, re-render remains reproducible.

## Phase 4 — Publishing
Publisher interfaces/mocks, publication tables, state machine, retries/reconciliation, YouTube and Facebook Page integration only behind enabled credentials, TikTok export; connected accounts UI.
**Gate:** mock E2E safe retries; production accounts require real approval and permissions.

## Phase 5 — Automation/ops
Schedules, budgets, alerts, dashboard publication states, permitted analytics, takedown and retention, observability, end-to-end tests.
**Gate:** can operate one channel with manual review; failure recovery and cost budgets tested.

## Future
Approved Threads/Reddit source adapters, expanded templates, analytics experiments, OAuth multi-tenant audit, billing, tenant quotas, RLS and scaling.

## Tests (must implement)
Unit: score rules, rights gate, state transitions, Zod, scheduling TZ.
Integration: SQL tenant guards, transactional outbox, dedupe, retry + DLQ.
Contract: SourceAdapter/PublisherAdapter mocks, platform capability mismatch.
E2E: manual source → script → TTS mock → video → approve → mock publish for two accounts; unknown rights blocks.

## Every phase report
- Paths added/changed; commands and migrations.
- Tests executed and results.
- Features implemented vs external blockers.
- Screenshot(s) if front-end screens added.
- Security/privacy considerations and outstanding issues.
