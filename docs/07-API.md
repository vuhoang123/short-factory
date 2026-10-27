# 07 — REST API Contract (v1)

All endpoints under `/api/v1`; bearer/session auth required except auth callbacks/health; workspace derived from session and membership. Use standard pagination (`cursor`, `limit`) and consistent structured error `{code,message,details?,requestId}`. Protected mutating requests accept `Idempotency-Key`.

| Method | Path | Function | Minimum role |
|---|---|---|---|
| POST | `/workspaces` | Create workspace | Auth user |
| GET | `/workspaces/:id` | Workspace detail | VIEWER |
| POST | `/channels` | Create editorial channel | ADMIN |
| GET | `/channels` | List | VIEWER |
| POST | `/sources` | Configure permitted source | ADMIN |
| PATCH | `/sources/:id` | Update a source in the active workspace | ADMIN |
| DELETE | `/sources/:id` | Delete an empty source; sources with imported content must be disabled | ADMIN |
| POST | `/sources/:id/verify` | Check adapter access status | ADMIN |
| POST | `/sources/:id/sync` | Trigger sync | EDITOR |
| GET | `/sources/:id/sync-runs` | Health/history | VIEWER |
| GET/POST | `/topic-rules` | List or create channel discovery rules | VIEWER / ADMIN |
| PATCH/DELETE | `/topic-rules/:id` | Update or remove a rule | ADMIN |
| GET | `/candidates` | Filter/sort scored candidates | VIEWER |
| POST | `/candidates/:id/review` | Approve/reject after rights and safety checks | REVIEWER |
| POST | `/imports/manual` | Import owned/licensed post + comments | EDITOR |
| GET | `/posts` | Search/filter normalized posts | VIEWER |
| GET | `/posts/:id/comments` | Read safe comments | VIEWER |
| POST | `/candidates/:id/produce` | Start workflow | EDITOR |
| GET | `/workflows/:id` | Pipeline steps, progress, errors | VIEWER |
| GET | `/stories/:id` | Script versions/sourceRefs | VIEWER |
| PATCH | `/stories/:id` | Edit draft (version check) | EDITOR |
| POST | `/videos/:id/render` | Trigger new render version | EDITOR |
| POST | `/videos/:id/reviews` | Approve/reject a completed video | REVIEWER |
| GET | `/videos/:id` | Video/manifest/asset details | VIEWER |
| POST | `/social-accounts/oauth/:provider/start` | Start connect | ADMIN |
| GET | `/social-accounts/oauth/:provider/callback` | Handle callback | OAuth flow |
| POST | `/publications` | Create scheduled per-target job | EDITOR + rights gate |
| POST | `/publications/:id/retry` | Retry after state validation | ADMIN |
| GET | `/publications` | Filter scheduled/states | VIEWER |
| GET | `/analytics/overview` | Aggregates where permitted | VIEWER |
| GET | `/audit-logs` | Sensitive actions | ADMIN |
| POST | `/takedowns` | Register/remove request | ADMIN |
| PUT | `/channels/:id/automation` | Create an immutable rule version | ADMIN |
| POST | `/channels/:id/automation/control` | Pause, resume, disable or emergency stop | ADMIN |
| POST | `/channels/:id/automation/run` | Start an idempotent run or dry run | EDITOR |
| GET | `/channels/:id/automation/schedule-preview` | Preview timezone-aware posting slots | VIEWER |
| GET | `/automation` | Read rule/run summaries and workflow counts | VIEWER |
| GET | `/automation/accounts` | Read safe account identity/status projections | VIEWER |
| GET | `/automation/approvals` | Read videos awaiting human approval | VIEWER |
| GET | `/automation/runs/:id` | Read an authorized workflow snapshot | VIEWER |
| POST | `/automation/runs/:id/cancel` | Cancel a run and settle its reservation | EDITOR |
| POST | `/automation/runs/:id/retry` | Retry under current budget/authorization | EDITOR |
| GET | `/budget-policy` | Read estimated USD limits | VIEWER |
| PUT | `/budget-policy` | Update estimated USD limits | ADMIN |
| GET | `/usage` | Read estimated usage and available billing data | VIEWER |
| GET | `/analytics/publications` | Read authorized publication metric summaries | VIEWER |
| GET | `/analytics/publications/:id/history` | Read snapshots for one authorized publication | VIEWER |
| POST | `/analytics/publications/:id/refresh` | Queue permitted metrics refresh | EDITOR |
| POST | `/analytics/publications/:id/metrics` | Import a manual metrics snapshot | EDITOR |
| GET | `/analytics/recommendations` | Read scoped recommendations/evidence | VIEWER |
| POST | `/analytics/recommendations/:id/decision` | Accept/reject a human-reviewed recommendation | EDITOR |
| GET | `/analytics/experiments` | Read experiment drafts and results | VIEWER |
| POST | `/analytics/experiments` | Create a review-required experiment draft | ADMIN |
| POST | `/analytics/experiments/:id/approve` | Approve an experiment hypothesis and variants | ADMIN |
| POST | `/analytics/experiments/:id/assign` | Assign only eligible approved variants | EDITOR |
| POST | `/analytics/recommendations/refresh` | Recalculate from recorded observations | EDITOR |
| GET | `/analytics/sync-runs` | Read authorized analytics refresh history | VIEWER |

