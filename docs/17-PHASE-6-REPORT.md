# Phase 6 — Ổn định export local

Đợt rà soát UI bổ sung sau Phase6 được ghi riêng tại [18-UI-STABILITY-REPORT.md](18-UI-STABILITY-REPORT.md); số liệu bên dưới giữ snapshot kiểm chứng của phase.

Ngày kiểm chứng: **28/10/2026**, Windows + WSL Ubuntu. Phạm vi OWNER xác nhận: lịch sử render, hủy/timeout, phục hồi job và kiểm thử cho luồng local. Không xác nhận Phase 4/5 hoặc sản phẩm production đã hoàn tất.

## Hành vi đã triển khai

- `/export` có lịch sử theo workspace, lọc trạng thái, phân trang và mở lại lượt từ tab mới. Lượt đang chạy tự cập nhật tiến độ; lỗi timeout có giải thích và admin có thể retry. Lỗi tải bài không che mất phần điều khiển run.
- API history/detail lấy workspace từ session/membership. Cursor tenant khác trả 404. Cancel yêu cầu OWNER/ADMIN/EDITOR, strict `{}`, idempotency key và ghi audit trong transaction. QUEUED/RUNNING/FAILED_RETRYABLE có thể hủy; cancelled lặp lại an toàn; completed/terminal khác trả 409. Không thu hồi video đã hoàn tất bằng cancel.
- Renderer chạy trong child process riêng. Abort/deadline bao phủ bundle, browser và encode; parent thu dọn owned process tree và file tạm trước khi hoàn tất cleanup. Worker quan sát DB cancellation/lease/control và fence stage/progress/failure theo attempt. Request outbox cũ không ghi đè hoặc tiêu hao budget của explicit retry mới.
- Bundle được phục vụ qua server `127.0.0.1` trên cổng OS cấp, dùng chung cho selection/render, tránh nhầm sang ứng dụng khác qua `localhost` IPv6. Khi worker disconnect lúc browser/server đang khởi động, cleanup chờ handle tới muộn; acquisition treo có fallback chỉ dọn process tree thuộc child.
- Worker đối chiếu PostgreSQL lúc startup và mỗi vòng relay. Sau grace `max(30 giây, 2 × relay interval)`, missing delivery được phát lại bằng cùng outbox ID/version. Row locks/CAS/Serializable transaction và durable recovery counters giới hạn phục hồi. Giữ nguyên waiting/delayed/active jobs, lease còn hạn và terminal states. Exhaustion được ghi lỗi thay vì retry vô hạn.
- Discovery phục hồi manual-import scoring và queued/retrying synthetic sync. Replay SUCCEEDED/PARTIAL/FAILED/CANCELLED sync là no-op, tránh duplicate metrics.

## Cấu hình và chạy

Không thêm migration hoặc JavaScript dependency. Docker media-worker bổ sung `procps` để fallback dọn đúng descendant processes trên Unix; Docker image chưa được build lại trên máy này. Giữ nguyên dữ liệu ứng dụng và Redis; không reset/flush shared services. API và worker cần restart để nhận code/env mới.

```dotenv
MEDIA_RENDER_TIMEOUT_MS=600000
MEDIA_CANCEL_POLL_MS=1000
```

Deadline cho phép 1.000–3.600.000 ms; poll 100–10.000 ms. `MEDIA_MAX_RENDER_SECONDS` vẫn chỉ giới hạn độ dài media. Recovery dùng batch/relay/retry config hiện có, không thêm scheduler service.

```powershell
pnpm local:export
```

