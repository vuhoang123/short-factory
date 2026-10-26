# 01 — Product Requirements Document

## Goal
Build a dashboard for discovering licensed/authorized social text posts + comments, scoring potential, producing original/editorially transformed short-form videos with TTS and captions, reviewing rights and quality, scheduling, and publishing to permitted owned social accounts.

## User personas
- MVP: owner/operator with 1 workspace, multiple editorial content channels and managed social accounts.
- Future: SaaS admin, workspace owner, editor, reviewer, analyst. Implement role boundaries without billing in MVP.

## Functional requirements
**Identity:** Sign in, create workspace, membership roles OWNER/ADMIN/EDITOR/REVIEWER/VIEWER, active workspace context.
**Sources:** register supported source config; user-supplied paste/JSON import; safe source sync with cursor and provenance; content hashes; post/comment normalization; metrics snapshots. Allow tagging by category, language, relevance.
**Discovery:** topic rules (keywords, allow/deny), source health, schedule, dedup exact/hash/near-duplicate, AI ranking with explorable factors. No promise that every public Facebook group can be indexed.
**Editorial:** candidates → source references → draft story segments (HOOK/POST/COMMENT/COMMENTARY/OUTRO) → editorial diff/versioning; detect unsupported claims and identifying data; allow editor adjustments.
**Media:** provider-agnostic TTS, persisted audio/cue alignment, licensed background library, Remotion templates, subtitle preview, produce H.264/AAC 9:16 MP4, thumbnail, reproducible render manifest.
**Rights:** source rights basis OWNED/LICENSED/CONSENTED/EXCEPTION_REVIEWED/UNKNOWN; evidence and allowed platform/commercial uses; editor review; default deny for unknown/expired/blocked; takedown tracking.
**Publishing:** connect authorized YouTube channels/Facebook Pages via official OAuth/APIs, schedule one publication per target account, platform-specific validations, retries, remote reconciliation; TikTok manual export by default.
**Analytics:** save allowed metrics as time series, basic views/likes/comments and status; do not promise data unavailable for a permission scope.
**Ops:** audit trails, workflow runs, dead letter admin view, health dashboard, per-workspace budgets and rate limits.

## Non-functional
Security-first credentials; authz and tenant isolation; async workflows; clear provider failure modes; transparent costs; observability; low-cost local Docker dev. Dev mode must operate with fake import, fake TTS and fake publisher safely.

## Out of scope v1
Billing, arbitrary Facebook group scraping, bulk reposting of unlicensed content, evading provider review, guaranteed TikTok public direct post, automated account creation, copyrighted third-party gameplay downloads, auto-generated comment impersonation.

## Definition of Done
A user can import a permitted story with 3 comments, generate source-grounded script and speech, render a 1080x1920 MP4 with caption timing + licensed background, review and approve, then queue publisher jobs; dev tests use mocks; official production integrations only enabled where credentials and platform approval exist. Each account gets independent publication status. A blocked-rights video cannot publish even by direct API request.
