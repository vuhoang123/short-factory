# AI Content Studio — Milestone 1 delivery

Date: **2 November 2026**, Asia/Saigon. Baseline: `500d2bf`. Scope: audit, source-level open-source evaluation, six planning documents first, then core product UX only. No database migration, dependency addition or upstream code incorporation.

Status: **Milestone 1 complete for the local scope below**. The application is started with the existing local launcher; open `http://127.0.0.1:3000/studio`. Existing authentication and user data are preserved.

## Delivered behavior

Primary navigation is Overview, Discover, Studio, Publish and Analytics. Settings is separate; the previous Channels, Sources, Library, Reviews, Autopilot, Export and Guide routes remain under tools. Existing workspace membership, session fencing and role checks remain authoritative.

| Area | Result |
|---|---|
| Overview | Workspace pipeline counters, recent durable runs, review/failure links, publishing availability and existing performance summary with missing metrics preserved |
| Discover | Saved-source cards, post/comment previews, score/rights context, keyword/platform/topic/date/score/likes filters, bounded pagination and selection |
| Content detail | Reused source body, comments, evidence, rights/score blockers and explicit rights/candidate review; native modal focus trapping, Escape and focus restoration |
| Bulk work | Up to 12 selected items open an editing queue; candidate approval requires already approved current rights, eligibility and explicit confirmation; each result/error is shown |
| Studio | Exact selected source and existing run/video deep links, optional source/advanced settings, comments/voice/template/caption/background controls, script-only draft, editor/version comparison, audio preview, explicit render/rerender, actual MP4 preview and output review/download |
| Job UX | Serial abortable polling, terminal cancellation, explicit cancel confirmation and existing administrator retry; unchanged durable worker/outbox/recovery |
| Publish | Read-only stored account status and approved MP4 handoff, clearly blocked live connections/scheduling; no OAuth or posting call |
| Analytics | Existing trends, nullable metrics, evidence, recommendations and experiments preserved |

Studio blocks rendering while a script has unsaved changes. Rendering uses the selected voice/speaking rate and current visual controls; restoring an existing run hydrates its saved settings. Opening an output in the review list navigates to that output's own source context. Source selection objects are memoized so comment-selection effects cannot form a state-update loop.

## Before / after

Before: Library import → separate Reviews → candidate table → manually select a source again in Studio → generate script/audio/video together → scroll back to edit → rerender.

After: Discover → inspect and review the source in context → open the exact source in Studio → select comments and create a script draft → edit/save → explicitly create MP4 → preview/review/download. Multiple source selections open a bounded editorial queue. For new Facebook/Threads material, Studio → Nhập bài mới embeds the existing local import/export workflow; `/export` remains compatible.

The baseline audit contains annotated descriptions of every previous screen. New screenshots use synthetic fixtures, never private user posts:

- [Overview](../screenshots/milestone-1/dashboard-desktop.png)
- [Discover desktop](../screenshots/milestone-1/discover-desktop.png) and [mobile](../screenshots/milestone-1/discover-mobile.png)
- [Studio landing](../screenshots/milestone-1/studio-desktop.png) and [script editor](../screenshots/milestone-1/studio-editor-desktop.png)
- [Publish handoff](../screenshots/milestone-1/publish-desktop.png)

## Backend and preserved guarantees

New `StudioService` is a read projection over existing SourcePost, ContentCandidate, StoryProject, ProductionRun, Video and Publication rows. Source bodies are limited in lists; the detail shows the complete post and up to 100 comments. Every query derives the workspace from authenticated membership; foreign detail IDs/cursors are rejected. Query validation disallows client tenant selectors and bounds result size. No raw source payload is returned.

`draftOnly: true` adds SCRIPT_ONLY to the existing production input. The worker generates and validates a source-grounded immutable version, commits SCRIPT_READY and exits before speech/rendering. Omitting the flag preserves existing generation and idempotency input. `POST /stories/:id/render` can create the first MP4 from a saved draft; current rights, safety, membership and version consistency are checked before the transaction commits a run/render job/outbox. Workers still recheck permissions and lease ownership. The default renderer implements a small typed VideoRenderProvider boundary without gaining authority over jobs or retries.

Preserved: source adapters and dedupe; stored threshold policy; manual import and privacy normalization; human rights/output review; exact comment grounding; two existing Remotion templates; static-image rights attestations; local speech adapters; private media access; durable attempts/outbox/cancel/deadline/recovery; existing automation budgets and analytics. No existing user post, approval or score was modified for tests. Tests use synthetic records and a dedicated `_test` database; smoke queues and storage are uniquely namespaced. No shared Redis flush/reset was used.

## Verification

| Check | Result |
|---|---|
| Unit/contract/workflow tests | **171 passed**, 29 files |
| PostgreSQL integration | **65 passed**, 7 files |
| Chromium UI suite | **24 passed**, including legacy routes, new product journey, bulk confirmation, roles, mobile, session races and polling stability |
| Strict TypeScript / production build | **13/13 build tasks passed**, final forced rebuild with zero cache hits, including Next production compilation and strict module typechecks |
| ESLint | Passed; ignored `.data` research checkouts excluded |
| Real local render/recovery smoke | **PASS**, details below |

