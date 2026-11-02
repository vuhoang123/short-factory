# Xuất video local từ bài Facebook/Threads

Luồng tối thiểu: **link nguồn + nội dung bài/bình luận → duyệt quyền → chọn bài → giọng đọc local + phụ đề → render MP4 → xem và tải về**. Không cần API key hoặc tài khoản developer. Link chỉ lưu nguồn tham chiếu; ứng dụng chưa tự lấy bài/bình luận từ Facebook/Threads. Script sử dụng bộ dựng deterministic, không gọi LLM trả phí.

## Chạy trên máy hiện tại

Môi trường đã được chuẩn bị trong lượt triển khai ngày 28/10/2026:

- Node 22.18, dependencies từ lockfile và Prisma Client.
- PostgreSQL 16 trong WSL Ubuntu: database ứng dụng `shorts_factory_local`, database kiểm thử `shorts_factory_local_test`. Không dùng/xóa các thư mục dữ liệu PostgreSQL cũ trên Windows.
- Redis riêng cổng 6380, chỉ bind localhost, có password và AOF. Config private trong WSL tại `/var/lib/shorts-factory-local-redis/redis.conf`.
- eSpeak NG trong WSL Ubuntu để đọc tiếng Việt; Chrome trên Windows để render.
- `.env` ignored lưu endpoint/secret local ngẫu nhiên. Không đưa nội dung file này lên Git hoặc chat.

Trong PowerShell tại thư mục repository:

```powershell
pnpm local:export
```

