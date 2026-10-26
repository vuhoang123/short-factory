# 04 — Durable Workflows

## Production state machine
`DISCOVERED → SCORED → SCRIPT_READY → AUDIO_READY → RENDERED → REVIEW_PENDING → APPROVED → READY_TO_PUBLISH`.
Alternative terminal/hold states: `REJECTED`, `BLOCKED_RIGHTS`, `BLOCKED_POLICY`, `CANCELLED`, `FAILED_PERMANENT`; transient: `FAILED_RETRYABLE` retaining failed step identity.
All transitions validated server-side and audit logged. Never make rights approval implicit when state moves to rendered.

## Publishing state machine (per account)
`DRAFT → SCHEDULED → QUEUED → UPLOADING → PROCESSING → PUBLISHED`; `NEEDS_ACTION`, `FAILED_RETRYABLE`, `FAILED_PERMANENT`, `CANCELLED` as applicable. Platform capabilities checked before transition to QUEUED.

## Worker/job envelope
```
{jobId, workspaceId, entityId, step, version, idempotencyKey, traceId, attempt, scheduledAt}
```
Use state/version optimistic locking, transactional outbox, deterministic idempotency keys (`workspace:entity:step:version`), persisted outputs and object checksums. Worker acknowledgments only after durable DB state.

## Scheduler
Database selects due `SourceConfig` or `Publication` rows using `FOR UPDATE SKIP LOCKED` or equivalent; create outbox event in same transaction. A queue relay publishes once/more; consumer remains idempotent. Respect provider rate limits, per-tenant concurrency and daily spend ceilings.

## Recovery
- Failures classified transient/permanent/action_required; exponential backoff with jitter for eligible retry.
- Unknown remote publication result: reconcile operation/upload session/remote post before any resend.
- Stuck leases have recovery jobs; DLQ visible in UI; manual retry requires authorization.
- Job payloads contain IDs, not raw private post/comment or tokens.

## Review gates
Rights status + allowed destination + privacy/content policy + media QC + creator consent (when required) must all pass. The API and worker both enforce pre-publish checks; no UI-only guards.

## Example E2E fixture
`manual post + 3 comments → dedupe → candidate → script with sourceRefs → mock voice/cues → mock/test renderer → review approval → mock Youtube publication + TikTok needs_action`. Assert no duplicate publications on replay and deny when rights unknown.
