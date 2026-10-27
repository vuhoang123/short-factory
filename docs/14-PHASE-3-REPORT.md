# Phase 3 — AI Script Engine and Automated Video Production

Report date: 27 October 2026, Asia/Saigon. This delivery adds a usable production vertical slice on top of the completed Phase 0–2 workspace, rights and discovery workflow. It does not mark every item in the Phase 3 brief as complete.

## Implemented

- Eligible approved candidates can start a production run through a workspace-authorized, idempotent API mutation. The PostgreSQL transaction creates the story/run/render job/audit/outbox records together; BullMQ receives the durable outbox ID.
- Worker stages persist script generation, script validation/version persistence, TTS generation, audio alignment, subtitle generation, manifest creation, render, review submission and attempt status. A database lease with attempt fencing prevents concurrent attempts from writing and permits expired-run recovery.
- Scripts use a strict Zod schema with source references and narration type. The deterministic mock summarizes long posts, selects exact excerpts from supplied comments and records duration estimates. The optional OpenAI adapter receives only provided source material and is validated against the same grounding rules. Editors can save a new grounded version; they cannot turn fabricated text into a quoted comment.
- TTS supports a deterministic mock tone for tests, local Windows SAPI/Linux eSpeak NG speech and an optional OpenAI adapter. Audio is segmented, content-addressed, cached, and records duration, timing precision, usage and configured cost estimates. Phrase timing follows measured audio durations; word timings are explicitly approximate unless a provider supplies valid metadata through the alignment interface.
- `ClassicCaption` and `KaraokeHighlight` subtitle tracks include structured cues and SRT. Vietnamese UTF-8 text is preserved. Timing precision is persisted.
- Stylized React post/comment cards cover Reddit, Threads, Facebook and manual-source labels in light/dark themes. `RedditStory` and `SocialCommentary` manifests use deterministic frame-based card animations, selected comments, caption overlays and 1080×1920, 30 FPS H.264/AAC output.
- User-uploaded PNG/JPEG/WebP backgrounds are size-limited, Sharp-normalized to portrait WebP and marked with an explicit usage-rights attestation. Background rights and source rights/safety are rechecked in the worker. No third-party backgrounds are fetched.
- `/studio` uses authenticated candidate/channel/voice/template/background/run/video APIs. It supports script editing, segment reordering, version comparison and regeneration, audio segment preview, render status/retry, MP4 preview/download, editable Remotion composition preview, and reviewer approve/reject decisions. Review decisions are idempotent, audited, tenant-scoped, and approval rechecks source rights and safety; publishing endpoints remain blocked.
- Media bytes are served through an authenticated, workspace-scoped API route with current source rights/safety checks. Takedown scrubs story/render text, blocks runs/videos, revokes rights and queues unreferenced object deletion in the transactional outbox.
- `pnpm smoke:media` builds a real Remotion render from deterministic sample content and stores a playable MP4 with a mock test tone.

## Compatibility and architecture decisions

- The repository has local content-addressed object storage, not a Cloudflare R2 adapter. Phase 3 reuses that existing abstraction and adds safe deletion; production R2, signed remote URLs and remote upload reconciliation remain outstanding.
- Remotion's renderer and managed FFmpeg are used in the media worker. No Python runtime or MoviePy dependency was added. Windows Chrome/Edge and Linux Chromium provide the browser runtime.
- The deterministic mock TTS output is a test tone, not usable speech. Configure `TTS_PROVIDER=local` for system speech or use the optional provider adapter. The mock remains useful for credential-free smoke and contract tests.
- Current media uploads support static images only; video background ingestion, looping, random/category selection, reuse avoidance and background audio mixing are not included.
- Voice profiles and templates are code registries rather than workspace-managed database rows; script segments remain JSON inside immutable story-version snapshots rather than separate rows.
- Provider timing interfaces accept accurate word metadata, but current adapters report approximate timing. The implementation does not label estimated word timings as forced alignment.
- The Studio reorders segments with accessible up/down controls and compares saved script versions side by side. Drag-and-drop, editable animation/typography controls and a dedicated reviewer screen remain follow-up work.

## Schema and changed paths

Additive migration: `prisma/migrations/20261027000000_phase3_media/migration.sql`. It adds production runs/stages and lease data, audio/subtitle assets, render manifests/jobs and video/story references without replacing prior data.

Main implementation areas:

