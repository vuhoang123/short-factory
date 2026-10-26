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
| POST | `/videos/:id/reviews` | Approve/reject review | REVIEWER |
| GET | `/videos/:id` | Video/manifest/asset details | VIEWER |
| POST | `/social-accounts/oauth/:provider/start` | Start connect | ADMIN |
| GET | `/social-accounts/oauth/:provider/callback` | Handle callback | OAuth flow |
| POST | `/publications` | Create scheduled per-target job | EDITOR + rights gate |
| POST | `/publications/:id/retry` | Retry after state validation | ADMIN |
| GET | `/publications` | Filter scheduled/states | VIEWER |
| GET | `/analytics/overview` | Aggregates where permitted | VIEWER |
| GET | `/audit-logs` | Sensitive actions | ADMIN |
| POST | `/takedowns` | Register/remove request | ADMIN |

External source verification reports `NOT_CONFIGURED` or `ACCESS_NOT_APPROVED`; no live API calls run until a verified adapter exists. `MANUAL` sources accept user-supplied imports. `MOCK_FIXTURE` is synthetic demo data, disabled in production. Sync changes create a PostgreSQL run and outbox event in one transaction; Redis/BullMQ delivery is repeatable by outbox event ID.

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
