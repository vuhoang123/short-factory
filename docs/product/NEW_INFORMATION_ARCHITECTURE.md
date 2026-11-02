# New information architecture

Design: editorial production desk. Preserve the current restrained green/ink palette and readable typography; use a clear worklist + detail canvas, a persistent next action and progressive advanced controls. No decorative motion, all navigation keyboard accessible and responsive.

| Primary area | Canonical route | Main job | Secondary/legacy access |
|---|---|---|---|
| Overview | `/dashboard` | Pipeline, review tasks, recent video work, failed operations, honest publishing/performance summary | Existing counters retained as supporting data |
| Discover | `/discover` | Search/filter source content, inspect original/comments/rights, select one or several items | `/library/posts`, `/reviews`, `/sources` remain available from Settings/tools |
| Studio | `/studio` | Source context, script/voice/captions/background/template, preview, render, version history and output approval | Direct manual input available here; `/export` remains compatible |
| Publish | `/publish` | Approved output handoff, connected account status and publishing limitations | Full calendar/composer/OAuth/replacement engine deferred; never fabricate a publish |
| Analytics | `/analytics` | Existing performance/trends/evidence and recommendations | Preserve nullable metrics and review-required experiments |
| Settings (separate) | `/settings` | Workspace/access, source/channel/policy configuration, automation and guide links | Channels, Sources, Rights reviews, Autopilot and Guide remain linked and functional |

Route inputs: Studio accepts validated source-post selection(s), production run or video IDs. They are references, not authorization; every load/write rechecks active workspace on the server. Invalid IDs produce a useful error instead of loading unrelated content. Workspace changes clear local selections and drafts.

Content detail appears in Discover and the Studio source context using the same component. Sections are original, comments, rights/score and next action. Technical diagnostic IDs/stages are behind details. A blocked item explains the exact reason and links to the appropriate settings/review action.

Discover selection is an editorial worklist. Sending to Studio does not approve rights, enqueue renders or publish. Bulk candidate review requires explicit user review confirmation, known approved rights and per-item eligibility; failed items remain visible. Queue size and page scope are stated.

Studio defaults to local configured speech, existing templates and a short duration. Generating a script is distinct from rendering video. A layout/script preview can be approximate and labeled accordingly; only actual rendered media is offered as MP4. Saved versions remain immutable. Legacy full-generation export remains available for users who want that path.

Publish in Milestone 1 is an honest handoff area: current account/publication records and approved video download, with `BLOCKED_EXTERNAL`/not implemented labels for unavailable connections/scheduling. This is not a completed calendar or publishing engine.
