# Studio maker local — 3 November 2026

**Status: complete for the local scope below.**

Owner-authorized implementation of the [MakeShort reference review](MAKESHORT_REFERENCE_REVIEW.md), with additional Studio UX improvements. This does not renumber the publishing milestones or enable external publishing.

## Delivered

- A reviewed import at `/studio?mode=import` continues in the same `StoryStudio` used by Discover. The legacy quick-export journey remains at `/export`. Reload retrieves the source and its latest durable production from the API.
- Two-column editing and sticky 9:16 preview/export, with preview first on mobile. Source details, comment selection, version history and uploads are progressively disclosed. Voice, caption, background/music and privacy controls are grouped together.
- Original-image composition preview before MP4 generation, including masking and tall-image pan. Missing screenshots or invalid background starts block export. Captured sources never fall back to recreated cards when an image is missing.
- Preview and MP4 share `buildRenderManifest` and `StoryComposition`. Draft timing is explicitly estimated until matching recorded audio exists. Reuse checks script version/order/text, voice and rate, preserving real audio/frame/caption timing while applying current visual choices. Changing caption preset can require new word alignment and is labeled accordingly.
- Comment counts, a ten-comment limit, disabled sensitive comments and explicit regeneration after changing a drafted selection. Unsaved script edits and changed target duration also block export. Verbatim source text remains read-only; commentary is editable and versioned.
- Visual Classic/Karaoke choices, caption size/color/position, voice/speed and short explicit voice preview. Setting changes do not enqueue jobs, repeatedly call TTS or refetch source images.
- Local H.264 MP4 backgrounds loop from a selected start, cover-cropped and muted. Local PCM16 WAV music supports audition, looping, volume, fades and narration ducking. Static-image backgrounds remain supported.
- Named workspace presets save voice/rate, template, captions, theme, privacy, background and music. They exclude source IDs/text, apply explicitly and update on saving the same name. Production checks asset access and rights again.
- Authorized audio/video byte ranges support playback and seeking. Existing outbox, idempotency, cancel/deadline, retry, review and download behavior remains authoritative.

## Implementation and boundaries

Optional strict `mediaSettings` is added to production input, render/regeneration requests and manifests. Old requests keep omitted fields omitted, preserving legacy identities/manifests. Background duration is derived from server-probed metadata.

Uploads are capped at 20 MB. Video must be H.264 MP4, 1–300 seconds, at most 60fps and a bounded 4K pixel count. Probe runs in an owned child with a 15-second deadline and tree termination. Music must be PCM16 mono/stereo WAV, 8–96kHz and 1–600 seconds. Images retain Sharp validation. `X-Asset-Encoding: uri` supports encoded names/evidence; legacy raw-header callers remain compatible.

The renderer materializes MP4/music into its owned temporary bundle and serves short loopback URLs. This fixes OffthreadVideo proxy HTTP-header overflow from base64 MP4 URLs and retains abort/deadline cleanup. Required attribution is displayed in original-image mode.

The additive `StudioPreset` table has a workspace FK and workspace-scoped IDs/names. Writes require current editor membership, serializable transactions, idempotency records and audits. Production settings and queue events still commit through the existing outbox. Presets themselves do not enqueue work.

API additions: `GET/POST /music`, `GET/POST /studio-presets`; `/backgrounds` also accepts `video/mp4`. Source-image reads return checksums and capture provenance. No new dependencies, paid services, social credentials or publishing adapters were added.

## Verification

| Check | Result |
|---|---|
| Unit/contract | **206 passed**, 38 files |
| PostgreSQL integration | **77 passed**, nine files |
| Typecheck | Root and **13/13 packages passed** |
| Lint | Passed |
| Forced build | **13/13 successful**, 18 Next pages |
| Browser UI suite | **33/33 passed** in one full run, including all seven Product Studio cases |
| Actual local media workflow | **PASS**, original screenshots + VieNeu + forced alignment + video background + music + review/download |

New coverage includes media boundaries, fade/duck envelopes, preview/render timeline equality, recorded-audio reuse, preset privacy/idempotency, encoded metadata, PCM rejection, byte ranges, revoked rights, role/workspace denial, absent-mask blockers, stable settings and the shared import handoff. Existing workflow/recovery tests pass.

Real workflow evidence: `test-results/studio-maker/evidence-25.json`. The owned synthetic source uses mocked capture transport with actual DOM screenshots, then real API/DB/outbox/workers/TTS/renderer. Downloaded result: **25.003 seconds, 1080×1920@30 H.264/AAC, five comment images, 95 aligned words**, background looping from 0.5 seconds, music and explicit synthetic-fixture approval. Render request replay returns the same run. File: `test-results/studio-maker/original-25s.mp4` (21,086,490 bytes).

Decoded MP4 audio contains the deliberately generated 880Hz music component alongside real narration, peak/local-neighbor ratio **33.22**. See `test-results/studio-maker/audio-mix-evidence.json`. This verifies mixing, not subjective voice quality. Actual frames at 1 and 10 seconds were inspected.

Browser evidence: [desktop](../screenshots/studio-maker/desktop.png), [mobile](../screenshots/studio-maker/mobile.png). Review found and resolved Unicode headers, missing-image blockers, recorded-audio reuse and base64-video proxy overflow; no unresolved high/medium findings in reviewed code.

Earlier attempts exposed browser `.js` import resolution, an old fixed-duration mock and historical screenshot overwrites. These were corrected; historical images were restored, new test images use separate paths. The smoke uses the installed Remotion FFmpeg binary and standard Python/Pillow; it adds no media download or Python dependency.

## Changed files

