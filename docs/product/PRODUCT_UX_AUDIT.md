# Product UX audit — AI Content Studio

Audit: **2 November 2026**, baseline commit `500d2bf`. This audit was written before Milestone 1 implementation. Evidence is checked-in source, not an assumption that a missing menu means a missing feature. Earlier verification remains a dated snapshot in reports 12–18.

## Current journey and observed friction

Current journey: create workspace → Channels → Sources or manual import in Library/Export → Reviews → candidate selection in Library → Studio/Export → render → video review/download → Autopilot/Analytics. There are eleven top-level workspace links. Each screen exposes a subsystem rather than the user's next step.

| Current screen / annotated description | Working behavior to preserve | UX problem |
|---|---|---|
| `/dashboard`: counters, recent posts, Phase2 readiness cards | Tenant-scoped counts and recent imports | No useful recent render/failure/review pipeline; stale phase language |
| `/channels`: list and creation form | Language, threshold, topic config | Setup appears beside everyday creation tasks |
| `/sources`: registry, access status, sync history and source editor | Approved/manual/synthetic adapter boundaries, stable sync enqueue | Users interpret supported platform labels as connected live discovery |
| `/library/posts`: separate all-post/candidate tables and JSON import | Search, score factors, filters, provenance, dedupe | Source detail, rights review, candidate approval and production are separated |
| `/reviews`: post inspector and full rights decision form | Evidence/territory/attribution/role checks and takedown | Same source detail duplicated in Library, Studio and Export |
| `/studio`: long production form, script editor, audio/video preview and video list | Grounded scripts, version ordering/diff, voice preview, two templates, captions, licensed image upload, render/rerender, output approval | No durable selection from Discover; all settings appear at once; first action renders before editing script |
| `/export`: Vietnamese manual import/review/render wizard and render history | Offline Vietnamese speech, rights/candidate gates, stable operation keys, cancellation, reload/resume and downloads | Parallel creation flow; users encounter a disabled render button without understanding discovery threshold policy |
| `/autopilot`: rules, workflow monitor, spending and approval inbox | Frozen rules, reservations, human QC, stop/retry and workflow history | Large technical forms compete with the core journey |
| `/analytics`: nullable metrics, trends, recommendations and experiments | Manual/mock/live-adapter boundaries and evidence-based recommendations | Source/topic/template dimensions remain limited by available observations; not proof of AI uplift |
| `/settings`: workspace, members, topic rules and audits | Membership isolation, policy configuration, audit records | Integrations and operating settings lack one clear home |
| `/guide`, `/login`, shared loading/error views | Onboarding and authentication | Secondary tools occupy primary navigation |

These are annotated current-screen descriptions derived from the actual components. Existing reference screenshots are `docs/screenshots/dashboard.png` and `mobile-dashboard.png`; they are historical, not new runtime evidence. No user content or session screenshots were collected for this audit.

## Complete implementation inventory

Frontend: Next app routes under `apps/web/app`; `AppShell`, `WorkspacePage`, `StoryStudio`, `LocalExport`, `AutopilotDashboard`, `AnalyticsDashboard`, `AuthForm`, shared feedback and `useResource`. The latest resource hook serializes polling, aborts old reads and retains mounted editors on same-resource refresh. Session response epochs protect workspace switches. Preserve these fixes.

Backend controllers/services (`apps/api/src/app.ts` and sibling services):

| Group | Existing API responsibilities |
|---|---|
| Auth/workspace | register/login/logout/me, active workspace, workspace creation/read, membership list/update |
| Content/discovery | channels; source CRUD/access/sync/run history; topic-rule CRUD; manual import; posts/comments/eligibility; rights review/takedown; candidates/filter/review; dashboard/audit logs |
| Production | voices/templates/backgrounds, attested image upload, authorized media streams; candidate production; story read/edit/regenerate/audio; production list/detail/cancel/retry; video list/detail/review/rerender |
| Automation | account status, rules/version/control, dry run/run/schedule preview, run detail/cancel/retry, approvals, usage and budget policy |
| Analytics | overview, publications, manual metrics/provider refresh/history, sync runs, recommendations/decisions and experiments/assignments |
| Publishing | `POST /publications` deliberately returns `BLOCKED_PHASE`; tables/contracts/mocks do not constitute a production publisher |

