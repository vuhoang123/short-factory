# Rà soát và sửa UI/UX — 03/11/2026

Đã rà các màn web, sửa lỗi bố cục dùng chung và điều chỉnh luồng nhập/biên tập. Đây là lượt sửa UI local; không thay đổi API, quyền workspace, cơ chế render hoặc các gate đăng bài bên ngoài.

## Các lỗi đã xử lý

| Vấn đề | Thay đổi |
|---|---|
| Tiêu đề, mô tả, ô nhập và thông báo dính nhau | Form panel dùng một cột co giãn với khoảng cách nhất quán; bỏ padding/margin lặp trong heading và các panel nằm trong grid |
| Hướng dẫn mất dấu đầu dòng, các nguồn gameplay trông như một đoạn text | Khôi phục list marker và khoảng cách giữa từng mục; link trong hướng dẫn có gạch chân và màu rõ; nguồn gameplay có khung riêng |
| Nút dài, thông báo và text dài vượt khung | Nút được xuống dòng, có giới hạn chiều rộng; text nguồn/URL và trạng thái có thể wrap; thông báo giữ thứ tự văn bản thay vì biến mỗi phần thành flex item |
| Studio nhập bài bắt đầu bằng lịch sử render và tiêu đề trùng | Chế độ nhập trong Studio đưa kênh và ô link lên trước; lịch sử vẫn ở `/export`, thư viện video vẫn có link trên đầu; nhập thủ công nằm trong details mở khi cần |
| Kịch bản bị đẩy xuống sau toàn bộ thiết lập dài | Khi có bản nháp, kịch bản đứng đầu cột biên tập. Có link nhảy tới kịch bản, thiết lập, nền/nhạc và preview; tên section không còn số thứ tự mâu thuẫn với vị trí thực tế |
| Mobile header chiếm chỗ, workspace picker có thể đè logo | Logo/picker dùng grid; điều hướng chính cuộn ngang trong vùng riêng; công cụ mở theo chiều dọc; Sign out nằm trong hàng công cụ, bỏ topbar lặp trên mobile |
| Bộ lọc ngày tràn/chồng ô trên tablet/mobile | Cột bộ lọc tự điều chỉnh theo chiều rộng thật; input/select có `min-width: 0` |
| Bảng chi phí làm vỡ cột, bảng Sources gây tràn ngang trang | Chi phí nằm trong vùng cuộn bảng; grid form dùng `minmax(0,1fr)`; vùng bảng có containing block cho caption ẩn của screen reader, tránh caption nằm ngoài vùng clip |
| Hộp chi tiết lệch vị trí, tiêu đề dài ép nút đóng | Dialog có margin auto, heading wrap, thông tin quyền/điểm xếp một cột trên màn hẹp |
| Chi tiết phụ đề, react và audio sát nhau | React chuyển thành dòng phụ, comment picker/source image/audio có nhịp cách riêng; range slider bỏ padding/border của ô nhập văn bản |
| Trang đăng nhập mobile dài và câu trong tiêu đề dính khi ẩn `br` | Giữ ngắt dòng tiêu đề; rút phần giới thiệu trên mobile, ưu tiên form đăng nhập |

Preview nền/nhạc, native details, focus ring, reduced motion và kiểm tra quyền hiện có được giữ. Không thêm dependency hoặc animation.

## Phạm vi kiểm tra

15 màn/biến thể: `/dashboard`, `/discover`, `/studio`, `/studio?mode=import`, `/export`, `/publish`, `/channels`, `/sources`, `/library/posts`, `/reviews`, `/autopilot`, `/analytics`, `/settings`, `/guide`, `/login`.

Chạy ở 320, 768 và 1440 px, mở các details trong nội dung để kiểm tra phần mở rộng. Kiểm tra tràn ngang trang, ô điều khiển ngoài viewport, các control chồng nhau và logo/picker chồng nhau. Bảng/khung preview/thanh scene có vùng cuộn riêng được phân biệt với lỗi tràn toàn trang. Có thêm trường hợp tiêu đề dài, dialog, Studio có bản nháp/video và link nhảy section. Không coi kiểm tra hình học là xác nhận mọi nội dung động đều hoàn hảo.

Ảnh dùng dữ liệu thử, không dùng bài Facebook của người dùng:

- [Desktop](../screenshots/ui-ux/import-desktop.png)
- [Mobile](../screenshots/ui-ux/import-mobile.png)
- [So sánh hai kích thước](../screenshots/ui-ux/import-responsive.png)

## Kiểm thử và lệnh chạy

```powershell
$env:LOCAL_EXPORT_UI_BASE_URL = 'http://127.0.0.1:3000'
pnpm test:ui
pnpm lint
pnpm typecheck
```

