# User workflows

## Main path: existing permitted content

1. Open Discover, filter and inspect original text/comments. Potential score is a ranking estimate, not a promise of performance.
2. In the same detail, review recorded rights/evidence and explicitly approve eligible use if authorized. Select the candidate after rights/safety/score checks. Unknown/expired/revoked rights remain blocked.
3. Send to Studio. The exact candidate/source remains selected across the handoff; no automatic render occurs.
4. Choose comments, voice and basic style. Generate a script draft in the existing durable production pipeline, without TTS/video rendering.
5. Edit source-grounded hook/commentary and ordering; exact quoted comments remain grounded. Inspect script/layout, optionally generate segment audio previews; advanced styling/background/template settings stay optional.
6. Explicitly render the saved story. Show human-readable progress and retry/cancel actions where permitted. Refresh/revisit by run ID resumes the same job.
7. Preview actual MP4, review captions/narration/rights, then explicitly approve output. Download or open Publish for the available handoff. Generation success alone is REVIEW, not APPROVED.

## Manual Facebook/Threads path

Open Studio → paste/import existing manual workflow. The URL is a source reference; the user supplies authorized text/comments. Reuse dedupe, rights and local speech behavior. Existing `/export` URLs keep working. A BELOW_THRESHOLD item explains its recorded score and policy; it is not silently exempted because export is local. Changing a configuration does not retroactively rescore a stored candidate.

## Bulk work

Select a bounded set from the current Discover page and inspect them. “Open in Studio” creates a worklist, not background rendering. Candidate approval is an explicit separate action only for already rights-approved eligible items, with confirmation and per-item result/error. Each write retains server authorization and idempotency. Do not bulk attest unknown rights or publish by selecting checkboxes.

## Failure and recovery

FAILED shows a user-oriented explanation and the existing authorized retry route; cancelled work requires a new request unless its existing workflow explicitly allows retry. Jobs continue independently of the browser. Old responses/timers cannot restore an earlier selection/workspace. Repeated requests retain operation keys when payload is unchanged. No queue, provider or outbox concepts are required to operate the common UI; technical detail remains expandable.

## Review, publish and analysis

Human review is the default before any external publication. Milestone 1 exposes existing account/publication state and approved media handoff; live OAuth, scheduling and retry/reconciliation of real publishing are later milestones. No click in the new UI simulates a successful external publish. Analytics retains observed/manual/mock labels, missing values and sample evidence. Recommendations are advisory and never automatically applied.

## Roles and privacy

OWNER/ADMIN can complete the whole permitted local flow. EDITOR can produce/edit; REVIEWER can make rights/output decisions; VIEWER reads permitted data. UI hints do not replace server checks. Workspace selection is a security boundary: clear prior content while switching; stale session success/error/401 must not overwrite the current selection. No raw source text goes into browser persistent storage, job envelopes or audit logs.
