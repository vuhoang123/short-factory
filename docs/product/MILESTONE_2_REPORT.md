# Milestone 2 — Local narration quality

Visual requirement correction: see [SOURCE_CAPTURE_REPORT](SOURCE_CAPTURE_REPORT.md). The media evidence below used reconstructed text cards and verifies audio/duration; original post/comment screenshots are implemented and tested separately in that follow-up.

Date: 2 November 2026. **Local milestone complete.** Scope: complete source/comment sentence excerpts, actual-audio duration fitting, Vietnamese forced alignment, short voice preview and real local 40/60/120-second verification. Expanded video backgrounds/media library and live source/publishing integrations remain deferred. Final verification results are recorded below.

## Changes

- Correct WAV duration to use bytes per second, including stereo; reject truncated chunks. The previous PCM16 parser counted mono audio twice. Provider/cache identities are versioned so new work does not reuse those measurements. Existing frozen outputs and successful run checkpoints are preserved; create a new render to obtain corrected measurements. Older short/truncated scripts are not silently rewritten; regenerate or save a new version when they cannot meet the target.
- Deterministic local drafts use a fixed short speech calibration sample at the selected voice/rate, then budget complete source/comment sentences. Quotes remain contiguous source excerpts. Repeated boilerplate transitions are removed; comment cards display the narrated excerpt. Automatic ranking uses supplied reactions, excludes flagged and emoji-only entries, and honestly reports missing counts/fewer than 5–10 eligible comments.
- New VieNeu runs freeze internal `audioTimed: true`. `DURATION_FIT` uses measured WAV lengths plus 100ms gaps, changes tempo only within 0.8–1.25, and stores new run-specific fitted audio with separate cache keys. It neither cuts speech nor pads a short source with invented material. A target outside these quality bounds raises `DURATION_TARGET_UNREACHABLE`; the user must edit/regenerate the script or choose another target.
- `AUDIO_ALIGNMENT` sends the exact saved narration and final fitted audio to a private loopback adapter. A multilingual Whisper model aligns tokens via cross-attention/DTW. Exact word coverage, monotonic positive timestamps and audio bounds are required. Zero-width DTW cells are regularized to 20ms locally, with each boundary allowed to move at most 60ms; larger uncertain regions still fail. Adjusted-word counts are retained in stage metadata. Those same word timings reach subtitle records and the final manifest. Alignment failure is visible; it never silently becomes an allegedly precise proportional track.
- Short preview uses one fixed `voice-preview` sample at the chosen voice/rate and stays separate from source narration. Legacy segment preview remains available through the API. Local import has a draft-first action and a link into the saved Studio script; regeneration uses current duration/voice/rate/comment settings. Rendering clears preview-only flags.
- Remotion receives temporary loopback audio files instead of copying all WAV base64 strings into its render pages. Files live in the owned bundle directory and are removed by the existing cancellation/deadline/finally cleanup. Numeric IPv4 binding, owned child processes, outbox delivery and attempt fences are retained. Audio sequences key by segment so deduplicated audio assets can occur more than once.
- A PostgreSQL integration race exposed a serializable recovery conflict between competing sweepers. That rolled-back candidate is deferred to the next sweep for recognized PostgreSQL serialization errors; unrelated errors propagate. Existing tenant/version/attempt fences remain in place.

## Local model and dependencies

Pinned runtime in the existing isolated `.data/tts-vieneu/.venv`: `vieneu==3.8.3`, `faster-whisper==1.2.1`, `ctranslate2==4.8.4`, `librosa==0.11.0`. No system Python changes or paid inference API. The multilingual model is **Systran/faster-whisper-base**, revision `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66`, CPU int8/four threads. This is the multilingual model, not `base.en`. Model cache is under ignored `.data/tts-vieneu/hf`.

