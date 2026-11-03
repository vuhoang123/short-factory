# Tham khảo MakeShort cho Studio — 2026-11-03

Đã được chủ dự án cho triển khai sau lượt nghiên cứu này. Xem [STUDIO_MAKER_REPORT.md](STUDIO_MAKER_REPORT.md) để biết chức năng đã làm, bằng chứng kiểm thử và giới hạn hiện tại; các bảng bên dưới giữ hiện trạng tại thời điểm nghiên cứu.

Phạm vi: nghiên cứu giao diện công khai và đối chiếu code hiện tại để xác định cải tiến tiếp theo. Đây là đề xuất sản phẩm; các mục còn thiếu dưới đây chưa được triển khai trong lượt nghiên cứu này. Các báo cáo Phase 6, Milestone 2 và current-browser capture vẫn giữ nguyên trạng thái và bằng chứng kiểm thử của chúng.

## Những gì đã kiểm chứng trên MakeShort

Nguồn chính: [trang Threads](https://www.makeshort.ai/vi/threads-post-to-video), [giao diện tạo video với Threads đã được chọn](https://www.makeshort.ai/vi/create/reddit-video?platform=threads), [trang social-post video](https://www.makeshort.ai/vi/social-post-video). Đã mở giao diện thực tế, bộ chọn giọng và xem phần phụ đề, nền, nhạc, ví dụ đầu ra; không đăng nhập hoặc tạo video trả phí.

| Quan sát | Bằng chứng công khai |
|---|---|
| Chọn nền tảng, nhập thông tin bài và kịch bản | Threads được chọn; tên, thời gian, react và nội dung là ô nhập |
| Chọn giọng | Có tìm kiếm, lọc ngôn ngữ/tuổi/giới tính và nút phát mẫu |
| Chọn phụ đề | Các mẫu có hình minh họa |
| Chọn nền và nhạc | Có thumbnail video, danh sách nhạc và nút nghe |
| Chọn tỷ lệ, xem ví dụ đầu ra | Có 9:16, 16:9; nút tạo luôn hiện khi cuộn |

Trang Threads hướng dẫn nhập nội dung và tải video dọc có giọng đọc, phụ đề. [Nguồn](https://www.makeshort.ai/vi/threads-post-to-video).

Chưa xác minh: tự lấy bài/comment từ link Threads hoặc Facebook, chụp ảnh gốc, lấy top comment toàn bài, clone giọng, chạy offline, chất lượng MP4 thật, chi phí render thực tế hoặc ví dụ đầu ra có đồng bộ đầy đủ mọi thiết lập. Nhãn “Thiết kế giọng nói” trong danh sách không đủ chứng minh người dùng được upload mẫu giọng. Không coi nội dung quảng bá là bằng chứng end-to-end.

## Đối chiếu với Shorts Factory

| Năng lực | Hiện trạng xác thực trong repo | Cải tiến phù hợp |
|---|---|---|
| Link → ảnh post/comment thật | Đã có extension Chrome/Edge, ảnh gốc/che tên và cửa sổ riêng tùy chọn. Cần cài extension một lần; chỉ xét comment đã tải | Làm trạng thái kết nối, hướng dẫn chụp và bước quay về Studio dễ hiểu |
| Chọn 5–10 comment theo react/thời lượng | Đã có auto/manual, giới hạn dữ liệu đã lưu/chụp | Hiện ảnh comment, react, thứ tự đọc và tổng thời lượng cùng một chỗ |
| Giọng Việt local và giọng riêng | Đã có VieNeu, WAV mẫu 3–15 giây, kiểm tra đồng ý, nghe thử trong editor | Đưa nghe thử/tốc độ cạnh bộ chọn giọng trong flow nhập link; dùng lại API hiện có |
| Biên tập lời đọc | Đã sửa từng đoạn, đổi thứ tự, lưu/so sánh phiên bản | Cho chỉnh lời đọc ngay dưới ảnh tương ứng; giữ ảnh nguồn và lời đọc là hai dữ liệu riêng |
| Phụ đề | Đã có Classic/Karaoke và forced alignment cho flow audio-timed | Thẻ mẫu trực quan; sau đó thêm cỡ chữ, màu và vị trí có giới hạn |
| Nền | Đã có upload ảnh và gradient; chưa có video nền | Upload video local có quyền sử dụng, chọn đoạn bắt đầu, crop và loop |
| Nhạc nền | Chưa có asset/luồng xử lý hoặc UI. `audioLevels.background` trong schema chưa phải tính năng hoạt động | Upload nhạc local, nghe thử, âm lượng, fade và tự giảm nhạc khi có lời đọc |
| Xem trước | Có ảnh nguồn trước render và player sau render. Trước render chưa có composition preview đầy đủ | Preview bố cục 9:16 trước render, dùng cùng composition; xem phần đầu/đuôi ảnh dài |
| Xuất video | Đã có MP4 1080×1920@30, lịch sử/hủy/thử lại/phục hồi | Giữ 9:16 làm mặc định; chất lượng thấp hơn hoặc 16:9 để sau khi flow chính ổn định |
| Dùng lại thiết lập | Có hydrate thiết lập run cũ, chưa có preset cá nhân | Lưu bộ giọng + tốc độ + caption + nền + nhạc theo workspace; không lưu lại ảnh/nội dung nguồn trong preset |

Bằng chứng code:

- Luồng chụp: [source-capture.tsx](../../apps/web/components/source-capture.tsx), [báo cáo current-browser](CURRENT_BROWSER_CAPTURE_REPORT.md).
- Chọn comment: [comment-picker.tsx](../../apps/web/components/comment-picker.tsx), [comment-selection.ts](../../packages/media/src/comment-selection.ts).
- Hai bề mặt cấu hình: [local-export.tsx](../../apps/web/components/local-export.tsx), [story-studio.tsx](../../apps/web/components/story-studio.tsx), [studio-workbench.tsx](../../apps/web/components/studio-workbench.tsx).
- Giọng riêng và preview: [voice-library.tsx](../../apps/web/components/voice-library.tsx), [tts.ts](../../packages/media/src/tts.ts), [local-tts-server.py](../../scripts/local-tts-server.py).
- Render ảnh thật, caption và nền: [composition.tsx](../../packages/media/src/composition.tsx), [source-images.ts](../../packages/media/src/source-images.ts), [manifest.ts](../../packages/media/src/manifest.ts), [production.service.ts](../../apps/api/src/production.service.ts).

Khoảng trống UX lớn: LocalExport cố định template `SocialCommentary` và chỉ lộ giọng/thời lượng/che tên, trong khi tốc độ, caption, theme, nền ảnh và editor nằm trong StoryStudio. Cần gom các điều khiển đang có trước khi thêm một màn cấu hình nữa.

## Luồng đề xuất

**Dán link → mở bài/chụp bằng extension → duyệt ảnh + comment → chỉnh lời đọc/giọng/bố cục → xem trước → xuất và tải MP4.**

- Bên trái: post và comment với ảnh thật, react, chọn/bỏ chọn, thứ tự đọc, chỉnh lời đọc.
- Bên phải: preview dọc, chuyển cảnh post/comment và xem vùng ảnh sẽ xuất hiện.
- Một nhóm thiết lập: giọng/nghe thử/tốc độ, thời lượng, phụ đề, nền và nhạc.
- Nút xuất kèm trạng thái sẵn sàng; blocker thiếu ảnh/giọng/quyền sử dụng có hành động sửa cụ thể. Không tự render khi đổi lựa chọn.
- Lịch sử và kết quả vẫn truy cập được sau reload; thiết lập cần lưu dùng phiên bản/manifest của run, không ghi private source vào browser storage.

Giữ ảnh nguồn nguyên bản theo yêu cầu của chủ dự án. Chỉnh lời đọc không được sửa số react hoặc tên trên ảnh; thay đổi nội dung nguồn phải chụp lại và duyệt lại. Chọn comment theo react chỉ là xếp hạng trong tập đã thu được, không cam kết top toàn bộ bài.

## Thứ tự triển khai tiếp theo

1. **Gom flow Studio và preview ảnh gốc trước render.** Dùng lại comment picker, voice library, script editor, composition và các mutation hiện có. Thêm nghe thử ở flow nhập link; preview phải thể hiện đúng ảnh/masking, thứ tự, caption và nền sẽ render. Với draft chưa có audio, ghi rõ timing là ước tính; khi có audio thì dùng duration/timing thực. Đổi thiết lập chỉ cập nhật preview, không tạo job hoặc gọi TTS liên tục.
2. **Video nền local và nhạc nền.** Mở rộng upload/manifest/worker/renderer cùng một lượt, kiểm tra media bằng probe, thời lượng, checksum và quyền sử dụng. Loop/crop có giới hạn, bỏ audio gốc của nền mặc định; trộn narration với nhạc, fade và ducking. Tiếp tục dùng asset theo workspace, outbox, idempotency, cancel/timeout và cleanup hiện có.
3. **Mẫu phụ đề trực quan và preset.** Bắt đầu bằng mẫu đang chạy thật; chỉ thêm thuộc tính mà cả player và renderer cùng hiểu. Preset tham chiếu asset có quyền và kiểm tra lại lúc render. Không reset lựa chọn khi danh sách/provider được tải lại.
4. **Tỷ lệ/chất lượng xuất bổ sung.** Làm sau khi screenshot layout và caption có quy tắc safe-area tương ứng. Không coi việc thêm dropdown 16:9 là đã hỗ trợ render ngang.

Đây là ưu tiên đề xuất cho video maker local, không đổi Milestone 3 publishing đã được ghi trong roadmap và không mở thêm luồng đăng bài tự động.

## Điều kiện nghiệm thu khi triển khai

- Một bộ dữ liệu thử có quyền, 1 ảnh post + 5–10 comment: chọn theo react/thời lượng, nghe thử, chỉnh lời đọc, preview và tải được MP4 local.
- Ảnh trong preview và MP4 giống nhau về masking, crop và thứ tự; không thay ảnh thiếu bằng thẻ giả trong chế độ ảnh gốc.
- Video nền/nhạc hoạt động bằng file local, không cần API trả phí. Kiểm tra thực tế voice không bị nhạc lấn và audio nền không bị phát ngoài ý muốn.
- Không render/TTS/poll lặp khi đổi setting hoặc unmount. Reload vẫn tìm được job; cancel/deadline chặn kết quả cũ ghi đè.
- Các asset, preset, preview và download được kiểm tra quyền theo workspace; giữ review quyền sử dụng và output trước thao tác xuất bản.

## Kiểm tra của lượt nghiên cứu này

Đã đọc các trang nguồn và giao diện công khai, kiểm tra code bằng hai lượt đọc độc lập cho Studio và pipeline, kiểm tra liên kết nội bộ cùng `git diff --check`. Chỉ thêm tài liệu và liên kết roadmap; không thay code runtime, không chạy lại bộ test/render và không sử dụng tài khoản Facebook/Threads thật.
