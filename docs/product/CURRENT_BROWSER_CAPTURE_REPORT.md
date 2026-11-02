# Current Chrome/Edge capture — 2026-11-02

The owner requested that the login/open button use the browser already running Studio. The default now opens a source tab in that Chrome/Edge window and uses its existing Facebook/Threads login through an explicitly installed extension. No separate browser launches from the default button. The dedicated browser remains an advanced alternative.

## User flow

1. On this machine, the prepared extension folder is `E:/Workspaces/short-factory/.data/source-capture/extension`. On a new machine run `pnpm local:capture:setup` first.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, select **Load unpacked**, and choose that folder. Installation is a manual browser action; it is not performed silently by the app.
3. Reload Studio. Paste the post link and select **Mở bài trong trình duyệt hiện tại**. The extension opens the source in the same browser/profile and binds the capture to that exact tab.
4. Expand the post and load the desired comments. On the source tab click the extension, confirm the source and choose **Chụp và gửi về Studio**. Keep the source and Studio tabs open. The small popup can close while the job runs.
5. Return to Studio, review actual source/masked images and rights, then use the existing script/voice/render/download flow.

Without the extension, the button still opens the URL in a native new tab, but only for viewing; it does not falsely start a capture job or launch the dedicated browser. Setup guidance is shown in place.

## Implementation

`browser-extension/` contains the owned Manifest V3 shell, local page bridge, popup, tab identity rules and screenshot orchestration. `scripts/build-capture-extension.py` copies that shell and generates selectors/geometry from the hash-verified local `ai-comment` checkout into the ignored runtime folder. The engine's code is not checked in or redistributed as part of this feature.

Permissions are `activeTab`, `debugger`, `storage`, `webNavigation`, plus host access only to the two Studio localhost origins at port 3000. There is no cookies permission, `<all_urls>` host access, profile extraction, browser relaunch or remote debugging port. Chrome/Edge displays its debugger banner while the selected source tab is attached. The extension captures actual element PNGs, masks identified author headers, restores viewport/scroll, and detaches in `finally`. Source-tab navigation and Facebook share redirects are checked to avoid capturing an unrelated page.

The local page bridge validates origin, window, request and job identity. PNGs are uploaded one at a time and acknowledged only after the API accepts them. The final text/comment snapshot is likewise acknowledged after durable submission. Browser storage holds pending IDs/link/tab identity, never source text, image bytes or credentials.

The API creates current-browser jobs in `WAITING_BROWSER`; it does not queue worker collection or open a browser. The authenticated requesting editor alone can upload screenshots and submit the result in their current workspace. Unique image IDs, immutable checksums, count/byte bounds, source identity and membership are validated. The final submission and queue outbox event commit together. Existing capture persistence produces source images with UNKNOWN/PENDING rights, then reuses the proven original-image renderer.

Waiting jobs expire after 30 minutes. Studio and extension cancellation close the durable job. Terminal/expired input copies are cleaned through outbox/media deletion; takedown-before-cleanup is covered, including the erased legacy mode case. Job status never exposes an uncommitted raw snapshot, and staged upload assets cannot be downloaded through the public media route.

## Validation

- TypeScript unit/contract suite: **203 passed**, including current-browser URL/message/PNG decoding checks.
- PostgreSQL integration: **74 passed**, including current-browser staging, replay, missing-image/source mismatch, foreign workspace denial, no dedicated-browser calls, cancellation/expiry, and takedown-before-cleanup.
- UI checks include current-browser bridge → reload → PNG/result acknowledgment → rights review, absent-extension native tab opening with no job mutation, foreign-message rejection, and cancellation from either UI.
- Code review found and resolved cleanup after takedown and popup cancellation propagation. No unresolved high/medium findings in the reviewed flow.

- Chromium UI suite: 30/31 passed in the full run; the remaining existing Studio polling test timed out at `Opening your workspace…` and passed on an isolated rerun. All **31 cases** are verified, including the four new current-browser paths. The transient hydration delay was not reproduced in the isolated check.
- `node scripts/test-capture-extension.mjs`: **passed with the unchanged production extension manifest** in a fresh Chromium profile. It opened the bound source tab, read the owned synthetic DOM, captured 1 post + 5 comments / 12 actual PNGs, sorted reacts `[90,70,50,30,10]`, acknowledged all image/result messages, restored viewport, detached its debugger, and made zero external network requests. Evidence: `test-results/current-browser-extension/evidence.json` and image/result files.
- `pnpm lint` and root/API/web/discovery TypeScript checks passed. Build results are recorded after the final build below.

The browser extension test exercises real extension capture/bridge behavior with a synthetic Studio receiver. Separate API/DB tests validate upload persistence, idempotency, authorization and durable enqueue. It does not claim a real Facebook account or a full real-service capture-to-video run; the unchanged screenshot renderer has its prior real MP4 evidence.

## Limits

The user must load the extension once; websites cannot install it automatically. No real Facebook account has been used in automated tests. Platform markup, group access, account login or browser policy can still prevent capture. Only loaded, uniquely matched comments are considered; the app does not promise all comments or bypass controls. Existing rights review and publishing gates remain unchanged.

Changed files: API content/routes and capture integration tests; shared capture contracts; discovery capture/inbox cleanup; current-browser UI/message helper and tests; extension files/build/test scripts; local setup; source/API/local guides and audit references. The media renderer/audio model are unchanged by this follow-up.