Mở [http://127.0.0.1:3000/export](http://127.0.0.1:3000/export). Setup và hướng dẫn nhập bài/quyền/giọng Việt ở [16-LOCAL-EXPORT.md](16-LOCAL-EXPORT.md). Launcher dùng script deterministic, eSpeak local và không chạy automation/publishing.

## Kết quả kiểm chứng

| Gate | Kết quả |
|---|---|
| Lint toàn repository | PASS |
| Strict TypeScript root + workspace | PASS, 13/13 packages |
| Unit/contract/regression | **161/161 PASS**, 27 files |
| PostgreSQL integration | **64/64 PASS**, 7 files, dedicated `_test` DB |
| Build | **13/13 PASS**, có `/export` |
| Export browser suite | **6/6 PASS**: approvals, lost-response retry, reload, dedup/threshold, role/mobile, history/filter/pagination/resume/cancel/errors |
| Root browser suite | **2/2 PASS**: registration/import/dedupe/rights/workspace isolation và mobile dashboard |
| Recovery fault injection | PASS: xóa đúng delivered job trong queue ngẫu nhiên, competing sweepers chỉ phục hồi một event, version/tenant/lease/terminal guards; manual candidate scoring phục hồi |
| Actual render cancellation | PASS QUEUED và RUNNING; run cancelled, lease được nhả, không completed asset; **2.814 ms** từ yêu cầu hủy đang render đến cleanup acknowledgement |
| Actual render timeout | PASS `MEDIA_RENDER_TIMEOUT`, deadline cấu hình **1.000 ms**, tổng stage/cleanup observation **2.969 ms** |
| Browser startup/disconnect cleanup | PASS regression pending server/browser acquisition, cancel/disconnect và owned-tree fallback trên Windows/Unix; numeric loopback URL không dùng nhầm app khác |
| Explicit retry sau timeout | PASS: attempt **2**, SUCCEEDED, human review và authenticated attachment download |
| Review code | Code reviewer + TypeScript reviewer: stale-event P1 đã đóng; không còn finding có căn cứ trong scope |

Smoke Phase6 cuối dùng API thật → PostgreSQL → outbox/BullMQ → child render thật, với **3 bình luận**, lịch sử **3 run**, MP4 **1080×1920/30 FPS, H.264/AAC, 44.501 ms, 2.899.866 bytes**, tổng thời gian **148.830 ms**. Audio của fault smoke là **MOCK_TEST_TONE**, không dùng để khẳng định giọng đọc. Bằng chứng giọng Việt eSpeak thật và UI render/playback trước Phase6 được giữ riêng tại V01 trong pre-audit và báo cáo local export. Đã inspect lại MP4 tải về sau smoke; timeout 1 giây thực sự dừng child.

Artifacts ignored: `test-results/phase6-smoke.json`, `test-results/phase6-smoke.mp4`, browser traces/screenshots khi fail; baseline local artifacts giữ nguyên. Không log private source text/secrets. Smoke giữ synthetic fixtures trong dedicated test DB; child processes do smoke tạo được dừng trong `finally`.

Các lệnh đã/chạy để tái kiểm chứng:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build --concurrency=1
pnpm test:browser
pnpm --filter @shorts-factory/web exec playwright test --config playwright-local-export.config.ts
pnpm smoke:phase6
```

Trên máy này dùng binary Node trực tiếp cho lint/typecheck/Vitest/Turbo/Playwright, tương đương các scripts trên. Integration runner và smoke cần `TEST_DATABASE_URL` trỏ database đã migrate có tên kết thúc `_test`, cùng Redis local. Smoke dùng queue name ngẫu nhiên, Chrome/Chromium và mock providers; không gọi provider trả phí/publishing. Không chạy Next dev/build đồng thời trên cùng `.next`.

CI đã thêm export browser suite, Chromium path cho renderer, `smoke:phase6` và upload `test-results/`. **Remote CI chưa chạy/xác minh** trong lượt này. Turbo cảnh báo output trống ở các task `tsc --noEmit`; build vẫn exit 0. Root browser config dùng Chrome/Edge có sẵn trên Windows hoặc executable override, và output directory riêng để giữ artifacts của suite khác.

Verification đã phát hiện và sửa lỗi renderer dùng `localhost` truy cập nhầm Next server qua IPv6, cùng race cleanup khi browser startup chưa trả handle. Cả hai có regression tests; smoke sau toàn bộ bản sửa cuối đã PASS khi launcher tắt. Một lượt unit/build chạy đồng thời với renderer bị Windows process exit/fast-fail; full unit và build chạy lại tuần tự (`--concurrency=1` cho Turbo) đều PASS, không ghi lượt lỗi đó thành kết quả xanh. Root browser lượt đầu thiếu Chromium đúng revision; chạy lại với Chrome đã cài đạt 2/2.

### Ảnh giao diện (API mock, không thay bằng chứng render thật)

![History/resume và xác nhận hủy](../test-results/local-export-browser/phase6-history-cancel.png)

![Export trên mobile 390×844](../test-results/local-export-browser/phase6-mobile.png)

## Files thay đổi của Phase 6

| Nhóm | Files |
|---|---|
| API | `apps/api/src/{app,production.service,production.validation}.ts`; `apps/api/test/{production-operations.test,api.integration.test}.ts` |
| UI | `apps/web/components/local-export.tsx`; `apps/web/test/local-export-ui.spec.ts` |
| Render | `packages/media/src/{render,render-child,render-child.test,render-control.test}.ts`; `workers/media/src/{config,pipeline,cancellation.test}.ts` |
| Recovery | `workers/media/src/{main,outbox,outbox.test,recovery,recovery.test,recovery.integration.test}.ts`; `workers/discovery/src/{main,outbox,pipeline,recovery,recovery.test,recovery.integration.test,replay.test}.ts` |
| Verification/config | `scripts/smoke-phase6.ts`, `package.json`, `playwright.config.ts`, `.env.example`, `.github/workflows/ci.yml`, `infrastructure/Dockerfile` |
| Docs | `README.md`, `docs/{07-API,08-DELIVERY-PLAN,16-LOCAL-EXPORT,17-PHASE-6-REPORT}.md`, `docs/audits/{PRE_PHASE_6_AUDIT,OWNER_ACTION_CHECKLIST}.md` |

Working tree còn có các files local-export baseline chưa commit từ lượt trước; bảng này chỉ phân loại phần Phase6, không ngụ ý toàn diff là thay đổi mới của phase này.

## Giới hạn còn lại

- Không reclaim RUNNING synthetic source sync vì chưa có durable lease/fence cho sync đó; manual-import path cần cho local export đã có recovery.
- Owned static server dùng helper `RenderInternals.prepareServer` của Remotion đang pin; cần giữ regression numeric-host/cleanup khi nâng phiên bản renderer.
- Chưa có hard CPU/RAM quotas, multi-host/fresh-host/load/soak/backup restore verification. Recovery phụ thuộc PostgreSQL và worker hoạt động; không hứa hoàn tất trong thời gian cố định khi service ngừng.
- G04/G05 Studio upload, paid-manual budget G06, client idempotency ngoài `/export`, full QC/retention/production infra vẫn còn trong audit. Launcher local không gọi paid providers.
- Facebook/Threads link chỉ là nguồn tham chiếu; vẫn phải cung cấp nội dung và quyền sử dụng. Live fetching, OAuth/social posting, live analytics, paid providers và R2 chưa được bật hoặc xác minh; giữ `BLOCKED_EXTERNAL` ở tích hợp tương ứng.

**Trạng thái: HOÀN TẤT phạm vi Phase6 local đã được OWNER xác nhận.** Các gate local nêu trên đã PASS. Production/social integrations và các giới hạn được liệt kê riêng không được đánh dấu shipped.

Sau verification đã restart `local:export` với code mới. Web `/health`, `/export` và API `/health` trả 200; unauthenticated history trả 401. Web/API/discovery/media worker đang hoạt động tại loopback local, giữ nguyên dữ liệu. Route `/export` yêu cầu đăng nhập trước khi sử dụng.