The larger multilingual small model was tested but exceeded the available Windows commit budget alongside the running local stack; it is not the default. [Stable-ts](https://github.com/jianfch/stable-ts) was inspected but not adopted: upstream is archived/paused and the direct CTranslate2 alignment API suffices. The speech model is released before fitting/alignment consumes the completed WAVs; the alignment model is released before rendering. Models reload lazily for the next request. Native model work runs on one fixed inference thread; HTTP health checks remain independent. Dependencies are imported at service startup to avoid Windows DLL initialization during threaded inference. The public health response exposes model identity, not credentials or source text.

Primary references: [faster-whisper v1.2.1 MIT license](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/LICENSE), [CTranslate2 v4.8.4 license](https://github.com/OpenNMT/CTranslate2/blob/v4.8.4/LICENSE), [multilingual base model and MIT terms](https://huggingface.co/Systran/faster-whisper-base), [CTranslate2 forced alignment API](https://opennmt.net/CTranslate2/python/ctranslate2.models.Whisper.html#ctranslate2.models.Whisper.align), [librosa 0.11.0 license](https://github.com/librosa/librosa/blob/0.11.0/LICENSE.md). VieNeu/model/codec terms and pins remain in [LOCAL_TTS_MODEL_EVALUATION.md](../research/LOCAL_TTS_MODEL_EVALUATION.md). No AGPL application code or alternative job engine was incorporated.

## Commands

```powershell
pnpm local:tts:setup
pnpm local:export
# Dedicated migrated *_test DB and isolated queue names; never reset shared data.
pnpm smoke:milestone2
pnpm smoke:milestone2 --targets=120
pnpm smoke:tts --alignment
pnpm smoke:phase6
.data/tts-vieneu/.venv/Scripts/python.exe scripts/test-local-alignment.py
pnpm test
pnpm test:integration
pnpm test:ui
pnpm lint
pnpm build --force
```

No Prisma migration. Existing installations must rerun `local:tts:setup` before starting the updated neural launcher. First startup downloads the pinned model; warmed model inference can run offline. Local export still needs sufficient RAM/Windows commit space for Chromium and the speech runtime.

## Verification

| Final gate | Result |
|---|---|
| Unit/contract/workflow checks | **194 passed**, 33 TypeScript test files |
| Bounded word-timing normalization | **4 Python tests passed** |
| PostgreSQL integration, tenant isolation, outbox/idempotency | **67 passed**, 7 files |
| Chromium UI, draft/preview request, import-to-Studio, session/poll stability/mobile | **27 passed** |
| ESLint and root TypeScript | **Passed** |
| Forced full build | **13/13 tasks passed, 0 cached** |
| Python compile and Node script syntax | **Passed** |
| Actual neural media | **40/60/120-second MP4s passed**; 60 and 120 ran consecutively through the same service/worker |
| Preset/custom voice and forced alignment bridge | **Passed** after final memory-lifecycle change; preset 6.000s, cloned sample 4.313s at rate 1.15, 26 aligned sample words, unauthenticated speech denied |
| Actual Phase 6 cancellation/deadline/retry/download regression | **Passed**; running cancellation 1,712ms, forced deadline 2,549ms, explicit retry completed on attempt 2, five durable history runs |

| Target | MP4 duration | Comments | Aligned words | Measured pre-fit narration + gaps | Tempo factor |
|---|---:|---:|---:|---:|---:|
| 40s | 40.021s | 5 | 149 | 37.000s | 0.9231 |
| 60s | 60.011s | 5 | 234 | 57.100s | 0.9504 |
| 120s | 120.021s | 10 | 473 | 115.060s | 0.9578 |

All MP4s are 1080×1920, 30fps, H.264/AAC. Their downloaded bytes/checksums were checked against stored assets and independently inspected again. The short voice preview measured **4.313s** at rate **1.15**, produced one separate sample and no video. Actual frame samples at 45s and 90s were visually inspected for Vietnamese text/card/caption layout. These are structural/render and limited visual checks, not a broad human listening study. The aggregate evidence is `test-results/milestone-2/evidence.json`; artifacts are `local-40s.mp4`, `local-60s.mp4`, `local-120s.mp4`, corresponding SRT files and `voice-preview.wav` in that directory. The 40-second and consecutive 60/120 checks used separate synthetic test workspaces; no claim of one continuous three-job benchmark is made.

The local launcher was restarted after verification. Speech health (`127.0.0.1:3002`), API health (`127.0.0.1:3001/api/v1/health`) and Studio (`127.0.0.1:3000/studio?mode=import`) returned HTTP 200. The live manifest exposes 25 local voices and health identifies the pinned multilingual alignment model. Startup does not reset the database or enable publishing.

Earlier attempts exposed Windows memory pressure, large base64 render props and zero-width model word cells. Those failed attempts were not counted as successful gates. The final implementation materializes render audio, serializes native model work and bounds local timestamp refinement. The final regression checks above supersede earlier intermediate counts.

Evidence files are ignored under `test-results/milestone-2*`; responsive UI evidence is under `docs/screenshots/milestone-2/`. The real media smoke creates its own original Vietnamese source, 10 comments with controlled reactions, a dedicated test workspace and queues. It checks draft-before-render, a short preview without video, 5/5/10 chosen comments, frozen duration/alignment, explicit render idempotency, pending human review, synthetic output approval and authenticated MP4 download. It makes no publishing calls and does not change existing user content or approvals.

## Changed files

- Media: `packages/media/src/{narration.ts,narration.test.ts,local-narration.ts,script.ts,tts.ts,alignment.ts,manifest.ts,contracts.ts,index.ts,comment-selection.ts,comment-selection.test.ts,production.test.ts,vieneu-tts.test.ts,render-child.ts,render-child.test.ts,composition.tsx}`.
- Worker: `workers/media/src/{pipeline.ts,audio-selection.test.ts,recovery.ts,recovery.test.ts}`.
- API: `apps/api/src/{production.service.ts,production.validation.ts}` and `apps/api/test/api.integration.test.ts`.
- UI: `apps/web/components/{story-studio.tsx,local-export.tsx}`, `apps/web/lib/studio.ts`, `apps/web/test/{product-studio.spec.ts,local-export-ui.spec.ts}` and milestone screenshots.
- Runtime: `scripts/{local-tts-server.py,test-local-alignment.py,requirements-tts.txt,local-export.mjs,smoke-local-tts.mjs,smoke-milestone2.mjs}`, root `package.json`, `.env.example`, README and API/local-export/roadmap documentation. Earlier uncommitted Milestone 1 changes remain preserved.

## Limits and source decision

Forced alignment is model-derived timing, not a human-certified timing benchmark. Structural checks and synthetic Vietnamese examples do not establish accuracy for every accent, name, number or noisy reference voice. Segments must be under 30 seconds and within the pinned model's token window; failure asks the editor to split/revise. Review actual audio, captions and pronunciation before approving an output. Other/legacy providers retain explicitly approximate captions.

The owner supplied a Facebook share URL, its embed permalink and two screenshots. The URLs could not be read through available supported access. A private local review draft and seven legible comment transcriptions were prepared under ignored `.data/user-imports/`; missing reactions were not invented. The owner explicitly confirmed no current usage rights and chose **synthetic fixtures only**. The Facebook content was not imported into an approved production, rendered, published or treated as owner-created data. Arbitrary public/group extraction still requires an approved adapter or licensed/user-supplied data and remains `BLOCKED_EXTERNAL`.

Remote CI, production soak, a broad dialect/voice-quality panel, cloud storage, video backgrounds, live provider publishing and comprehensive transitive redistribution review are outside this local milestone.