Mở [http://127.0.0.1:3000/export](http://127.0.0.1:3000/export). Giữ cửa sổ lệnh hoạt động trong khi render. `Ctrl+C` dừng web/API/discovery/media worker được launcher khởi chạy, giữ nguyên dữ liệu PostgreSQL/Redis và video. Nếu ứng dụng đang chạy sẵn, dùng URL hiện tại thay vì mở launcher thứ hai.

Launcher ép origin web `http://127.0.0.1:3000` và API `http://127.0.0.1:3001` cho các tiến trình con để cookie/Origin nhất quán, kể cả `.env` cũ dùng `localhost`. Nó chọn `SCRIPT_PROVIDER=mock`, `TTS_PROVIDER=local`, `PUBLISHER_PROVIDER=mock` và tắt live analytics. Nó không chạy automation worker, không gọi API provider trả phí và không đăng video. Launcher không tự cài packages, tạo database hay áp migration khi khởi động.

## Cách dùng lần đầu

1. Chọn **Create account** tại màn hình đăng nhập, tạo tài khoản local bằng mật khẩu riêng. Không có mật khẩu demo chung.
2. Nếu chưa có workspace, vào **Settings** để tạo; người tạo có role OWNER.
3. Vào **Channels** tạo kênh ngôn ngữ `vi`. Với kênh biên tập thủ công, chủ động chọn ngưỡng phù hợp; có thể chọn `0` để tự duyệt mọi bài an toàn có quyền. Điểm thấp không bị tự động bỏ qua; đặt ngưỡng trước khi nhập.
4. Mở **Xuất video** (`/export`). Dán link HTTPS Facebook/Threads, tiêu đề, nội dung bài và tối đa 8 bình luận, mỗi dòng một bình luận.
5. Chọn đúng cơ sở quyền, lãnh thổ, nền tảng và ghi công nếu cần. License/consent phải có evidence. Xác nhận bạn có thẩm quyền sử dụng cả bài và bình luận. Public link không tự cấp quyền tái sử dụng.
6. Bấm **Lưu bài để kiểm tra**. Đọc bản đã lưu và các bình luận. Nếu trùng bài, hệ thống giữ bản cũ và quyền cũ, không ghi đè bằng dữ liệu vừa dán.
7. Tích xác nhận đã đọc bản lưu, bấm **Duyệt quyền bản lưu**, rồi **Xác nhận chọn bài**. Các bước này cần OWNER/ADMIN/REVIEWER; tạo video cần OWNER/ADMIN/EDITOR. OWNER/ADMIN có thể làm toàn luồng.
8. Chọn giọng eSpeak NG tiếng Việt và độ dài mục tiêu; bấm tạo video. Theo dõi stage/progress. Có thể reload cùng tab để tiếp tục theo dõi; chỉ IDs/fingerprint của thao tác được lưu trong sessionStorage theo user/workspace.
9. Xem video, duyệt output sau khi xem rồi tải **MP4**. Video có nền template sẵn, không bắt buộc upload background. Có thể mở Studio để chỉnh script/template thêm.

Giọng eSpeak NG là giọng tổng hợp offline, chất lượng cơ bản. Thời gian phụ đề ở mức approximate, chưa phải forced alignment. Độ dài là mục tiêu; độ dài thực dựa trên phần lời đọc. Đường tải media vẫn kiểm tra session, workspace và quyền nguồn hiện hành.

## Cấu hình tay

Các giá trị không nhạy cảm của máy hiện tại:

```dotenv
APP_URL=http://127.0.0.1:3000
API_URL=http://127.0.0.1:3001
API_HOST=127.0.0.1
API_PORT=3001
STORAGE_LOCAL_ROOT=.data/objects
SCRIPT_PROVIDER=mock
TTS_PROVIDER=local
TTS_WSL_DISTRO=Ubuntu
LOCAL_RUNTIME_WSL=Ubuntu
REMOTION_BROWSER_EXECUTABLE=C:\Program Files\Google\Chrome\Application\chrome.exe
MEDIA_RENDER_CONCURRENCY=1
```

Giữ `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL` trong `.env` private. `TTS_WSL_DISTRO` chỉ bật eSpeak qua WSL trên Windows; `LOCAL_RUNTIME_WSL` cho phép launcher khởi động PostgreSQL và Redis local đã được cấu hình như trên. Không đặt biến thứ hai khi DB/Redis do Docker hoặc dịch vụ khác quản lý.

Kiểm tra giọng trước khi render:

```powershell
wsl --distribution Ubuntu --exec espeak-ng --version
```

Nếu thiếu eSpeak NG ở một máy khác, cài trong distro phù hợp (`sudo apt install espeak-ng`). Không dùng chung `node_modules` native giữa Windows và Linux.

## Cài mới trên máy khác

Phương án Docker Compose hiện hữu có PostgreSQL/Redis và media image có eSpeak NG/Chromium:

```powershell
pnpm install --frozen-lockfile
pnpm local:up
```

File `.env` mới do `local:up` tạo dùng `TTS_PROVIDER=local`. Nếu `.env` đã có từ bản cũ và còn `TTS_PROVIDER=mock`, sửa riêng biến này thành `local`; giữ nguyên credentials. Trong container Linux, không đặt `TTS_WSL_DISTRO`/`LOCAL_RUNTIME_WSL`. Sau đó mở cùng `/export`. Cần Docker engine hoạt động; lượt này kiểm chứng thực tế bằng WSL, chưa build lại Docker images.

Với PostgreSQL/Redis đã cấu hình tay: cài dependencies, chạy `pnpm db:generate`, kiểm tra đúng database trước `pnpm db:deploy`, rồi `pnpm local:export`. Launcher chỉ consume môi trường, không tự sửa credentials/database.

## Lịch sử, hủy và phục hồi — Phase 6

Trong `/export`, **Lịch sử tạo video** hiển thị các lượt của workspace hiện tại, có lọc trạng thái và phân trang. Bấm **Mở lượt tạo** để theo dõi lại hoặc xem/tải kết quả từ tab mới. Chỉ IDs và fingerprint thao tác được lưu trong sessionStorage; lịch sử nằm ở PostgreSQL.

OWNER/ADMIN/EDITOR có thể bấm **Hủy lượt tạo** rồi **Xác nhận hủy** khi lượt đang chờ/chạy/có thể retry. Worker dừng render và thu dọn tiến trình con; lượt đã hoàn tất không bị hủy. OWNER/ADMIN có thể **Thử lại lượt tạo lỗi**; lượt CANCELLED cần tạo lượt mới.

`MEDIA_RENDER_TIMEOUT_MS=600000` là hạn wall-clock cho bundle, mở browser và encode; khác `MEDIA_MAX_RENDER_SECONDS` là giới hạn độ dài video. `MEDIA_CANCEL_POLL_MS=1000` điều chỉnh nhịp kiểm tra cancel. Sau khi sửa env, restart launcher. Timeout hiển thị `MEDIA_RENDER_TIMEOUT`; không tăng hạn để xử lý lỗi quyền nguồn.

Khi Redis mất một delivery đã relay, worker đối chiếu PostgreSQL lúc khởi động và mỗi vòng relay. Sau grace tối thiểu 30 giây, delivery thiếu được phát lại bằng cùng outbox ID, có bộ đếm phục hồi giới hạn. Worker không chiếm lease còn hạn hoặc khởi động lại lượt cancelled/terminal. Phục hồi local manual-import scoring cũng được hỗ trợ. Chi tiết kiểm chứng và giới hạn ở [báo cáo Phase 6](17-PHASE-6-REPORT.md).

## Khi có lỗi

- Không có giọng `vi`: kiểm tra `TTS_PROVIDER=local`, distro đúng và eSpeak NG đã cài; restart API/media worker sau khi sửa env.
- `TTS_LOCAL_WSL_PROVIDER_UNAVAILABLE` hoặc `TTS_LOCAL_WSL_PROVIDER_FAILED`: kiểm tra lệnh eSpeak trên và khả năng WSL truy cập ổ đĩa Windows chứa thư mục temp.
- Chờ chấm điểm quá lâu: discovery worker, Redis và outbox phải chạy. Bấm tải lại trạng thái sau khi khôi phục worker.
- Nút **Tạo video MP4** bị khóa: đọc mục **Chưa thể tạo video** ngay dưới nút. UI liệt kê bước duyệt, xác nhận bản lưu, vai trò, kênh/giọng hoặc cờ an toàn còn thiếu.
- `BELOW_THRESHOLD`: điểm thấp hơn ngưỡng lưu lúc chấm điểm thì chưa thể chọn bài/tạo video, kể cả quyền đã APPROVED. Chọn ngưỡng phù hợp khi tạo kênh thủ công trước khi nhập bài mới. Bài cũ cần được chấm lại qua workflow phù hợp; hiện chưa có nút đổi kênh/chấm lại trong `/export`. Nhập lại cùng link/nội dung sẽ giữ candidate cũ và không gỡ khóa này.
- `BLOCKED_RIGHTS`/cờ nhạy cảm: xem quyền nguồn/thời hạn/phạm vi/PII, không sửa database để vượt gate.
- Render chậm: giữ concurrency `1`, đóng bớt chương trình nặng. Render 1080×1920 thực tế có thể mất vài phút.
- Cổng 3000/3001 đã dùng: dùng instance sẵn hoặc dừng đúng launcher trước khi chạy lại. Không xóa/reset database hay Redis để xử lý lỗi cổng.

## Phạm vi chưa bật

Tự đọc link Facebook/Threads, cloud R2, AI/TTS trả phí và đăng mạng xã hội chưa thuộc luồng local này. Các quyền/provider tương ứng vẫn `BLOCKED_EXTERNAL` hoặc chưa triển khai như báo cáo audit. Luồng này không đánh dấu Phase 4/5 hoàn tất.

## Kết quả baseline local export trước Phase 6 — 28/10/2026

Các số liệu dưới đây là V01. Gate hiện tại sau history/cancel/timeout/recovery được ghi tại [báo cáo Phase6](17-PHASE-6-REPORT.md): 161 unit tests, 64 integration tests, 8 browser tests và actual smoke PASS.

Thay đổi chính:

- Web: màn hình `/export`, form tiếng Việt, validation link/nội dung/quyền, chuẩn hóa Facebook permalink, explicit approvals, retry giữ cùng idempotency key và tiến độ theo user/workspace.
- API: filter candidate theo `sourcePostId`, luôn giữ predicate workspace; có regression test và cross-workspace API integration case.
- Media: cache theo segment, bộ audio cố định cho từng run/rendition/model, khôi phục checkpoint cũ, chặn comment bịa qua narration type, thêm eSpeak NG tiếng Việt qua WSL.
- Runtime: `scripts/local-export.mjs`/`pnpm local:export`, defaults local speech cho `.env` mới của Compose, hướng dẫn cấu hình. Không thêm migration hoặc đổi dependency/lockfile.

| Kiểm tra | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile` + Prisma Client generate | PASS; lockfile giữ nguyên |
| Prisma validate + 5 migrations trên DB local mới | PASS; không reset dữ liệu cũ |
| Unit/contract tests | **116/116 PASS**, 20 files |
| PostgreSQL integration suite | **59/59 PASS**, 5 files, DB riêng `_test` |
| Strict TypeScript + lint | PASS, 13 workspace packages và root |
| Build | **13/13 PASS**, có route `/export`; Turbo có cảnh báo outputs ở các package `tsc --noEmit` |
| Mocked Playwright export suite | **3/3 PASS**: approval, retry cùng key, reload, dedup/threshold và mobile/role |
| eSpeak NG qua WSL thật | PASS, tạo WAV tiếng Việt offline |
| API → PostgreSQL → outbox/BullMQ → media → review → authenticated download | PASS, 3 bình luận, MP4 **1080×1920/30 FPS, 36,971 giây, 2.503.980 bytes** |
| Giao diện thật → cùng backend/worker → reload → preview → duyệt → tải MP4 | PASS, 3 bình luận, **1080×1920, 35,669 giây, 2.405.111 bytes**; 0 page errors; mobile 390×844 không tràn ngang |
| Phát MP4 tải về trong Chrome | PASS, đã decode 95 frames và phát qua giây thứ 3 |
| Review code | Code reviewer và TypeScript reviewer đã rà soát; permalink identity/origin launcher đã sửa |

Artifacts kiểm chứng nằm trong `test-results/` (ignored): `local-export-smoke.mp4`, `local-export-smoke.json`, `local-export-browser.mp4`, `local-export-browser.json`. Hai MP4 đã được đối chiếu lại từ immutable object store sau lượt test Phase6; metadata vẫn khớp kích thước/độ dài V01. Ảnh history/cancel và mobile hiện tại ở `test-results/local-export-browser/`, được chụp từ suite UI mock Phase6. Fixture accounts/workspaces tổng hợp được giữ trong DB local mới để kiểm tra; không dùng dữ liệu Facebook/Threads thật hoặc publish. Browser tests mock không được dùng thay cho kết quả full flow thật nêu riêng ở trên.

Các lệnh verification thực tế dùng binary Node trực tiếp để tránh bootstrap package manager ngoài dự kiến; tương đương `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`. Chạy suite UI với `pnpm --filter @shorts-factory/web exec playwright test --config playwright-local-export.config.ts`; đặt `LOCAL_EXPORT_UI_BASE_URL=http://127.0.0.1:3000` khi dùng app đang chạy. Không chạy Next dev/build đồng thời trên cùng `.next`.
