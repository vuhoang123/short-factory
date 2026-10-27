# 10 — UI routes and behaviors

- `/dashboard` cards for discovered candidates, pending review, queued publications, job failures, daily budget and last sync.
- `/channels` list/detail with topic rules, language, automation, linked social destinations.
- `/sources` add/edit authorized source, configure keywords/hashtags/topics/language/frequency, verify access, trigger demo sync, and inspect run/error history.
- `/library/posts` switch between all source posts and scored candidates; filter by platform/topic/score, inspect metrics/comments/score factors/source provenance/rights, and approve or reject candidate state after review gates.
- `/studio` approved-candidate and comment selection, channel/voice/template/subtitle/background settings, grounded script editor with reorder and version comparison, audio preview, durable stage/progress display, completed MP4 preview/download and reviewer approve/reject actions. Background upload records an explicit ownership/license/consent attestation. Mock TTS is labeled as a test tone.
- `/reviews` approval queue; rights evidence, citations, side-by-side text/script differences, publish eligibility summary.
- `/publishing` calendar + per-platform publication list, scheduled/published/needs-action/failures, safe retry.
- `/accounts` official OAuth connection, scope/capability indicators, disconnect, privacy controls.
- `/autopilot` channel rule editor and version, manual/run-once/daily/weekly modes, time zone/posting windows, candidate freshness and ranking, target accounts, budget estimates, run history, stage errors, dry run, pause/resume/disable/emergency stop and reviewer queue. Full automatic mode shows its authorization and QC blockers.
- `/analytics` metric availability and freshness, platform-specific scopes, publication history, content cohorts, recommendation evidence, human decisions, and paused experiment drafts/assignments. Missing provider data stays visibly unavailable instead of being plotted as zero.
- `/settings` workspace members, channel topic rules and minimum scores, policy, audit and takedown.

Accessibility: keyboard operation, loading/empty/error states, accessible modal labels, small mobile-friendly navigation. Use clear simulated-data labels in dev.
