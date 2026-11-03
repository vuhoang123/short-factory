# Chụp trong Chrome/Edge đang đăng nhập

Extension dùng **chính tab/profile hiện tại**, không mở thêm một Chrome riêng và không đọc cookie hoặc mật khẩu.

1. Chạy `pnpm local:capture:setup` để tạo thư mục `.data/source-capture/extension`. Bộ chọn nguồn được sinh từ checkout `ai-comment` local đã kiểm tra hash; mã engine không được đóng gói trong source của dự án này.
2. Trong Chrome mở `chrome://extensions`, hoặc Edge mở `edge://extensions`. Bật **Developer mode / Chế độ dành cho nhà phát triển**, chọn **Load unpacked / Tải tiện ích đã giải nén** và chọn thư mục extension vừa tạo. Đây là thao tác cài một lần do người dùng thực hiện.
3. Tải lại tab Studio. Dán link rồi mở bài từ Studio: extension mở một tab trong cùng cửa sổ, cùng phiên đăng nhập hiện tại.
4. Mở đầy đủ chữ và bình luận cần lấy. Ở tab bài, bấm biểu tượng extension, xác nhận đúng bài rồi chọn **Chụp và gửi về Studio**. Giữ tab nguồn và Studio mở cho tới khi xong; có thể đóng popup nhỏ.
5. Trở lại Studio để kiểm tra ảnh, che tên/avatar, khai báo quyền và dựng video.

Nếu **Chụp và gửi về Studio** bị mờ, đọc lý do ngay dưới nút. Ô xác nhận chỉ xác nhận đúng nội dung; Studio vẫn phải tạo lượt chụp và giữ kết nối. Khi chưa có lượt, chọn **Mở Studio để kết nối**, rồi mở bài từ Studio. Khi mở sai tab hoặc đã chuyển bài, chọn **Mở lại đúng bài chờ chụp**. Nếu tab Studio cũ đã đóng, nút kết nối khôi phục lượt đang chờ sau khi kiểm tra tài khoản/workspace; giữ lại tab nguồn đã mở đủ bình luận.

Sau khi cập nhật bộ file extension (hiện tại **1.0.1**), vào trang quản lý tiện ích và bấm **Reload / Tải lại** trên Shorts Factory, rồi F5 tab Studio. Copy file mới vào thư mục không tự cập nhật extension đang chạy; thao tác tải lại do người dùng thực hiện.

Quyền `activeTab` chỉ dành cho tab được bạn chọn. `debugger` cho phép chụp phần tử nguồn bằng Chrome DevTools Protocol; Chrome hiện banner trong lúc extension gắn vào tab đó. `webNavigation` chỉ theo dõi điều hướng của tab được mở cho lượt chụp để từ chối chụp nhầm bài. `storage.session` giữ mã lượt/tab trong phiên, không lưu nội dung bài/bình luận hoặc thông tin đăng nhập. Host permissions chỉ cho hai địa chỉ Studio local ở cổng 3000. Không yêu cầu cookies, lịch sử duyệt web, `<all_urls>` hoặc tải xuống.

Link share Facebook phải giải quyết thành bài trong cùng chuỗi chuyển hướng được extension mở. Nếu Facebook chuyển sang trang đăng nhập/trang chủ, đăng nhập xong rồi chọn **Mở lại đúng bài chờ chụp** trong popup để xác nhận lại chuỗi chuyển hướng. Nút này chỉ mở link gốc đã chọn. Khi DevTools đang gắn vào tab hoặc chính sách trình duyệt chặn `debugger`, extension báo lỗi; không tự tắt chúng hoặc đổi cấu hình trình duyệt.

Chỉ lấy các bình luận đang được trang tải và khớp duy nhất với bài, tối đa 30, ưu tiên số react đọc được. Không tự quét toàn bộ group hay vượt qua kiểm soát truy cập. Tên trong nội dung/ảnh đính kèm vẫn có thể xuất hiện; xem từng ảnh trước khi xuất. Extension không cấp quyền sử dụng nội dung và không tự đăng video.
