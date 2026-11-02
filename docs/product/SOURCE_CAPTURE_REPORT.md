# Original post/comment screenshots — local delivery report

Current-browser follow-up: [CURRENT_BROWSER_CAPTURE_REPORT.md](CURRENT_BROWSER_CAPTURE_REPORT.md) supersedes the default dedicated-window UX below. The source-image renderer remains unchanged; Chrome/Edge users can reuse their existing login through an explicitly installed extension.

Date: 2026-11-02. User correction: videos must show actual source screenshots rather than reconstructed text cards. User selected a dedicated local login browser and additionally requested open-source research. The local flow is implemented and verified with owned synthetic content. A real authenticated Facebook/Threads account remains untested.

## Delivered behavior

Studio import now starts with paste link → open dedicated browser → user logs in/expands the source → request capture → review original/masked images → declare rights → approve source → generate video → review/download MP4. Manual text import is explicitly labeled as text-card output.

The adapter interoperates with the existing local `ai-comment` checkout; its application code is not copied or bundled. An isolated Python/Chromium setup records engine file hashes, checked at startup. Browser profiles are scoped by authenticated workspace **and user**. No normal Chrome profile, password form payload or cookie extraction is used. Production capture remains disabled.

PostgreSQL `WorkflowRun` and transactional outbox own capture status. Claims use version/lease fences, bounded attempts and a deadline. Cancellation fences persistence immediately and requests private-service cancellation/cleanup. Recovery handles missing delivery/expired leases. The bridge caches completed snapshots per job and serializes duplicate waiters so recovery does not silently capture newer content. Private snapshot/result cleanup is delivered through outbox and recovered after lost queue delivery.

Each screenshot asset records sourceRef, body hash, capture ID, variant, dimensions and checksum. The server derives frozen production bindings; clients cannot inject asset IDs. Missing, ambiguous, foreign or incorrectly masked bindings block rendering before TTS. Equal masked pixels from different sources receive distinct provenance metadata without altering image pixels. Workspace authorization and takedown apply to source image access.

Original-image rendering preserves aspect ratio and source pixels. Long images pan at a readable width; consecutive narration sentences using one image share a continuous shot, including gaps. Hook/outro retain source images. There is no reconstructed-card fallback when original screenshots are required. PNGs are materialized in the same owned temporary render directory as WAVs and cleaned with the renderer lifecycle.

Existing automatic comment selection chooses 5–10 based on duration, using observed reactions. Capture ranking disables the engine's low-reaction readability heuristic in its isolated process. “Top” means among loaded/scanned comments; unknown reactions stay unknown. Existing VieNeu/custom voice, sentence excerpts, duration fitting and Vietnamese forced alignment are retained.

## Verification

| Command / check | Result |
|---|---|
| `pnpm exec vitest run` | **200 passed**, 35 files |
| `pnpm test:integration` | **72 passed**, 8 files, dedicated PostgreSQL `_test` DB and isolated queues |
| `pnpm test:ui` | **28 passed**, Chromium; includes capture→reload→image preview→rights declaration and existing route/state/polling checks |
| `pnpm lint`, root/API/web/discovery/media TypeScript checks | Passed |
| `pnpm exec turbo run build --force` | **13/13 successful**, no cached tasks |
| Capture Python `scripts/test-local-capture.py` | **3 passed**: duplicate-waiter checkpoint reuse, cancellation, profile/path isolation; the duplicate-waiter test failed before its fix |
| Capture Python `scripts/smoke-source-capture.py` | Real browser engine, owned DOM: post + 5 comments, **12 original/masked PNGs**, restored viewport; all external requests blocked |
| `pnpm smoke:source-video` | **Passed fresh end-to-end** through API, DB, outbox, workers, actual VieNeu/alignment and Remotion; capture transport uses the actual owned DOM screenshots as a fixture |
| Stored-job retry | Actual `ProductionService.retryRun` → outbox → media pipeline completed at attempt 2, reusing frozen screenshots/audio/alignment |
| `git diff --check` | Passed |
| Restarted local stack | Web/API/VieNeu/capture health all HTTP 200; unauthenticated private capture-open request rejected HTTP 401 |

Fresh video: `test-results/source-video/original-25s.mp4`, **25.003 s, 1080×1920, 30 fps, H.264/AAC, 1,621,291 bytes**, 5 comments, 95 aligned words. Measured narration was 24.780 s before fitting; tempo factor 0.991. Evidence: `test-results/source-video/evidence-25.json`; matching SRT is in the same directory. No paid API or publishing call was made.

The initial 40-second fixture attempt correctly failed `DURATION_TARGET_UNREACHABLE` because the short source could not meet that duration within the existing 0.8–1.25 tempo bounds. One subsequent render child exited unexpectedly (`MEDIA_RENDER_PROCESS_FAILED`); the durable retry succeeded, and a fresh complete 25-second run also passed. The root cause of that one process exit is unconfirmed. Local launcher defaults to one render page to reduce peak resource use.

Two existing test assumptions were corrected: cancellation now selects the intended source's queued run, and the isolated recovery test consumer counts/mutates only its own fixture event rather than other stored smoke events. No database reset or Redis flush was used.

## Files changed for this follow-up

- API: `apps/api/src/{app,content.service,production.service}.ts`; capture integration coverage plus the cancellation fixture in `apps/api/test/`.
- UI: `apps/web/components/{source-capture,local-export,story-studio}.tsx`, `apps/web/lib/local-export.ts`, `apps/web/app/globals.css`, `apps/web/test/local-export-ui.spec.ts`.
- Capture adapter/worker: `packages/sources/src/local-capture.ts` and tests/export; `workers/discovery/src/{local-capture,pipeline,outbox,recovery,main}.ts`, worker package dependency and workspace lockfile.
- Renderer: `packages/media/src/{contracts,source-images,manifest,composition,background,render-child,index}` and screenshot/render-child tests; `workers/media/src/pipeline.ts`; recovery integration fixture.
- Runtime/evidence: capture setup/server/requirements, capture Python tests/smoke, `scripts/smoke-milestone2.mjs` source-image option, guarded test-only replay script, local launcher, package scripts and `.env.example`.
- Specifications: AGENTS owner-instruction record; README, API/source/local guides, pre-audit and roadmap links; [research decisions](../research/VIDEO_READER_REFERENCES.md); owned fixture `examples/source-capture/`.

## Run locally and remaining limits

Setup on another machine: configure PostgreSQL/Redis, `pnpm local:tts:setup`, `pnpm local:capture:setup`, then `pnpm local:export`. The current machine already has both isolated environments installed. Set `LOCAL_CAPTURE_ENGINE_PATH` when the engine is not a sibling checkout; `LOCAL_CAPTURE_ENABLED=0` disables it explicitly.

Real account/login, group permissions and changing platform DOM still need a user-assisted live check. Missing/inaccessible content is an error, not a successful import. Anonymization covers identified header names/avatars; it does not promise removal of names in body text or embedded images. Re-capturing an already stored source does not overwrite its reviewed content/rights. Four active profile scopes are supported per bridge process; restart after closing profiles if that bound is reached.

No LICENSE was found in the local engine checkout: redistribution/bundling of that engine remains pending. The [additional repositories](../research/VIDEO_READER_REFERENCES.md) were used as design references; their code was not copied. The supplied real Facebook post was not rendered, following the user's instruction to use test data. External discovery, live publishing and provider approvals remain `BLOCKED_EXTERNAL`.