Workers: `workers/discovery` schedules permitted synthetic/manual scoring and relays transactional outbox; `workers/media` generates script/TTS/alignment/render/storage/QC checkpoints with leases and cancellation; `workers/automation` resumes workflow snapshots, budgets and analytics. Redis/BullMQ transports jobs; PostgreSQL remains authoritative.

Packages: `shared` (rights/state/normalization), `sources` (adapters/scoring), `media` (scripts, TTS, captions, backgrounds, manifests, Remotion, local immutable storage), `publishers` (mock adapters), `automation` (rules/selection/scheduler/quality/experiments), `workflows` (orchestration/budget/analytics), `analytics` (adapters/nullable summaries), `database` (Prisma/seed/constraints). Public reference contracts: `contracts/source-adapter.ts`, `publisher-adapter.ts`. Examples: manual import and render manifest.

All 43 Prisma models, grouped without replacing them:

- Identity: User, Session, Workspace, WorkspaceMember.
- Discovery/rights: ContentChannel, SourceConfig, SourceSyncRun, SourcePost, SourceComment, PostMetricSnapshot, ContentCandidate, TopicRule, ContentRight.
- Media: StoryProject, StoryVersion, MediaAsset, Video, ProductionRun, ProductionStage, AudioAsset, SubtitleTrack, RenderManifest, RenderJob.
- Publishing: SocialAccount, Publication, PublicationAttempt, PublicationMetric.
- Automation/analytics: WorkflowRun, AutomationRule, AutomationRuleVersion, WorkflowStep, CandidateSelectionDecision, ContentQualityReport, BudgetPolicy, BudgetReservation, UsageEvent, AnalyticsSyncRun, PerformanceRecommendation, Experiment, ExperimentAssignment.
- Reliability: OutboxEvent, AuditLog, IdempotencyRecord.

## Technical limitations that affect the redesign

1. Live Reddit/Threads/Facebook source adapters and production publishing remain blocked; a manual Facebook URL is provenance, not fetched content. Display this at the source filter/import boundary.
2. Candidate approval enforces rights, safety and a persisted score threshold. Do not secretly turn BELOW_THRESHOLD into APPROVED or lower an existing channel's threshold. Existing imported content is deduplicated and preserved.
3. There is no single content lifecycle column. Derive a read model from candidates, latest production and video/publication review states; do not add a competing workflow state machine.
4. Existing first-generation request runs script, speech and render together. A script-only checkpoint plus explicit render-from-story operation is the smallest way to support review before expensive rendering while retaining the worker/outbox.
5. Existing background support is static images; arbitrary video background processing/mixing is incomplete. Retain image selection and document later video work.
6. Local speech supports Vietnamese via eSpeak/WSL; alignment remains approximate. Paid manual budget admission, R2, OAuth secrets lifecycle, production limits and remote takedown remain separate work.
7. Discover currently lacks date/engagement filters, bulk selection, a joined latest-work view and Studio deep links. Add bounded tenant-scoped queries and client orchestration, not a replacement discovery engine.

## Milestone 1 acceptance

Five primary navigation items plus separate Settings. One source detail for rights/comment/score/next action. Discover selection opens the exact source in Studio, not the first arbitrary candidate. Script → preview/edit → explicit render → human output approval/download stays on one page. Overview exposes real recent work/reviews/failures and honest publishing availability. Bulk actions return per-item outcomes, never implicit rights approval or automatic paid renders. Legacy URLs/data remain usable.

Detailed scope, tests and deferrals are in `IMPLEMENTATION_ROADMAP.md`; source reuse decisions are in `../research/OPEN_SOURCE_MODULE_EVALUATION.md`.
