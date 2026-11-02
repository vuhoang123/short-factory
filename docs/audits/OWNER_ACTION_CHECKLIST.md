# ACTION REQUIRED FROM PROJECT OWNER

Cập nhật sau local export và kiểm chứng Phase6: **28/10/2026 — Asia/Saigon**. Repository: `E:\Workspaces\short-factory`; base commit `cbe7099af609e21d72d38b69aeced0e4fd6f99b7`, các thay đổi local/Phase6 còn trong working tree chưa commit. Phạm vi local đã hoàn tất; bằng chứng và phần chưa kiểm chứng ở [báo cáo Phase6](E:/Workspaces/short-factory/docs/17-PHASE-6-REPORT.md).

Đây là checklist **quyền sở hữu, cấp quyền dịch vụ và quyết định của chủ dự án**, không phải danh sách việc lập trình. Những lỗi/code còn thiếu thuộc CODEX trong báo cáo kỹ thuật. Không yêu cầu gửi secret qua chat.

**Cách đọc:** `CHƯA XÁC MINH` nghĩa là repository/môi trường audit không cung cấp bằng chứng; không có nghĩa tài khoản của OWNER chưa tồn tại. Các mục `[x]` chỉ xác nhận quyết định/môi trường local đã chứng minh; account/cloud/API approval bên ngoài vẫn chưa xác minh. `P0`: cần trước khi vận hành thật phạm vi đã chọn; `P1`: cần trước khi bật nền tảng tương ứng; `P2`: có thể hoãn. Local manual + local speech không bắt buộc API key trả phí, R2, Reddit, Meta hay TikTok.

## A — Bắt buộc để hệ thống chạy thực tế

### O01 — Chốt phạm vi vận hành, nguồn nội dung và trần chi phí

- [x] **Phạm vi local đã xác nhận:** Facebook/Threads provenance + nội dung thủ công, giọng Việt offline, human review và tải MP4. Phase6 local reliability đã được OWNER chọn.
- [ ] **P0 khi mở rộng · ngân sách/provider/nền tảng production vẫn CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** toàn hệ thống, Phase 1–5. **Dependency:** không.
- **Vì sao cần OWNER:** quyết định sản phẩm, quyền chi tiêu, nền tảng/tài khoản được phép dùng không thể suy ra từ code.
- **Bằng chứng:** [quyết định còn mở](E:/Workspaces/short-factory/docs/09-DECISIONS-AND-RISKS.md:17); [paid Autopilot đang bị chặn](E:/Workspaces/short-factory/packages/workflows/src/pipeline.ts:117).
- **Các bước:** 1. Chọn giai đoạn đầu: manual import → local speech → review → tải MP4. 2. Chỉ định kênh/ngôn ngữ/người duyệt và nền tảng ưu tiên. 3. Ghi trần USD/ngày/tháng, loại nội dung loại trừ và điều kiện được phép dùng API trả phí.
- **Thông tin/cấu hình:** lựa chọn không nhạy cảm; `/channels`, `/settings`, `/autopilot` và budget policy. Các con số trong app là ước tính, chưa phải hóa đơn.
- **Xác minh:** CODEX đối chiếu rule/version, dry run không phí; chưa bật paid job trước khi sửa budget manual và hoàn thiện accounting.
- **URL:** không cần dịch vụ ngoài.
- **Có thể bỏ qua?** Không cho vận hành thật; demo tổng hợp có thể tiếp tục.

### O02 — Cấp môi trường thực thi và quyền truy cập hạ tầng