External source verification reports `NOT_CONFIGURED` or `ACCESS_NOT_APPROVED`; no live API calls run until a verified adapter exists. `MANUAL` sources accept user-supplied imports. `MOCK_FIXTURE` is synthetic demo data, disabled in production. Sync changes create a PostgreSQL run and outbox event in one transaction; Redis/BullMQ delivery is repeatable by outbox event ID.

## Phase 3 media routes

The production API derives workspace scope from the authenticated session and membership. Mutations use `Idempotency-Key`; queue requests create the production run, render job and outbox event in one PostgreSQL transaction. Request and response bodies are Zod-validated. `POST /candidates/:id/produce` accepts only an approved candidate with current rights and safety review. `GET /production-runs/:id` reports stages and progress; failed runs can be retried by an administrator. Scripts are fetched and edited at `/stories/:id`; `POST /stories/:id/regenerate` creates a new version. `POST /stories/:id/audio` requests selected segment narration. `GET /voice-profiles` and `GET /video-templates` report configured options. `GET/POST /backgrounds` lists or uploads attested static images. `GET /videos`, `GET /videos/:id`, and `POST /videos/:id/render` manage outputs. `POST /videos/:id/reviews` records an idempotent, audited reviewer decision and rechecks rights and safety before approval. `GET /media/:id` streams an authorized asset; append `?download=1` for a private attachment.

Rendered outputs enter `READY_FOR_REVIEW` with `reviewStatus=PENDING` until a reviewer records a decision. The current API uses the existing workspace-local content-addressed object store; it does not issue public URLs or implement an R2 adapter.

## Phase 5 automation and analytics

Automation mutations are workspace-scoped, role-checked, Zod-validated and idempotent. Rule edits create immutable versions; each run persists its configuration and control-version snapshot with the workflow, budget reservation and outbox event in one PostgreSQL transaction. Workers recheck membership, rights, approvals, pause/stop state and reservations at stage boundaries. Dry runs do not reserve budget or enqueue production. `GET /automation` includes current controls, authorized account labels, workflow summaries, usage estimates and the pending approval queue.

Only configured estimates and measured units are reported. Provider charges remain `null` when unavailable; estimates are not billed amounts. Metric snapshots retain provider, scope, period, freshness and availability metadata. Incompatible platform scopes are not combined. Manual snapshots require an observation time and an explicitly available metric. Live analytics adapters require verified account capabilities and remain disabled by default.

Recommendations include sample counts and evidence snapshots. Experiment creation starts in a review-required state; assignment accepts separate eligible and explicitly approved variants, and small samples do not declare a winner. These controls do not create a provider connection or authorize publication. The current checkout's publication route remains blocked pending Phase 4 adapters/authorization; the automation worker may only exercise the explicitly labeled mock path in development/test.

## Example import request
```json
{
  "workspaceId": "current-workspace-uuid",
  "source": {"platform": "MANUAL", "canonicalUrl": "https://example.org/owned-story"},
  "title": "Example story", "body": "Story content", "comments": [{"externalId": "c1", "body": "Comment"}],
  "rights": {"basis": "OWNED", "commercialAllowed": true, "allowedPlatforms": ["YOUTUBE", "FACEBOOK"], "attestation": true}
}
```
Even if `workspaceId` is present, reject if caller lacks membership. Validate URL/rights, normalize, dedupe, return resource ID + warnings.

## Example publication request
```json
{
  "videoId": "uuid",
  "targets": [{"socialAccountId": "uuid", "scheduledAt": "2026-11-02T10:00:00Z", "privacy": "public"}]
}
```
Validate approved render and rights, capability, consent and title; transactionally persist publication + outbox, return 202 with IDs/status. Remote posting occurs asynchronously.