- Web: `story-studio`, `local-export`, `comment-picker`, new `studio-draft-preview`, `studio-presets`, `studio-asset-upload`, CSS and UI fixtures/tests.
- API: `app`, `content.service`, `production.service`, `production.validation` and `studio-maker.integration.test.ts`.
- Media: `studio-settings`, `manifest-data`, `manifest`, `contracts`, `composition`, `media-upload`, `media-probe-child`, `render-child`, exports and tests.
- Worker: `workers/media/src/pipeline.ts`.
- Database: `prisma/schema.prisma`, migration `20261103000000_studio_presets`.
- Verification/docs: `scripts/smoke-milestone2.mjs`, this report, local/API guides and roadmap.

The preset migration was also applied to the existing local application database without resetting data. After restart, web/API/VieNeu/capture health endpoints on ports 3000–3003 each returned HTTP 200.

## Commands

```powershell
pnpm db:generate
pnpm db:deploy
pnpm local:export
```

Open `http://127.0.0.1:3000/studio`. Current-browser Facebook/Threads screenshots still require the existing one-time extension installation: [instructions](CURRENT_BROWSER_CAPTURE_REPORT.md).

Checks: `pnpm test`, `pnpm test:integration`, `pnpm test:ui`, `pnpm lint`, `pnpm typecheck`, `pnpm exec turbo run build --force`.

Real smoke, with the configured migrated `_test` database and Redis:

```powershell
node --env-file=.env --import tsx scripts/smoke-milestone2.mjs --source-capture --targets=25 --studio-media
```

## Limits

Music upload is WAV PCM16; MP3/AAC upload is not implemented. Output stays 9:16 1080p. Original images pan automatically; manual crop/focus editing is deferred. Libraries use attested user files, without third-party gameplay/music bundles. Real Facebook/Threads account capture and subjective voice/accent benchmarking were not repeated. External production access and publishing remain `BLOCKED_EXTERNAL`.

## Video review discovery follow-up — 2026-11-03

The review controls were buried below the editor and labeled “Approve video”. Studio now exposes **Video đã tạo & duyệt** in its header, including import mode. The expanded home library lists up to the existing API's 50 recent workspace videos, prioritizes completed pending decisions, and links directly to the chosen video's review section. Empty/error states explain the next action and support retry.

**Xem và duyệt video** now appears above the editor. It plays the stored MP4, shows a readable decision status, and provides **Duyệt video**, **Không duyệt video** and **Tải MP4 về máy**. Approval requires the explicit watched/checked confirmation and the existing Owner/Admin/Reviewer role. Editors receive an explanation and retain preview/download access. A link next to the draft preview returns to the finished MP4. Rejected/approved outputs no longer show pending-decision actions; an API refusal remains an error and never displays approval.

API, database and publishing behavior are unchanged. Review decisions still use the existing authenticated, audited, idempotent endpoint and its quality/rights/safety checks. The library does not automatically create or approve jobs. External publishing stays blocked.

Changed files: `apps/web/components/{studio-workbench,story-studio,studio-video-library}.tsx`, `apps/web/app/globals.css`, Product Studio/workspace UI fixtures, the local export guide and this report.

Validation: lint/web typecheck passed. The full browser run passed 39 of 42 cases; three new assertions initially selected duplicate labels/Next's route announcer. After scoping those selectors, all **12 Product Studio cases passed**, covering each affected case, role restrictions, persistent approval, rejection, quality refusal, library navigation, empty/error states, desktop/mobile layout and existing draft/render/handoff flows. All **42 UI cases** are verified across these runs. Those tests use synthetic API responses and did not cover the actual video-detail payload mismatch identified below.

Run against the existing local app to avoid sharing `.next` between dev servers:

```powershell
$env:LOCAL_EXPORT_UI_BASE_URL='http://127.0.0.1:3000'
pnpm --filter @shorts-factory/web exec playwright test --config playwright-ui.config.ts product-studio.spec.ts
pnpm lint
pnpm --filter @shorts-factory/web typecheck
```

Evidence: `test-results/video-review-ui.log`, `video-review-product-ui.log` and `studio-product-screenshots/video-review-{desktop,mobile}.png`. The browser tests use synthetic API/media fixtures; this UI follow-up did not encode another MP4 or access a real social account. The earlier real-render evidence above remains the renderer baseline.

## Actual video detail response fix — 2026-11-03

The reported “The server returned an unexpected response” was a client contract failure: `GET /videos/:id` included the video's story but omitted `story.channel`, while Studio required that field. The MP4 existed and the video was `READY_FOR_REVIEW`; the response was rejected before the review panel could load. Earlier mocked UI fixtures explicitly supplied `channel:null`, masking the API mismatch.

The API now includes the story channel's ID, name and language, or `null` when no channel is attached. Studio's existing story/video validators live in `apps/web/lib/studio-response.ts` so database-backed HTTP tests can use the exact client schema. The actual video review test validates the GET payload before approval, retains foreign-workspace denial and idempotent/role-checked decisions, and additionally checks a story without a channel.

Read-only validation reproduced the mismatch on all seven existing local videos, then passed on all seven after the fix. No existing video decision was changed during that inspection. The local stack was restarted with the repaired API; Web, API, speech and capture health checks return 200. Existing MP4s can be reviewed after reloading Studio and do not require another render.

Changed files: `apps/api/src/production.service.ts`, `apps/api/test/api.integration.test.ts`, `apps/web/components/story-studio.tsx`, new `apps/web/lib/studio-response.ts`, API docs and this report. Lint and API/web typechecks passed. PostgreSQL `api.integration.test.ts`: **26 passed**, including the real GET/approval contract, null channel, cross-workspace denial, reviewer authorization and replay checks. Product Studio browser suite: **12 passed**, recorded in `test-results/video-contract-ui.log`; this fix does not add another render or approve the user's content.
