# Impeccable — cài đặt và áp dụng vào Studio, 03/11/2026

## Cài đặt

- Skill chính thức: [pbakaus/impeccable](https://github.com/pbakaus/impeccable), bản 4.8.0, revision `9fadc41729c38fd47d7ae622b501558653f9d2e9`.
- Đã dùng helper `skill-installer` của Codex để cài thư mục `.agents/skills/impeccable` từ revision trên vào `C:/Users/pc/.codex/skills/impeccable`.
- Engine Windows 0.1.18 đã tải qua launcher chính thức. SHA-256 khớp manifest đi kèm: `8f61e96b0c97001546a824d79b44f46b423b560f3eb1a0cc44a8695a1b395d9f`.
- Skill có thể được nhận tự động từ lượt chat tiếp theo. Lượt này đã đọc trực tiếp SKILL.md và chạy launcher đã cài. Không thêm dependency ứng dụng hoặc bật hook trình duyệt/thiết kế.

## Đã dùng như thế nào

Đã chạy `impeccable.cmd context --target apps/web/components/story-studio.tsx` từ repo. Context xác nhận đã có UI hiện hữu và cho phép sửa hẹp theo code/tokens hiện tại, dù chưa có PRODUCT.md/DESIGN.md. Không tạo hai tài liệu đó bằng suy đoán hoặc mở một luồng redesign không được yêu cầu.

Áp dụng `reference/polish.md` và đọc `reference/craft-floor.md` trước khi chỉnh UI. Chế độ **Operate**, target là các card/form Studio; giữ palette, font, hành vi biên tập và quyền workspace. Ưu tiên trạng thái lỗi, rỗng, đang tải và khả năng sửa/thử lại trước trang trí.

| Finding | Phân loại | Thay đổi |
|---|---|---|
| Preset không giải thích trạng thái đang tải/rỗng; bộ chọn vẫn tương tác khi không có dữ liệu | Local defect, P2 | Thêm trạng thái tải/rỗng, disabled theo dữ liệu thật; nút Apply chỉ bật khi có preset tương ứng; giữ thông báo save/apply |
| Lưu preset không nêu rõ điều kiện; có thể sửa tên trong lúc request đang chạy | Local defect, P2 | Liên kết hướng dẫn với input/nút qua `aria-describedby`, khóa input trong lúc lưu, thông báo trạng thái qua `role=status`/`aria-busy` |
| Upload nhận thông báo lỗi hợp lệ từ server nhưng helper chung biến nó thành mất kết nối | Local defect, P1 | Dùng ApiError có status/code/requestId, xử lý JSON không hợp lệ; lỗi hiển thị đúng nguyên nhân, giữ file/tên/bằng chứng để thử lại |
| UI không bắt buộc bằng chứng cho LICENSED/CONSENTED dù server đã yêu cầu | Validation drift, P2 | Native required theo cơ sở quyền, hướng dẫn luôn nhìn thấy và có accessible description; reset quyền về OWNED khi upload thành công |
| Placeholder chung có độ tương phản thấp | Shared token drift, P2 | Dùng màu `--muted` hiện hữu; độ tương phản màu chữ với nền trắng khoảng 6.36:1 |
| Thông báo lỗi upload sát đoạn mô tả trong card mở rộng | Local defect, P2 | Khoảng cách 18px cho thông báo trực tiếp trong card upload/giọng riêng; test yêu cầu cách mô tả ít nhất 12px |

Các thay đổi không bỏ kiểm tra quyền phía server và không tự tạo render, upload thật hoặc quyết định duyệt trên dữ liệu người dùng.

## Kiểm tra

- Test trước sửa xác nhận thiếu loading state của preset và thiếu required của bằng chứng quyền; test bổ sung bắt khoảng cách mô tả/thông báo lỗi bằng 0.
- Ba test tập trung sau sửa đã qua: card mở rộng ở 390/768/1440px, preset tải → rỗng → lưu → áp dụng, upload thiếu bằng chứng → lỗi server → giữ dữ liệu → thử lại thành công.
- Đã chạy detector Impeccable một lần trên `studio-presets.tsx`, `studio-asset-upload.tsx`, `globals.css`; kết quả JSON **0 finding**. Sau khi xem ảnh, chỉnh thêm khoảng cách thông báo lỗi và kiểm tra bằng render/test. Không coi detector là bằng chứng duy nhất về chất lượng UX và không quét ngoài scope để đổi phong cách toàn dự án.
- Lint và web typecheck đã qua. Logs: `test-results/impeccable-{before,upload-before,upload-error-spacing-before,after,lint,types}.log`; detector: `test-results/impeccable-detector.json`; thông tin cài đặt/hash: `test-results/impeccable-installation.json`.
- Bộ UI đầy đủ **51/51 PASS** với cấu hình sẵn có, log `test-results/impeccable-full-ui.log`.

Ảnh target và các trạng thái thực của giao diện với dữ liệu thử nằm trong `test-results/impeccable/` và `test-results/ui-layout/cards/`. Đây là Chromium kiểm thử; chưa điều khiển lại Chrome cá nhân hoặc tạo video từ bài thật trong lượt này.

Ảnh đã lưu: [preset đã lưu/áp dụng](../screenshots/ui-ux/impeccable-preset-saved.png), [preset mobile](../screenshots/ui-ux/impeccable-preset-mobile.png), [upload hiển thị lỗi và giữ dữ liệu](../screenshots/ui-ux/impeccable-upload-error.png).

## File thay đổi

`apps/web/components/studio-presets.tsx`, `apps/web/components/studio-asset-upload.tsx`, `apps/web/app/globals.css`, `apps/web/test/product-studio.spec.ts` và tài liệu này. Các file đó đã có thay đổi từ các lượt trước; không nhận toàn bộ working-tree diff là thay đổi mới của Impeccable.

Lệnh dùng lại từ PowerShell:

```powershell
& 'C:/Users/pc/.codex/skills/impeccable/scripts/impeccable.cmd' context --target apps/web/components/story-studio.tsx
$env:LOCAL_EXPORT_UI_BASE_URL = 'http://127.0.0.1:3000'
pnpm test:ui
pnpm lint
pnpm --filter @shorts-factory/web typecheck
```

Ở lượt chat mới có thể gọi `$impeccable polish apps/web/components/story-studio.tsx`. Khi cần ghi lại bối cảnh sản phẩm cho các lượt thiết kế lớn hơn, dùng `$impeccable init`; việc này chưa cần cho lượt sửa card hiện tại.