- [x] **Môi trường local đã chạy:** Node/dependencies/Prisma, WSL PostgreSQL16, Redis6380, eSpeak NG tiếng Việt, DB ứng dụng và DB riêng *_test; full MP4 export PASS.
- [ ] **P0 trước production · hosting/backup/restore/IAM production CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** máy chạy API/web/workers, PostgreSQL, Redis; Phase 1–5. **Dependency:** O01.
- **Vì sao cần OWNER:** phải chọn tài nguyên thuộc sở hữu, chấp thuận chi phí và cấp quyền; CODEX chịu trách nhiệm cấu hình/deploy sau đó.
- **Bằng chứng:** [Compose chỉ local](E:/Workspaces/short-factory/infrastructure/compose.yaml:1); lượt local sau audit đã có `.env` private, DB/Redis riêng và [bằng chứng export](E:/Workspaces/short-factory/docs/16-LOCAL-EXPORT.md:1). Docker chưa có, nhưng WSL đáp ứng local; không cần OWNER cài Docker để dùng baseline hiện tại.
- **Các bước:** 1. Chọn máy local có tài nguyên render hoặc hosting được phép dùng. 2. Cấp PostgreSQL/Redis và một DB kiểm thử riêng tên kết thúc `_test`; xác nhận DB nào được phép tạo/cleanup fixture trong lượt kiểm thử sau. 3. Cấp quyền triển khai có giới hạn và chốt ngân sách/tài nguyên.
- **Thông tin/cấu hình:** endpoint không nhạy cảm, vùng lưu trữ, quyền vận hành; secret đưa vào secret manager/private environment. Biến hiện có: `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL`, `STORAGE_LOCAL_ROOT`.
- **Xác minh:** CODEX kiểm health, migrations trong DB thử nghiệm, recovery và backup/restore theo X06/X09/X17. Không tự chạy migrate vào DB đang dùng.
- **URL:** [Docker Desktop Windows](https://docs.docker.com/desktop/setup/install/windows-install/) là tài liệu cài đặt nếu chọn local; khả năng engine trên máy vẫn chưa xác minh.
- **Có thể bỏ qua?** Local không còn bị chặn; phần production có thể hoãn khi chỉ dùng local.

### O03 — Xác nhận quyền đối với bài gốc và bình luận

- [ ] **P0 · OWNER/người được ủy quyền duyệt · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** mọi nguồn; production, approval và publishing. **Dependency:** O01.
- **Vì sao cần OWNER:** Codex không thể cấp license/consent thay tác giả hoặc xác nhận sự thật của bằng chứng.
- **Bằng chứng:** [server rights review](E:/Workspaces/short-factory/apps/api/src/content.service.ts:167); fixture OWNED chỉ là dữ liệu mẫu, không chứng minh quyền đối với nội dung thật.
- **Các bước:** 1. Chọn nội dung tự sở hữu hoặc có phép rõ ràng, gồm quyền bình luận cần dùng. 2. Lưu giấy phép/đồng ý, phạm vi thương mại, nền tảng, lãnh thổ, thời hạn và attribution. 3. Nhập vào Library, người có role REVIEWER/ADMIN xác nhận tại `/reviews`; loại thông tin nhận dạng không cần thiết.
- **Thông tin/cấu hình:** evidence/reference phù hợp trong rights form; không đưa giấy tờ cá nhân dư thừa vào chat.
- **Xác minh:** eligibility cho đúng destination; UNKNOWN/expired/revoked phải bị từ chối ở API/worker.
- **URL:** hợp đồng/chứng cứ từ chủ quyền cụ thể; không có trang web chung cấp quyền tái sử dụng.
- **Có thể bỏ qua?** Không cho nội dung thật; có thể dùng fixture tổng hợp để kiểm thử.

### O04 — Cung cấp media nền và tài sản có quyền sử dụng

- [ ] **P0 nếu dùng tài sản ngoài · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** background, ảnh/video/nhạc/font của Phase 3. **Dependency:** O03 và sửa X05; X15 nếu license yêu cầu attribution nền.
- **Vì sao cần OWNER:** cần lựa chọn tài sản và giấy phép sử dụng thương mại từ bên có quyền.
- **Bằng chứng:** [background upload](E:/Workspaces/short-factory/apps/api/src/production.service.ts:54), [image processing](E:/Workspaces/short-factory/packages/media/src/background.ts:1). Hiện chỉ ảnh PNG/JPEG/WebP; không có thư viện video nền đã xác minh license.
- **Các bước:** 1. Chọn ảnh tự sở hữu hoặc có license phù hợp. 2. Giữ nguồn/evidence và yêu cầu attribution. 3. Upload tại Studio sau khi lỗi metadata tiếng Việt được CODEX sửa; duyệt hình/narration/output.
- **Thông tin/cấu hình:** ảnh và attestation/evidence ở `/studio`; video nền phải chờ X15, không tải gameplay bên thứ ba tùy tiện.
- **Xác minh:** ảnh thuộc workspace đúng, rights còn hiệu lực, nếu license yêu cầu attribution nền, phải chờ CODEX bổ sung contract/render ở X15 trước khi dùng; upload hiện chỉ ghi basis/attestation/evidence.
- **URL:** nguồn cấp phép thực tế do OWNER chọn; chưa xác minh nhà cung cấp.
- **Có thể bỏ qua?** Baseline /export dùng nền template sẵn, không bắt buộc cung cấp background ngoài. Nếu dùng tài sản ngoài vẫn cần license và attribution tương ứng.

### O05 — Chốt người duyệt, xử lý dữ liệu và yêu cầu gỡ bỏ

- [ ] **P0 trước nội dung thật · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** membership, editorial, retention/takedown; Phase 1–5. **Dependency:** O01/O03.
- **Vì sao cần OWNER:** quyết định ai được duyệt, thời hạn lưu, người nhận yêu cầu xóa và phạm vi sử dụng là trách nhiệm vận hành.
- **Bằng chứng:** [takedown local](E:/Workspaces/short-factory/apps/api/src/content.service.ts:200), [data policy](E:/Workspaces/short-factory/docs/05-SOURCES.md:21). Chưa có chứng cứ policy production; remote removal/retention scheduler còn thuộc CODEX.
- **Các bước:** 1. Chỉ định OWNER/ADMIN/EDITOR/REVIEWER và kênh tiếp nhận yêu cầu gỡ. 2. Chốt thời hạn lưu bài, audio, video, audit và chứng cứ quyền. 3. Đăng ký tài khoản của người dùng được phép; cấp role tại Settings; duyệt nội dung/PII trước khi dùng thật.
- **Thông tin/cấu hình:** danh sách vai trò và policy không nhạy cảm; `/settings`, `/reviews`; hiện chưa có UI chỉnh retention policy hoàn chỉnh.
- **Xác minh:** hai người/role thử các action được phép và bị cấm; takedown local chặn media; remote removal chờ X16.
- **URL:** trang chính sách riêng của dự án sau khi có domain, chưa tồn tại trong repo.
- **Có thể bỏ qua?** Không trước nội dung thật; có thể hoãn policy công khai cho demo nội bộ tổng hợp.

### O06 — Cấp domain/DNS và xác nhận nhận diện ứng dụng

- [ ] **P0 trước public deployment; P1 cho OAuth · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** domain registrar/DNS, hosting, OAuth consent; Phase 4–5. **Dependency:** O02.
- **Vì sao cần OWNER:** quyền domain, nội dung nhận diện/legal/contact và thay đổi DNS cần chủ sở hữu.
- **Bằng chứng:** [APP_URL local](E:/Workspaces/short-factory/.env.example:26); [local deployment](E:/Workspaces/short-factory/infrastructure/compose.yaml:90). Không có domain/HTTPS production được kiểm chứng.
- **Các bước:** 1. Chọn domain thuộc quyền quản lý. 2. Cấp quyền DNS giới hạn hoặc thực hiện record do CODEX chuẩn bị. 3. Xác nhận tên app, contact, privacy/terms và chính sách đăng ký. 4. Sau X10, đăng ký redirect URI chính xác do implementation cung cấp.
- **Thông tin/cấu hình:** domain, app name/contact; `APP_URL`, `API_URL`, `ALLOW_REGISTRATION`. Tên biến OAuth chưa được code, không tự đặt `GOOGLE_CLIENT_SECRET` rồi kỳ vọng chạy.
- **Xác minh:** HTTPS hợp lệ, cookie Secure/Origin, callback exact-match trên staging do CODEX kiểm.
- **URL:** console DNS của nhà cung cấp do OWNER chọn; chưa xác minh tài khoản cụ thể.
- **Có thể bỏ qua?** Có cho local; không cho public/OAuth production.

### O07 — Cấp quyền secret manager và tài khoản vận hành

- [ ] **P0 trước OAuth/paid production · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** secret manager/KMS của hosting đã chọn. **Dependency:** O02.
- **Vì sao cần OWNER:** cấp IAM, quyền đọc/rotate secret và quyền chi tiêu thuộc account owner.
- **Bằng chứng:** [SocialAccount.secretRef](E:/Workspaces/short-factory/prisma/schema.prisma:598), [resolver hiện tại chỉ env reference](E:/Workspaces/short-factory/packages/workflows/src/analytics.ts:34). Chưa có KMS/OAuth lifecycle.
- **Các bước:** 1. Chọn secret store của hạ tầng. 2. Cấp quyền đọc tối thiểu cho runtime phù hợp, tách staging/production. 3. Nạp secret trực tiếp tại console/private environment sau khi CODEX hoàn thiện X10; thống nhất rotation/revocation.
- **Thông tin/cấu hình:** secret reference/IAM identity, không secret plaintext. Hiện analytics hiểu `env:ANALYTICS_TOKEN_*`; env phải được runtime inject an toàn, không commit.
- **Xác minh:** token không nằm trong DB/log/UI, role không được phép không đọc được secret; rotate/revoke được kiểm thử.
- **URL:** console của secret store do OWNER chọn; chưa chọn nên chưa có URL cụ thể được xác minh.
- **Có thể bỏ qua?** Local mock/local speech có thể; production OAuth/paid API không.

## B — Bắt buộc để sử dụng đầy đủ các nền tảng đã chọn

### O08 — Google Cloud, OAuth và quyền kênh YouTube

- [ ] **P1 · OWNER quản lý kênh · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** YouTube Data/Analytics API; Phase 4–5. **Dependency:** O06/O07, CODEX X10/X11.
- **Vì sao cần OWNER:** tạo/xác minh app và chấp thuận truy cập kênh là thao tác danh tính/account.
- **Bằng chứng:** [publisher chỉ mock](E:/Workspaces/short-factory/packages/publishers/src/index.ts:1); [analytics scopes thật trong code](E:/Workspaces/short-factory/packages/analytics/src/index.ts:138). Không có OAuth callback hay account connect UI.
- **Các bước:** 1. Tạo/chọn Cloud project và bật API cần dùng. 2. Cấu hình branding, audience/test users, consent, scopes tối thiểu và OAuth web client. 3. Sau X10, thêm redirect URI chính xác và cấp consent bằng chủ kênh. 4. Hoàn thành verification/audit nếu console/chính sách áp dụng yêu cầu; giữ bằng chứng.
- **Thông tin/cấu hình:** project ID, channel ID, client ID, granted scopes và trạng thái review; secret qua O07. Chưa có biến OAuth hoạt động hoặc trang Accounts để kết nối. Analytics cần `yt-analytics.readonly` + `youtube.readonly`; upload dùng quyền phù hợp của adapter sau X11.
- **Xác minh:** đọc identity/capability trước; upload thử chỉ sau O12. Không suy quyền từ flag DB.
- **URL:** [OAuth web-server](https://developers.google.com/youtube/data/guides/auth/server-side-web-apps), [consent](https://developers.google.com/workspace/guides/configure-oauth-consent), [videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert).
- **Có thể bỏ qua?** Có nếu chỉ export local. Không hardcode quota hoặc mặc định quy tắc private của tài liệu cũ.

### O09 — Meta app, quyền Facebook Page và Insights

- [ ] **P1 · OWNER có quyền Page/app · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** Facebook Page Reels/Insights; Phase 4–5. **Dependency:** O06/O07, X10/X11/X13.
- **Vì sao cần OWNER:** cần tư cách developer, quyền Page, consent và review từ Meta.
- **Bằng chứng:** [mock publisher](E:/Workspaces/short-factory/packages/publishers/src/index.ts:1); [Insights adapter](E:/Workspaces/short-factory/packages/analytics/src/index.ts:187). Không có Page thật/token/quyền đã xác minh.
- **Các bước:** 1. Tạo/chọn Meta developer app và Page được quản lý. 2. Xác định use case/Page role và quyền app cần theo phiên bản API hiện hành; làm verification/app review nếu được yêu cầu. 3. Sau X10, cấu hình callback và consent; sau X13, xác minh Insights metric mapping. 4. Lưu approval evidence, không chỉ đánh dấu flag.
- **Thông tin/cấu hình:** app/Page ID, API version, scope thực được cấp; secret qua O07. Code Insights hiện yêu cầu `read_insights`, `pages_read_engagement`; worker đã truyền mapping; metric names/units và API version thực tế vẫn chưa được live-verify. Chưa có biến OAuth Facebook hoạt động.
- **Xác minh:** đọc Page identity/capabilities và sample Insights được phép; test publish cần O12.
- **URL:** [mẫu Reels chính thức của Meta](https://github.com/fbsamples/reels_publishing_apis), [Reels guide](https://developers.facebook.com/docs/video-api/guides/reels-publishing/). Guide trả HTTP 429 khi audit nên **chưa xác minh danh sách permission hiện hành**.
- **Có thể bỏ qua?** Có, dùng YouTube/export. Facebook **Page** không đồng nghĩa Groups/profile.

### O10 — Quyết định nguồn Reddit và xin quyền sử dụng phù hợp

- [ ] **P1 nếu cần live Reddit · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** Reddit Data API; Phase 2. **Dependency:** O01/O03; X12 trước sync thật.
- **Vì sao cần OWNER:** thỏa thuận sử dụng dữ liệu/commercial approval thuộc chủ ứng dụng và Reddit.
- **Bằng chứng:** [ExternalSourceAdapter](E:/Workspaces/short-factory/packages/sources/src/index.ts:110). Credential và approval flag vẫn không tạo một live adapter.
- **Các bước:** 1. Xác định mục đích commercial, nguồn/phạm vi và retention. 2. Gửi yêu cầu qua cổng chính thức; hoàn thành thỏa thuận nếu Reddit yêu cầu. 3. Lưu quyền được cấp, điều kiện xóa/attribution và account authorization; đưa secret vào O07 sau X12.
- **Thông tin/cấu hình:** approval evidence và nguồn được phép; `REDDIT_ACCESS_TOKEN`, `REDDIT_DATA_USE_APPROVED` trong env example hiện là placeholder **inert**, không đủ để chạy.
- **Xác minh:** access test bằng adapter đã code, pagination/deletion/rate-limit trong scope được cấp; không dùng token cá nhân để né approval.
- **URL:** [Developer access](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data), [Data API Terms](https://redditinc.com/policies/data-api-terms).
- **Có thể bỏ qua?** Có, manual/licensed import thay thế.

### O11 — Threads và chiến lược dữ liệu Facebook Groups được phép

- [ ] **P1 nếu cần các nguồn này · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** Threads, licensed/user exports; Phase 2. **Dependency:** O03/O09 cho Meta app khi áp dụng; X12.
- **Vì sao cần OWNER:** quyền app/account, hợp đồng feed và quyền nội dung phải do chủ sở hữu xác nhận.
- **Bằng chứng:** [gates sources](E:/Workspaces/short-factory/packages/sources/src/index.ts:110), [source policy](E:/Workspaces/short-factory/docs/05-SOURCES.md:10). Không có network discovery client.
- **Các bước:** 1. Với Threads, xem capability/scope thực có trên app, chọn phần API được phép; không mặc định có toàn lịch sử/comments/search. 2. Với Facebook Groups, chọn nguồn do người dùng/admin cung cấp hợp lệ hoặc licensed feed. 3. Lưu consent/license và phạm vi dữ liệu; chuyển thông tin không nhạy cảm cho CODEX xây adapter tương ứng.
- **Thông tin/cấu hình:** nguồn/feed và scope đã được cấp; `THREADS_ACCESS_TOKEN`, `THREADS_APP_APPROVED`, `FACEBOOK_LICENSED_FEED_TOKEN`, `FACEBOOK_LICENSE_APPROVED` hiện là inert placeholders.
- **Xác minh:** adapter phải công bố capabilities và từ chối chức năng ngoài scope; manual import vẫn áp rights gate.
- **URL:** [Threads documentation](https://developers.facebook.com/docs/threads/), [Meta Groups API changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0/). Meta trả 429 trong audit: nội dung hiện hành **CHƯA XÁC MINH**.
- **Giới hạn:** repository xác định Groups API không phải đường discovery tổng quát; việc loại bỏ Groups API công khai là giới hạn nền tảng, không phải chỉ thiếu API key. Không đề xuất cookie/stealth/internal GraphQL/browser bypass.
- **Có thể bỏ qua?** Có, manual import; không có thao tác “xin một key Groups” để mở khả năng code đang thiếu.

### O12 — Chấp thuận từng phép thử API thật và publish có kiểm soát

- [ ] **P1 trước live acceptance · OWNER/người quản lý tài khoản · CHƯA ĐƯỢC CHO PHÉP trong audit này.**
- **Dịch vụ/chức năng:** từng provider, Phase 3–5. **Dependency:** các code gate X01–X14 tương ứng đã PASS; quyền platform O08–O11.
- **Vì sao cần OWNER:** user đã cấm phát sinh phí/publish thật khi chưa cho phép; cần chỉ định tài khoản và giới hạn rõ ràng.
- **Bằng chứng:** yêu cầu audit hiện tại; không có live run/remote post ID được kiểm chứng.
- **Các bước:** 1. Sau kết quả mock/fault-injection, chọn một account và media có quyền. 2. Cho phép rõ loại call, số lượng, ngân sách, privacy và thời điểm thử; tách read-only metrics với upload. 3. Duyệt preview rồi mới cho chạy live smoke; kiểm remote result trước mọi retry.
- **Thông tin/cấu hình:** approval không chứa secret, account ID, sample và budget. Chỉ bật capability sau khi kiểm quyền thực; không sửa flag để giả approval.
- **Xác minh:** ghi remote ID/session, read-back trạng thái, media QC, metric provenance, test timeout/reconcile không nhân bản upload.
- **URL:** endpoint docs của platform đã chọn trong O08/O09/O14; không có nút live test khả dụng trong checkout này.
- **Có thể bỏ qua?** Có khi chưa bật integration; không thể tuyên bố production-ready cho integration chưa thử.

### O13 — Xác định TikTok Direct Post có phù hợp hay giữ manual handoff

- [ ] **P1 cho quyết định TikTok; app Direct Post chỉ khi use case đủ điều kiện · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** TikTok; Phase 4–5. **Dependency:** O01/O03; CODEX X11 làm export.
- **Vì sao cần OWNER:** eligibility/product purpose, creator consent và review không thể giải quyết bằng code/key.
- **Bằng chứng:** [mock TikTok needs action](E:/Workspaces/short-factory/packages/publishers/src/index.ts:1); chưa có Direct Post hoặc export bundle riêng.
- **Các bước:** 1. Giữ tải MP4 và upload thủ công làm mặc định. 2. Đối chiếu mục đích sản phẩm với intended-use guideline; utility nội bộ đăng vào account của mình/đội có thể thuộc trường hợp không được chấp nhận. 3. Chỉ khi phù hợp mới tạo app, xin sản phẩm/scope, thực hiện audit và UX consent bắt buộc. 4. Nếu không phù hợp, ghi quyết định bỏ Direct Post.
- **Thông tin/cấu hình:** eligibility/audit evidence và quyết định handoff; hiện không có env TikTok Direct Post đang hoạt động.
- **Xác minh:** X11 tạo handoff rõ `NEEDS_ACTION`; direct post không được mở trước eligibility/consent và O12.
- **URL:** [TikTok Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines).
- **Có thể bỏ qua?** Có thể bỏ Direct Post lâu dài. Đây không đơn thuần là thiếu API key; tạo app không bảo đảm được duyệt.

### O14 — Cấp consent cho metrics đúng tài khoản và scope

- [ ] **P1 khi bật live analytics · OWNER/người quản lý account · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** YouTube Analytics, Facebook Insights, TikTok Display metrics; Phase 5. **Dependency:** O07, account/app phù hợp; X13.
- **Vì sao cần OWNER:** consent/entitlement dữ liệu của tài khoản và quyền provider không thể tự cấp.
- **Bằng chứng:** [live adapter gates](E:/Workspaces/short-factory/packages/analytics/src/index.ts:118), [secret injection](E:/Workspaces/short-factory/packages/workflows/src/analytics.ts:34). Không có token thực trong environment audit.
- **Các bước:** 1. Chọn account và metrics cần dùng. 2. Cấp quyền đọc tối thiểu bằng OAuth sau X10, kiểm scope thực. 3. Nạp token qua O07; duyệt read-only smoke qua O12. 4. Xác nhận metric definition, period và dữ liệu còn thiếu.
- **Thông tin/cấu hình:** `ANALYTICS_LIVE_ENABLED`, `SocialAccount.secretRef=env:ANALYTICS_TOKEN_...`, granted scopes/approval/CONNECTED sau khi được xác minh. Không tạo SocialAccount/quyền bằng SQL tay.
- **Xác minh:** snapshot provider/period/freshness đúng, null không biến thành 0; token expired/revoked bị chặn.
- **URL:** [YouTube reports](https://developers.google.com/youtube/analytics/reference/reports/query), [TikTok video query](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query). TikTok `video.list` cho metrics được ủy quyền là quyền khác với Direct Post.
- **Có thể bỏ qua?** Có, manual metrics sau khi có publication/handoff workflow; synthetic data không được coi là hiệu quả thật.

## C — Tùy chọn, có thể làm sau

### O15 — Chọn LLM/TTS trả phí, tài khoản và billing

- [ ] **P2; P1 nếu yêu cầu AI/speech provider thật · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** OpenAI script/TTS hiện có; Phase 3/5. **Dependency:** O01/O07 và CODEX X07 trước sử dụng có phí.
- **Vì sao cần OWNER:** mở account, payment, đồng ý xử lý nội dung và trần chi tiêu cần chủ tài khoản.
- **Bằng chứng:** [script adapter](E:/Workspaces/short-factory/packages/media/src/script.ts:70), [TTS adapter](E:/Workspaces/short-factory/packages/media/src/tts.ts:84). Không có `OPENAI_API_KEY` trong môi trường audit. Local speech tiếng Việt đã tạo WAV và MP4 thật qua WSL; mock tone không phải giọng đọc.
- **Các bước:** 1. Chọn dùng local speech hay paid provider. 2. Nếu trả phí, tạo project/key theo quyền tối thiểu và quản lý billing/budget. 3. Chọn model/voice được account hỗ trợ; đưa key trực tiếp vào secret store. 4. Chỉ cho phép smoke nhỏ sau X07/O12.
- **Thông tin/cấu hình:** `SCRIPT_PROVIDER=openai`, `SCRIPT_MODEL`, `TTS_PROVIDER=openai`, `TTS_MODEL`, `OPENAI_API_KEY`, `TTS_COST_PER_1K_CHARS`. Không cần tạo hai account nếu cùng provider.
- **Xác minh:** kiểm output grounded/speech/timing/usage; Autopilot hiện cố ý báo `PAID_PROVIDER_BUDGET_UNBOUNDED`, không mở bằng cách sửa approval flag.
- **URL:** [OpenAI quickstart](https://developers.openai.com/api/docs/quickstart).
- **Có thể bỏ qua?** Có, deterministic script + local TTS để kiểm luồng; không tương đương AI provider đã test thật.

### O16 — Chọn và cấp Cloudflare R2 nếu cần remote object storage

- [ ] **P2 cho local; P1 trước deployment dùng R2 · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** Cloudflare R2; Phase 3/production storage. **Dependency:** O02/O07 và CODEX X14.
- **Vì sao cần OWNER:** subscription, payment, bucket và IAM thuộc chủ account.
- **Bằng chứng:** [storage chỉ local fs](E:/Workspaces/short-factory/packages/media/src/index.ts:9); không có R2 adapter hoặc biến R2 được sử dụng.
- **Các bước:** 1. Chọn R2 hoặc lưu trữ production khác. 2. Nếu chọn R2, bật subscription và tạo bucket private riêng cho staging/production. 3. Tạo quyền object giới hạn bucket, thống nhất retention/access policy. 4. Cấp endpoint/bucket/reference cho CODEX sau khi adapter sẵn.
- **Thông tin/cấu hình:** account/bucket/endpoint và secret reference. **Chưa có tên env R2 hoạt động**; CODEX phải bổ sung contract/config trong X14, không yêu cầu OWNER sửa source.
- **Xác minh:** private read/write, checksum, workspace isolation, delete/takedown và restore; không public bucket tùy tiện.
- **URL:** [R2 Get started](https://developers.cloudflare.com/r2/get-started/).
- **Có thể bỏ qua?** Có cho local hoặc nếu chọn storage khác đáp ứng yêu cầu. Tạo bucket riêng không làm app hiện tại tự dùng R2.

## Bằng chứng hoàn tất cần lưu

Mỗi mục chỉ đổi thành `[x]` khi có bằng chứng không nhạy cảm: ID resource/account, scope thực, approval/reference, owner decision và kết quả verification có ngày. Không lưu token, API key hay refresh token vào checklist. CODEX phải cập nhật code/test tương ứng trong lượt triển khai sau được cho phép.

Các tài liệu chính thức được truy cập ngày **28/10/2026**; trang Meta nêu trên bị HTTP 429 nên ghi rõ chưa xác minh nội dung hiện hành. Không có tài khoản bên ngoài nào được đăng nhập/thay đổi trong lần audit này.

