# Skill hỗ trợ sửa UI/UX — kiểm tra 03/11/2026

Nhu cầu hiện tại: rà UI đã có của Shorts Factory, nhất là card/form khi mở rộng; phát hiện nội dung chồng nhau và sửa khoảng cách mà không đổi stack hay làm lại phong cách của toàn bộ sản phẩm.

**Cập nhật sau research:** OWNER đã yêu cầu cài và dùng Impeccable. Đã cài bản 4.8.0 và áp dụng `polish` cùng engine context/detector; chi tiết cài đặt, finding và kiểm chứng ở [IMPECCABLE_STUDIO_REVIEW.md](IMPECCABLE_STUDIO_REVIEW.md). Các dòng “chưa cài” bên dưới là trạng thái tại thời điểm research trước yêu cầu cài đặt.

## Các lựa chọn đã đối chiếu nguồn chính thức

| Skill | Có ích cho Short Factory ở đâu | Giới hạn / mức ưu tiên |
|---|---|---|
| [Impeccable](https://github.com/pbakaus/impeccable) | `critique` đánh giá UX, `audit` rà kỹ thuật/accessibility/responsive, `layout` xử lý khoảng cách, `polish` hoàn thiện UI hiện có. Có hướng dẫn dùng với Codex | Ưu tiên cho công việc rà từng card hoặc từng luồng. Cần nêu rõ target, giữ màu/chữ của dự án; chưa cài hoặc chạy engine/CLI trong lượt này |
| [Vercel Web Design Guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | Checklist code cho label, focus, form, nội dung dài, viewport, media và trạng thái async. [Rule hiện hành](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) đã được đọc trong lượt này | Nhẹ, phù hợp làm lớp kiểm tra sau khi sửa. Không tự chứng minh rằng khoảng cách trong card đẹp/đủ; vẫn cần đo và xem ảnh. Chưa cài skill vào máy |
| [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Tra cứu hướng dẫn UX, typography, pattern và hướng dẫn theo stack; có truy vấn riêng cho form validation, badge wrap, lỗi và nội dung dài | Hữu ích khi cần thống nhất hệ thống thiết kế. Chưa cần thay palette/font hay tạo design system khác cho lỗi đang có; chưa cài/chạy CLI |

Đề xuất cho lượt cải thiện tiếp theo: **Impeccable cho critique/layout/polish + Vercel cho kiểm tra code**. Đây là đánh giá phù hợp với dự án, không phải kết quả benchmark rằng một skill bảo đảm sửa mọi lỗi.

Máy đã có `frontend-design` và `design-taste-frontend`. `frontend-design` có hướng dẫn giữ hệ thống hiện có; `design-taste-frontend` có nhánh app-screen và vòng xem screenshot → nêu lỗi cụ thể → sửa → kiểm tra lại. Không áp quy tắc trang marketing vào editor/card. Không cài thêm skill hoặc hook khi yêu cầu hiện tại là research.

## Áp dụng ngay vào lỗi card

1. Target rõ: card “Bố cục và quyền riêng tư”, preset, giọng riêng, upload media.
2. Mở các card, kiểm tra ở 390 / 768 / 1440 px với dữ liệu thử, không chỉ xem vỏ card đang đóng.
3. Đo khoảng cách giữa hàng checkbox và đoạn hướng dẫn; test trước sửa xác nhận chồng **8px** do `.form-stack .field-help { margin-top: -8px; }`.
4. Bỏ margin âm lan vào card con; các khối trực tiếp trong phần nâng cao cách nhau 16px. Metadata trong tile nền/nhạc có gap 6px.
5. Có hồi quy riêng yêu cầu các khối nội dung không chồng nhau và đoạn hướng dẫn cách checkbox ít nhất 12px. Kiểm tra route chung nay rà cả help text với label/hàng form trước nó.
6. Xem screenshot ở trạng thái đã mở, rồi kiểm tra lại hành vi edit/preview, quyền và state. Skill là hướng dẫn; bằng chứng cuối vẫn là giao diện thực và kiểm thử.

Chi tiết kết quả chạy ở [UI_UX_AUDIT_REPORT.md](UI_UX_AUDIT_REPORT.md). Không sử dụng npx installer, không thêm dependency ứng dụng, không đổi quyền truy cập browser hoặc cài hook trong lượt này.
