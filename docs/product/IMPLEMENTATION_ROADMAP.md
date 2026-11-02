# Implementation roadmap

Scope authorized 2 November 2026: documentation first, then Milestone 1, followed by **Milestone 2 local narration quality**: actual-audio duration fitting, complete comment excerpts, Vietnamese forced alignment, short voice preview and real 40/60/120-second verification. All six planning documents preceded runtime code changes. Existing Phase0–6 records remain authoritative; publishing approvals are not implied.

Milestone 1 is recorded in [MILESTONE_1_REPORT.md](MILESTONE_1_REPORT.md). Milestone 2 scope and verification are recorded in [MILESTONE_2_REPORT.md](MILESTONE_2_REPORT.md). The remaining roadmap is deferred.

## Milestone 1 — Core Content Studio UX

1. Add five primary navigation areas and separate Settings/tools; retain legacy routes and current role/session boundaries.
2. Overview: real pipeline/review/recent-render/failure/publishing/performance summaries; clearly label query scope and unavailable integrations.
3. Discover: unified source cards, original/comment preview, keyword/source/topic/date/quality/engagement filters, bounded page selection and explicit bulk editorial actions.
4. Reuse one source detail for provenance, rights/evidence, score blockers and next action. Continue directly to the exact selected candidate(s) in Studio.
5. Studio: preserve script/version/audio/background/template/caption/actual-video features. Add script-only draft generation before explicit render, deep links to existing run/video and progressive advanced settings. Keep manual export available inside the Studio journey and at its legacy URL.
6. Derive understandable lifecycle/job labels and valid retry/cancel actions from durable records. New product views read existing models; existing mutation/workflow paths remain authoritative.
7. Demonstrate old vs new journey and pass tests before calling the milestone complete.

Acceptance: existing permitted story + three comments → rights/candidate review in context → exact Studio selection → editable script before video generation → real video preview → explicit output approval/download, without visiting a different technical module. Multi-selection never auto-publishes or silently approves rights. New empty/loading/error/mobile states work, workspace leakage is denied, job replay/cancel/idempotency remain intact.

Verification: pure lifecycle/query/route tests; PostgreSQL tests for tenant/cursor/detail/script-only/render boundary and transactional requests; existing unit/contract/workflow suites; mocked browser vertical slice plus bulk/role/error/reload/session stability; real local media smoke where available; typecheck/lint/build and responsive screenshot evidence. Use dedicated test DB/queues, no resets or paid/publishing calls. Record exact results in `MILESTONE_1_REPORT.md` after implementation.

## Milestone 2 — Local narration quality

Follow-up correction: original post/comment screenshots and the explicitly requested local dedicated-browser flow are recorded separately in [SOURCE_CAPTURE_REPORT.md](SOURCE_CAPTURE_REPORT.md). Existing Milestone 2 text-card renders verify audio; they do not satisfy the original-source screenshot requirement.

Status: **complete for the local scope below**; 194 TypeScript tests, 4 Python tests, 67 PostgreSQL tests, 27 UI tests, build and real media/reliability gates passed. See the report for exact measurements and remaining limits.

1. Measure WAV duration correctly and version provider cache identities; preserve existing immutable render outputs.
2. Calibrate deterministic scripts with a short local voice sample, retain complete source/comment sentences and 5–10 eligible comments selected from supplied reactions.
3. Fit actual narration plus gaps to the chosen target with bounded, pitch-preserving tempo changes. Persist run-specific fitted audio and checkpoints; fail visibly when the source cannot meet the target without cutting or excessive stretching.
4. Force-align exact saved narration with a multilingual local Whisper model. Validate word coverage/order/bounds and carry timings through stored subtitles into the rendered manifest; never label proportional timings as forced alignment.
5. Add short voice preview at the chosen rate and a draft-first entry from local import. Keep immutable script versions, tenant authorization, rights review, outbox, retries and human output approval.
6. Verify real local 40/60/120-second MP4s plus unit, database, browser and build gates before calling this scope complete.

Approved video backgrounds and a broader media library from the original proposal are deferred beyond this narrower owner-approved milestone. Arbitrary Facebook/Threads/group extraction and live publishing remain `BLOCKED_EXTERNAL`.

## Later milestones — deferred

| Milestone | Scope | Required gates |
|---|---|---|
| Expanded media library | Approved video backgrounds, broader provenance/preview tooling and further accent/timing benchmarks | Asset/model terms, real quality evidence, tenant/cancel tests |
| 3. Publishing UX + adapter | OAuth/account setup, composer/calendar, platform previews, per-account schedules, reconciled retries | Provider eligibility/permissions, encrypted credentials, explicit approval and license-compliance review before any AGPL reuse |
| 4. Analytics/optimization | Permitted live metrics and supported topic/source/template comparisons with evidence | Correct definitions/freshness/sample sizes, approved grants and no assumed causal AI uplift |
| 5. Production operations/R2 | Private cloud storage, distributed limits, monitoring, backup restore, quotas, deploy/soak | Owner hosting/retention/budget choices; restore/security/load verification |

## Owner actions

No new third-party credentials, paid services or platform approvals are needed for Milestone 1 local. The owner supplies permitted content and makes actual rights/output review decisions. Do not automatically approve existing personal content while testing. Before later integration, choose the intended licensing/distribution model, arrange review of the exact AGPL integration proposal, confirm Remotion/model/asset terms, and provide scoped provider/R2 permissions through secrets management. API keys alone do not establish platform approval or rights.
