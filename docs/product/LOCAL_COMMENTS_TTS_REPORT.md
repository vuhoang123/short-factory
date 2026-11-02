# Local comment selection and neural narration

Historical verification snapshot. Milestone 2 subsequently corrected WAV duration measurement (the earlier parser doubled mono PCM16 duration), versioned speech caches, added forced alignment and real duration fitting. Use [MILESTONE_2_REPORT.md](MILESTONE_2_REPORT.md) for current behavior and measurements; the audio duration figures below describe the earlier parser, not certified physical WAV durations.

Date: **2 November 2026**. Follow-up scope authorized by the user after Milestone 1: reduce comment-entry work, select 5–10 high-reaction comments according to duration, improve local Vietnamese speech and support a custom voice. This does not complete all planned media-quality or live-source milestones.

Local implementation and verification are complete. The app has been restarted with VieNeu as its active speech provider: loopback speech health, API health and Studio each returned HTTP 200; the live manifest reports 25 voices and defaults to Ngọc Linh. Arbitrary-link ingestion remains blocked as stated below.

## Behavior

- Import a complete collection once: paste lines, `reaction_count<TAB>comment`, or a JSON array of `{ "body": "...", "likes": 125, "externalId": "optional-id" }`. Open `.json`, `.txt` or `.tsv` files in the local export form. Up to 500 comments / 200,000 input characters; the existing API request-byte limit also applies. Plain lines remain supported without inventing reaction counts.
- Automatic selection uses stored reactions, descending, with stable ties and flagged/empty comments excluded from recommendations. Target count is clamped to 5–10 from duration: 40/60 seconds → 5, 90 → 8, 120 → 10. Fewer available comments stay fewer. Missing counts are labeled; this is not a claim to know the top comments on Facebook/Threads.
- Studio and local export show the recommendation and permit manual selection of up to 10. The backend independently resolves automatic selection and persists actual comment IDs in the production input. Rights/safety, membership, grounding, immutable versions and outbox remain enforced. Narration length is approximate; long comments may be exact excerpts, and actual MP4 duration follows generated speech.
- Local export supports 25/40/60/90/120-second targets. Reading existing progress or a saved run preserves its selected comments. Changing the application speech default to VieNeu does not invalidate already queued eSpeak jobs.
- VieNeu neural narration runs on local CPU through a private loopback service. The installed model offers 25 voices; Ngọc Linh and Thiện Minh are ordered first for storytelling. Speed remains configurable in Studio. Legacy eSpeak is available through `LOCAL_TTS_PROVIDER=local`.
- A custom voice accepts a clean **PCM16 WAV, 3–15 seconds, under 3 MB** and explicit speaker authorization. The sample is stored privately under the active workspace as VOICE_REFERENCE; raw voice references are not exposed by the ordinary media endpoint. No training or paid API subscription is required. Cloning occurs within the existing media worker, not an HTTP upload handler.

The voice library refresh keeps the current form mounted and selects the newly saved voice after its metadata loads; it does not reset the user's source editor. Speech service requests require a generated bearer token, bind only to `127.0.0.1`, reject redirects/external endpoints and do not log source text/reference audio. Audio cache keys include provider/model revision and reference checksum. Speaker samples never enter job envelopes or browser progress storage.

## Run

```powershell
pnpm local:tts:setup
pnpm local:export
```

This machine's isolated Python environment and model cache are already installed. The launcher detects that environment, waits for neural service readiness, then starts API, discovery/media workers and web. First use downloads weights; cached models can run with `HF_HUB_OFFLINE=1`. No global Python upgrade, database migration or Redis reset is needed. Open `http://127.0.0.1:3000/studio?mode=import`.

To create a custom voice, open **Giọng đọc riêng · VieNeu local**, provide the WAV and consent, then save/select it. In Studio, generate a script and use its audio preview before rendering. A prior rendered video remains tied to its existing narration; choose a new voice and explicitly render again to change it.

## Verification

| Gate | Result |
|---|---|
| Unit/contract/workflow | 179 passed / 32 files |
| PostgreSQL | 67 passed / 7 files, including automatic ranking/10-comment persistence and custom-voice role/tenant/privacy/idempotency checks |
| Browser | 26 passed, including file import → automatic ten-comment selection, custom voice reload/selection, legacy workflows and state/polling stability |
| Strict build / ESLint | 13/13 build tasks passed with cache bypass, root TypeScript check passed; ESLint passed |
| Python / launcher syntax | Python compile and both launcher/setup syntax checks passed |
| Actual neural smoke | PASS offline, preset + custom reference + speaking rate 1.15 + denied unauthenticated request; actual 1080×1920 H.264/AAC MP4 rendered successfully |

Neural smoke evidence is in ignored `test-results/local-tts-smoke.json`, `vieneu-narration.wav`, `vieneu-custom-smoke.wav` and `vieneu-neural-smoke.mp4`. The MP4 is 20.907 seconds, 1,485,683 bytes, 1080×1920 at 30 fps, H.264/AAC. The offline neural synthesis + Remotion run completed in 101.971 seconds. Model/codec revisions and measurements are in [the research note](../research/LOCAL_TTS_MODEL_EVALUATION.md). The test reference is synthetic software-generated audio, not the user's voice. A new private recording has not been supplied or evaluated.

Commands:

```powershell
pnpm test
pnpm test:integration
$env:LOCAL_EXPORT_UI_BASE_URL='http://127.0.0.1:3000'
pnpm test:ui
pnpm lint
node node_modules/turbo/bin/turbo run build --concurrency=1 --force
pnpm smoke:tts
pnpm smoke:tts --render
```

## Files and preserved scope

Comment logic: `packages/media/src/comment-selection{,.test}.ts`, media contracts/exports; `apps/api/src/{app,content.service,production.service,production.validation}.ts`; web `lib/{comment-import,comment-selection,local-export}.ts`, parser tests and `components/comment-picker.tsx`; Studio/local export UI and their browser tests.

Speech: `packages/media/src/{tts,vieneu-tts.test}.ts`; API production service; media worker pipeline/config/audio tests; `components/voice-library.tsx`; `scripts/{local-tts-server.py,setup-local-tts.mjs,smoke-local-tts.mjs,requirements-tts.txt,local-export.mjs}`; root commands, placeholders and ignore rules. No existing user content, scores or reviews were changed.

Preserved: existing templates, script/version editing, private media, manual input, human reviews, local downloads, durable render recovery and publishing gates. Research recommendations for other models do not imply installation or verification.

## Remaining access requirement

**A public Facebook/Threads/Group URL alone still does not fetch comments.** The repository needs an approved platform adapter or a licensed/user-supplied dataset with the required fields. This follow-up removes individual comment-entry/selection work once a collection is available. It does not claim that arbitrary links can be fetched without authorization. Publishing remains blocked and no scraping bypass was implemented.
