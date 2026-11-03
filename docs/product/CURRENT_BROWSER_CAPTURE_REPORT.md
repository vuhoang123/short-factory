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
- `pnpm lint` and root/API/web/discovery TypeScript checks passed. `pnpm exec turbo run build --force`: **13/13 successful**, no cached tasks.

The browser extension test exercises real extension capture/bridge behavior with a synthetic Studio receiver. Separate API/DB tests validate upload persistence, idempotency, authorization and durable enqueue. It does not claim a real Facebook account or a full real-service capture-to-video run; the unchanged screenshot renderer has its prior real MP4 evidence.

## Limits

The user must load the extension once; websites cannot install it automatically. No real Facebook account has been used in automated tests. Platform markup, group access, account login or browser policy can still prevent capture. Only loaded, uniquely matched comments are considered; the app does not promise all comments or bypass controls. Existing rights review and publishing gates remain unchanged.

Changed files: API content/routes and capture integration tests; shared capture contracts; discovery capture/inbox cleanup; current-browser UI/message helper and tests; extension files/build/test scripts; local setup; source/API/local guides and audit references. The media renderer/audio model are unchanged by this follow-up.

## Disabled capture button follow-up — 2026-11-03

The reported popup had a checked confirmation box and an empty source line. That state means the extension has no pending Studio request; the old popup incorrectly showed the generic wrong-tab guidance. A Studio page opened before installation also lacked the injected bridge. Reloading extension files could leave an invalidated bridge that still falsely answered PING.

Extension **1.0.1** distinguishes missing request, expiry, cancellation, completion, missing Studio, wrong tab, changed source and unverified share redirect. It checks the live Studio job/request marker before enabling capture. PING now verifies the actual extension runtime. The popup offers an explicit recovery button: open Studio with a validated source prefill, or reopen only the exact requested source. Confirmation alone never starts or unlocks an unbound capture.

For a closed/stale Studio, recovery includes the existing job/request identity. The authenticated UI first reads the durable job and matches the server-owned current-browser source; only then does it reconnect the extension. The existing source tab and loaded comments are reused. No second capture job is created. Foreign workspaces, mismatched sources and expired jobs cannot be rebound.

The prepared runtime directory has been updated to 1.0.1. The user must click Reload in `chrome://extensions` / `edge://extensions`, then reload Studio. No installed browser extension or account session was changed automatically.

Verification:

- `node --test scripts/capture-popup.test.mjs`: **4 passed**.
- `pnpm exec vitest run apps/web/lib/browser-capture.test.ts`: **5 passed**.
- `node scripts/test-capture-extension.mjs`: **passed**, including no-request diagnosis, exact-tab/share recovery, stale Studio reconnection without another source tab, and 12 actual PNGs from an owned post + 5 comments. Zero external network requests. Evidence: `test-results/current-browser-extension/evidence.json`, `popup-no-request.png`.
- `LOCAL_EXPORT_UI_BASE_URL=http://127.0.0.1:3000 pnpm --filter @shorts-factory/web exec playwright test --config playwright-ui.config.ts local-export-ui.spec.ts`: **17 passed**, including allowed/mismatched/foreign-workspace reconnection with no new capture mutation.
- PostgreSQL `apps/api/test/source-capture.integration.test.ts` using configured `TEST_DATABASE_URL`: **7 passed**, including source metadata only for the requesting owner and live current-browser jobs.
- `pnpm lint`, API/web typechecks and `git diff --check`: **passed**. Initial UI/DB runs failed while local services were stopped; reruns passed after startup with the configured test database.

Runtime repair: another workspace owns port 3001. `scripts/local-export.mjs` now honors `API_PORT` and passes the matching `API_URL` to Web. This machine's ignored `.env` uses 3004; Web remains at 3000 and the other workspace was left running. Web/API/speech/capture health checks all return 200. Restart with `pnpm local:export`; on another machine keep the default API port unless it is occupied.

Changed files for this fix: `browser-extension/{background,bridge,protocol,popup}.js`, popup markup, manifest/README; web browser-capture helper/component/unit and UI tests; API capture status/integration tests; extension test script and popup unit script; local launcher; API/capture documentation. No real Facebook account was used in verification; live platform markup and the user's manual extension reload remain outside these synthetic tests.