- Bộ đầy đủ **48/48 UI tests PASS**, gồm luồng import/capture mock → quyền → kịch bản → MP4 mock → duyệt/tải; kiểm tra loop state, polling, giữ bản sửa chưa lưu và đổi workspace. Log: `test-results/ui-audit-full.log`.
- Sau khi tinh chỉnh header mobile, ưu tiên kịch bản và ô link: **5/5 kiểm thử bố cục/nội dung dài PASS**, gồm 45 lượt mở màn ở ba kích thước và ô link nằm trong viewport 900px cao tại desktop/mobile. Log: `test-results/ui-audit-final-layout.log`.
- Kiểm tra lại các luồng bị ảnh hưởng sau khi sắp xếp editor/header: **8/8 PASS**, gồm capture/resume mock, mobile role, duyệt video, chỉnh kịch bản, preview/preset, import vào editor, refresh session và đổi workspace. Log: `test-results/ui-audit-final-workflow.log`.
- Lint và root typecheck cùng **13/13 package typechecks PASS**. Logs: `test-results/ui-audit-final-{lint,typecheck}.log`.

Các snapshot từng màn và editor nằm trong `test-results/ui-layout/`. `/export` tiếp tục có luồng nhập thủ công mở sẵn và lịch sử; Studio import ưu tiên capture.

## File thay đổi trong lượt này

- `apps/web/app/globals.css`: typography, khoảng cách, responsive, form, bảng, dialog, catalog và shell.
- `apps/web/components/app-shell.tsx`: vị trí Sign out trên mobile.
- `apps/web/components/local-export.tsx`, `source-capture.tsx`: thứ tự nhập, khoảng cách, phần thủ công và ảnh nguồn.
- `apps/web/components/story-studio.tsx`, `studio-draft-preview.tsx`: ưu tiên kịch bản và anchor điều hướng.
- `apps/web/components/autopilot-dashboard.tsx`: vùng cuộn bảng chi phí.
- `apps/web/playwright-ui.config.ts`, `test/ui-layout.spec.ts`, `test/product-studio.spec.ts`: hồi quy bố cục và nội dung dài.
- Báo cáo này, ảnh bằng chứng và các liên kết follow-up trong báo cáo Phase 6/pre-audit.

Working tree đã có nhiều thay đổi từ các lượt trước; danh sách này không nhận toàn bộ diff đang có là thay đổi mới.

## Giới hạn kiểm chứng

Đã xem Dashboard, Studio import và Analytics trên Chrome thật trong lượt rà. Quyền điều khiển trình duyệt local sau đó bị tắt trong Work settings; lượt kiểm tra cuối dùng Chromium tự động với fixture. Chưa dựng video mới, chụp lại Facebook thật hoặc phát sinh quyết định duyệt trên dữ liệu người dùng trong lượt UI này. Không chạy lại production build trên `.next` của dev server đang dùng. Các tích hợp bên ngoài tiếp tục `BLOCKED_EXTERNAL` theo trạng thái trước đó.

## Follow-up card mở rộng — 03/11/2026

Ảnh người dùng chỉ ra lỗi còn sót ở “Bố cục và quyền riêng tư”: đoạn hướng dẫn ảnh gốc chồng lên checkbox. Bộ kiểm tra trước có bắt tràn khung/control overlap, nhưng chưa đo khoảng cách giữa help text và control trong editor mở rộng; kết quả PASS trước đó không chứng minh trường hợp này đã đúng.

Đã tái hiện bằng test riêng: help text có gap **-8px** với hàng checkbox. Nguyên nhân là margin âm của `.form-stack .field-help` áp vào cả phần tử con sâu bên trong form. Đã bỏ rule đó, thay margin từng label bằng khoảng cách 16px giữa mọi khối trực tiếp của `.studio-advanced`, và thêm gap 6px giữa tên/mô tả/nguồn trong tile nền/nhạc.

Kiểm tra “Bố cục và quyền riêng tư”, “Bộ thiết lập của bạn”, “Giọng đọc riêng” và “Thêm nền hoặc nhạc từ máy” ở 390 / 768 / 1440 px: test trước sửa FAIL đúng gap âm; sau sửa PASS, khoảng cách các hàng ít nhất 12px, không tự tạo API mutation. Log: `test-results/card-spacing-{before,after}.log`. Ảnh từng card ở `test-results/ui-layout/cards/`.

Bằng chứng card đã sửa: [desktop](../screenshots/ui-ux/expanded-card-fixed.png), [mobile](../screenshots/ui-ux/expanded-card-mobile.png). Ảnh dùng fixture và giữ đúng trạng thái sáng/bình luận xã hội/không che tên để đối chiếu lỗi.

Rà route chung được bổ sung phát hiện help text chồng label/hàng form. **49/49 UI tests PASS**, lint và web typecheck PASS. Log: `test-results/card-spacing-full-ui.log`, `card-spacing-{lint,types}.log`. Test card cũng đổi sang giao diện sáng, phong cách bình luận xã hội và bỏ che tên như trường hợp ảnh người dùng, xác nhận card vẫn mở và không tự tạo request mutation. Research các skill hỗ trợ: [UI_UX_SKILLS_RESEARCH.md](UI_UX_SKILLS_RESEARCH.md); chưa cài thêm skill/CLI/hook.

## Áp dụng Impeccable sau yêu cầu của OWNER

Đã cài skill 4.8.0 và dùng playbook `polish` để sửa trạng thái preset, phản hồi lỗi upload, hướng dẫn/validation bằng chứng quyền và độ tương phản placeholder. Kết quả, revision và engine hash được ghi ở [IMPECCABLE_STUDIO_REVIEW.md](IMPECCABLE_STUDIO_REVIEW.md). Không bật hook hoặc thay đổi gate production/publishing.