- `packages/media/`: script/provider contracts, alignment and subtitles, background image processing, card/composition components, render manifest, Remotion renderer and deterministic tests.
- `apps/api/src/production.*`, `apps/api/src/app.ts`, `apps/api/src/content.service.ts`: tenant-scoped production APIs, outbox enqueue, media access and takedown cleanup.
- `workers/media/`: durable outbox relay and leased, resumable production pipeline.
- `apps/web/app/(workspace)/studio/`, `apps/web/components/story-studio.tsx`, and `apps/web/app/globals.css`: connected production studio and review queue.
- `infrastructure/compose.yaml`, `infrastructure/Dockerfile`, `package.json`, `pnpm-lock.yaml`, `.env.example`, and `scripts/smoke-media.ts`: local media-worker runtime and smoke command.
- `apps/api/test/api.integration.test.ts`, `apps/api/test/app.test.ts`, `apps/api/test/production.validation.test.ts`, `packages/media/src/production.test.ts`, `packages/media/src/index.test.ts`, and `workers/media/src/outbox.test.ts`: contracts, service boundaries, media and outbox coverage.
- `README.md`, `AGENTS.md`, and `docs/07-API.md`, `docs/08-DELIVERY-PLAN.md`, `docs/10-UI-SCREENS.md`, `docs/11-LOCAL-DEVELOPMENT.md`: phase status and operating instructions.

## Local development

With Docker Compose available:

```sh
pnpm install
pnpm local:up
```

Compose starts PostgreSQL, Redis, API, web, discovery worker and media worker, then applies migrations. Configure `TTS_PROVIDER=local` for speech output; `mock` creates a test tone. Optional provider settings are `SCRIPT_PROVIDER`, `SCRIPT_MODEL`, `TTS_PROVIDER`, `TTS_MODEL`, `TTS_COST_PER_1K_CHARS` and `OPENAI_API_KEY`; `.env.example` contains placeholders only. Media worker settings include `MEDIA_QUEUE_NAME`, `MEDIA_WORKER_CONCURRENCY`, `MEDIA_RENDER_CONCURRENCY`, `MEDIA_MAX_RENDER_SECONDS`, `MEDIA_RETRY_ATTEMPTS` and `MEDIA_RETRY_DELAY_MS`.

To run workers on the host instead, use `pnpm dev:worker` and `pnpm dev:media-worker`. In Compose, these workers are already running. Produce a sample MP4 without database/provider credentials with:

```sh
pnpm smoke:media
```

The sample is written to `test-results/phase3-smoke.mp4`; local objects go under `.data/smoke-media/`.

## Verification and blockers

| Command | Result |
|---|---|
| `pnpm db:validate` | PASS — Prisma schema is valid. |
| `pnpm db:generate` | PASS — generated Prisma Client v6.19.0. |
| `pnpm check` | PASS — lint, strict TypeScript checks across 9 packages, and 62 tests across 11 files. |
| `pnpm smoke:media` | PASS — real MP4 at `test-results/phase3-smoke.mp4`, 1080×1920, 30 FPS, 32.5 seconds, H.264/AAC, 2,022,565 bytes. |
| `pnpm build` | PASS — all 9 Turbo tasks; Next.js production build includes `/studio`. |
| `pnpm db:deploy` | BLOCKED — no PostgreSQL server at `localhost:5432`; Prisma returned a schema-engine connection failure. |
| `pnpm test:integration` | BLOCKED — the runner could not connect to PostgreSQL at `localhost:5432`; Docker Desktop’s Linux engine pipe is absent. |
| `pnpm test:browser` | Not run — browser workflow requires the unavailable database-backed API. No UI screenshot is claimed without a running app. |

The Phase 3 media smoke and production build gates pass. The phase remains unverified as a whole because the additive migration, PostgreSQL workflow/tenant tests and browser workflow could not run without local PostgreSQL/Redis services.

The migration is additive and was generated from the Prisma schema; deployment must be verified against PostgreSQL with `pnpm db:deploy`. Production secrets must come from managed secret storage, not committed `.env` files.

## Phase 4 readiness

The output is review-pending and the current rights/safety gate blocks missing, expired, revoked or unsafe source material. No provider publisher, OAuth credential storage, remote posting, reconciliation or platform-specific media eligibility check was added. Reddit/Threads/Facebook discovery remains `BLOCKED_EXTERNAL`; Phase 4 should begin only with verified platform permissions and an approved publisher adapter. TikTok remains manual export/handoff by default.
