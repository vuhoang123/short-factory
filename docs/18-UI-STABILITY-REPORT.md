# Kiểm tra và sửa giật UI — 28/10/2026

Phạm vi: toàn bộ web workspace hiện có, tập trung effect/state, refresh, polling và chuyển workspace. Đây là đợt sửa ổn định sau Phase6 local, không mở một delivery phase mới.

## Kết quả rà soát

Đã duyệt 11 routes: `/dashboard`, `/channels`, `/sources`, `/library/posts`, `/reviews`, `/studio`, `/export`, `/autopilot`, `/analytics`, `/settings`, `/guide`. Rà thêm login, workspace shell, loading/error và các shared hooks.

Browser chạy với API local thật và synthetic workspace không thấy vòng lặp vô hạn khi đứng yên: không có request lặp ngoài polling chủ động, không có lỗi maximum-update-depth hoặc overflow desktop. Hai lần mount/fetch ban đầu trong Next development Strict Mode được phân biệt với vòng lặp liên tục. Không tắt Strict Mode để che lỗi.

Các tình huống thao tác đã tái hiện trước khi sửa bằng regression tests:

| Lỗi | Sửa |
|---|---|
| Refresh topic rules tháo editor khỏi DOM, mất bản nháp/focus và làm đổi chiều cao trang | Giữ nội dung đã tải khi refresh cùng resource; chỉ dùng skeleton khi chưa có dữ liệu. Áp dụng các list ở dashboard/channels/sources/library/reviews/settings/Studio/analytics |
| Autopilot interval tiếp tục gửi request khi request trước còn pending: 3 requests trong cửa sổ test | Shared hook chỉ schedule poll tiếp sau khi request hoàn tất; abort request và clear timer khi đổi resource/rời trang |
| Refresh `/auth/me` cùng workspace tháo toàn bộ trang về “Opening your workspace…” | Giữ session/page trong lúc refresh; vẫn clear nội dung khi chuyển workspace hoặc hết session |
| Response session A cũ về sau khi đã switch B làm UI quay về nhãn A | Request epoch fence cả success/error/401; vô hiệu hóa request cũ trước switch/logout và khi unmount |
| Studio tiếp tục fetch production run CANCELLED, và một timeout còn chạy sau navigation | CANCELLED là terminal; lưu/clear timeout, abort GET khi cleanup |
| Poll detail lỗi 503 dừng luôn; retry FAILED_PERMANENT không chạy lại detail đã terminal | Schedule nối tiếp sau lỗi, error riêng được xóa khi phục hồi; successful retry/cancel làm mới detail bằng revision |

## Thay đổi

- `apps/web/lib/use-resource.ts`: hợp nhất ba hook fetch trùng; scope dữ liệu theo path/schema, serial polling, cleanup và abort.
- `apps/web/lib/api.ts`: nhận optional AbortSignal, giữ Zod validation và idempotency cho mutations.
- `apps/web/components/{workspace-page,story-studio,phase5-shared,autopilot-dashboard,analytics-dashboard,app-shell,local-export}.tsx`: dùng hook chung, giữ DOM khi refresh nền, cleanup GET effects và session fencing.
- `apps/web/test/{ui-stability.spec,phase5-ui.spec}.ts`, `apps/web/test/fixtures/workspace.ts`: 10 ca ổn định mới và tái sử dụng fixture Phase5. Các ca export cũ giữ nguyên.
- `apps/web/playwright-ui.config.ts`, `package.json`, `.github/workflows/ci.yml`: `pnpm test:ui` chạy stability + Phase5 + export, CI dùng cùng suite. Không thêm dependency hoặc migration.

Các schema dùng trong dependency effect đều là hằng cấp module. Polling vẫn cập nhật tiến độ theo lịch; không thêm deep equality hoặc memo hóa khắp ứng dụng khi chưa có bằng chứng cần thiết.

## Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| 10 stability browser tests mới | PASS; gồm 11-route idle, giữ draft/DOM, request chậm, abort/navigation, terminal/cancel, 503 recovery, retry, refresh session, tenant switch, stale response và 401 |
| Duyệt lại với API/DB local thật sau sửa | PASS 11/11 routes bằng synthetic workspace: không thêm DOM mutation khi idle, không overflow, không gọi lặp ngoài poll `/automation` định kỳ; session fetch không tăng theo mỗi route |
| Toàn bộ mocked UI suite | **19/19 PASS**: 10 stability + 3 Phase5 + 6 local export, Chromium/Chrome, một worker |
| Web unit tests | 14/14 PASS |
| ESLint apps/web, strict TypeScript web và root | PASS |
| Production build | PASS 13/13 workspace packages, gồm Next build và route `/export` |
| Code + TypeScript review | Đã đóng findings session race và Autopilot recovery/retry; không còn finding có căn cứ trong scope |

Lệnh tái kiểm chứng:

```powershell
pnpm test:ui
pnpm --filter @shorts-factory/web typecheck
pnpm exec eslint apps/web
pnpm exec vitest run apps/web
pnpm build --concurrency=1
```

Đặt `LOCAL_EXPORT_UI_BASE_URL=http://127.0.0.1:3000` để dùng app local đang chạy; nếu không đặt, suite tự mở Next dev ở cổng 3006. Không chạy Next dev/build đồng thời trên cùng `.next`. Các lượt thực tế dùng binary Node trực tiếp tương đương scripts trên. Trace/screenshot khi fail ở `test-results/ui-browser/`; audit thật trước/sau ở `test-results/ui-audit.json` và `test-results/ui-audit-after.json` (ignored). Console có một resource 404 trong audit thật, không phải lỗi React update-depth; không dùng số liệu này để khẳng định console hoàn toàn sạch.

App local đã restart sau build tại `http://127.0.0.1:3000`; dữ liệu và quyền hiện có được giữ nguyên. Cấu hình CI đã cập nhật nhưng chưa có remote CI run được xác minh trong lượt này.

## Bổ sung: giải thích nút tạo MP4 bị khóa

Sau khi người dùng báo nút tạo video không bấm được, đã thêm `localExportBlockers()` và danh sách lý do liên kết bằng `aria-describedby` dưới nút. Các gate quyền/an toàn/vai trò/xác nhận/kênh/giọng/trạng thái được giữ; điểm thiếu hoặc dưới ngưỡng bị chặn rõ ràng. Không sửa điểm, ngưỡng, quyền hay trạng thái bài trong DB. Kiểm chứng bổ sung: **12/12 local-export unit tests**, **6/6 export browser tests**, ESLint và web TypeScript PASS; code/TypeScript review không còn finding.

## Giới hạn

Đã kiểm tra routes và các nhánh có gây giật được tái hiện; chưa khẳng định mọi dialog và tổ hợp dữ liệu/người dùng đều được bao phủ. Remote CI, browser khác Chrome, production load/soak và nâng chất lượng media không thuộc lượt này. Không chạy lại render/paid providers/publishing vì không sửa pipeline backend/media. Dữ liệu ứng dụng và các thay đổi Phase6 trước đó được giữ nguyên.