The five product browser tests also passed again after the final layout/restoration checks, including mobile Overview and restoration of selected comments and speaking rate from an existing output.

The extended `smoke:phase6` ran real Nest, discovery/media workers, PostgreSQL, Redis/BullMQ and Remotion/Chromium. It verified queued/running cancellation, timeout, explicit recovery on attempt 2, script draft without audio/video, saved version, first render from story, idempotent replay, human approval and authenticated MP4 download. Three synthetic comments, five history runs, **2,876,015-byte MP4**; elapsed **295,697 ms**. Cancellation observed in 2,582 ms; the intentionally short timeout completed in 4,754 ms. Audio was an explicitly labeled **mock test tone**, not a narration-quality test. No platform publishing was called. Reproducible evidence: ignored `test-results/phase6-smoke.json`, `phase6-smoke.mp4`, and `milestone1-*.log`.

PowerShell commands from repository root:

```powershell
pnpm local:export
node node_modules/vitest/vitest.mjs run
node node_modules/eslint/bin/eslint.js .
node --env-file=.env --import tsx scripts/test-integration.ts
pnpm --filter @shorts-factory/web exec playwright test --config playwright-ui.config.ts
node node_modules/turbo/bin/turbo run build --concurrency=1
node --env-file=.env --import tsx scripts/smoke-phase6.ts
```

Stop the development web server before a production build in the same checkout. Integration/smoke commands require configured local PostgreSQL/Redis and a migrated dedicated test database. The smoke deliberately uses test voices and isolated queues; do not run it against production.

## Changed files

| Responsibility | Files |
|---|---|
| Audit, IA, workflows, research, architecture, roadmap | `docs/product/{PRODUCT_UX_AUDIT,NEW_INFORMATION_ARCHITECTURE,USER_WORKFLOWS,IMPLEMENTATION_ROADMAP,MILESTONE_1_REPORT}.md`; `docs/research/OPEN_SOURCE_MODULE_EVALUATION.md`; `docs/architecture/TARGET_ARCHITECTURE.md` |
| Product API and production | `apps/api/src/{app,studio.service,studio.lifecycle,production.service,production.validation}.ts`; `packages/media/src/{contracts,render}.ts`; `workers/media/src/pipeline.ts` |
| Product views and navigation | `apps/web/app/(workspace)/{dashboard,discover,studio,publish,guide}/page.tsx`; `apps/web/app/globals.css`; `apps/web/components/{app-shell,product-overview,discover,content-detail,studio-workbench,story-studio,publish-handoff,local-export,workspace-page}.tsx`; `apps/web/lib/studio.ts` |
| Verification | `apps/api/test/{api.integration,studio.lifecycle,production.validation}.test.ts`; `apps/web/lib/studio.test.ts`; `apps/web/test/{product-studio,ui-stability}.spec.ts`; `apps/web/test/fixtures/workspace.ts`; `apps/web/playwright-ui.config.ts`; `scripts/smoke-phase6.ts`; `eslint.config.mjs`; six PNGs under `docs/screenshots/milestone-1/` |
| Operating documentation | `README.md`; `docs/{07-API,16-LOCAL-EXPORT,17-PHASE-6-REPORT}.md`; `docs/audits/PRE_PHASE_6_AUDIT.md` |

## Open-source decisions and later work

All four repositories were inspected at pinned commits, including actual provider/composer/worker/media/voice sources and LICENSE files. The [module matrix](../research/OPEN_SOURCE_MODULE_EVALUATION.md) records existing equivalents, reuse, complexity, maintenance risk, dependencies and license decisions.

- **Postiz / Postmill:** reference UX and provider capability patterns only. No AGPL code reuse or extracted service is authorized without review of the exact integration and a compliance plan; service separation does not establish an exemption.
- **Short Video Maker:** later evaluate a small MIT alignment/scene adapter. Its inspected defaults use English Kokoro voices and `medium.en`; Vietnamese is not established by those defaults.
- **ShortGPT:** reference its Vietnamese voice mapping and caption/step decomposition. Keep our durable job engine and source-grounding contract; do not transplant TinyDB/Python orchestration or unverified service endpoints.

Deferred: live source ingestion, OAuth, social composer/calendar, real scheduling/posting/reconciliation, approved video backgrounds/mixing, forced alignment/voice-quality improvements, R2/production storage and production load/restore testing. These are later milestones; external capabilities remain BLOCKED_EXTERNAL. The local PNG text preview is approximate and labeled unrendered; only encoded output is offered as MP4. Current engagement filtering uses stored observations, not a live refresh; pipeline counters are overlapping entity totals. Full-post list performance at production scale has not been load-tested.

## Owner actions

For this milestone: start local services, sign in, choose/create a workspace and channel, supply permitted text/comments, review rights and video output. No new paid provider credential or platform approval is required. Facebook/Threads URLs are provenance; the user must supply the content. Existing below-threshold candidates remain blocked under their recorded policy.

Before later integrations: choose the licensing/distribution model, review any exact AGPL reuse proposal, confirm Remotion/model/media terms, obtain scoped platform eligibility/consent/permissions, and configure encrypted secrets and private storage through appropriate secret management. Do not send secrets in chat. No milestone beyond Milestone 1 was started.
