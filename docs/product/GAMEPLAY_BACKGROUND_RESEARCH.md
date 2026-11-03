# Nguồn nền gameplay — kiểm tra ngày 03/11/2026

Mục tiêu là video chơi game chạy sau ảnh post/bình luận và lời đọc. Bộ local hiện có 10 nền pan/zoom từ tranh CC0; đó là nền minh họa, chưa phải gameplay. Các nguồn bên dưới đã được tìm và đối chiếu mô tả của tác giả, chưa được tải, mua hoặc nhập vào workspace.

## MakeShort dùng gì

[Trang tạo video](https://www.makeshort.ai/create/reddit-video) có bộ chọn nền video. HTML công khai chứa 18 URL preview dọc 9:16: `minecraft-01` đến `minecraft-06`, `traffic-01` đến `traffic-06`, `groom-01` đến `groom-06`. Đây là nhóm tên file quan sát được, chưa gán mọi clip `traffic` thành GTA hay `groom` thành kinetic sand khi chưa xem từng clip.

[Trang giới thiệu](https://www.makeshort.ai/) nêu Minecraft parkour, GTA 5 ramp và kinetic sand. Tham khảo cách chọn/xem trước nền và giữ ảnh bài viết phía trước; chưa thấy giấy phép phân phối lại kho clip của MakeShort nên không đưa file CDN của họ vào bộ local.

## Nguồn cụ thể có thể lấy file

| Nguồn chính thức | Nội dung | Điều kiện tác giả công bố | Trạng thái lấy file |
|---|---|---|---|
| [Magnorbis — Castle Parkour](https://ko-fi.com/s/3fe05014aa) | Minecraft, 7:01 phút; cả 16:9 và 9:16, 2.63 GB/file | Mô tả ghi FREE, cho phép kiếm tiền, không bắt buộc credit | Ưu tiên đầu cho bộ miễn phí. Chưa đi qua giao diện nhận file, chưa xác minh file cuối; cần giữ điều khoản đi kèm khi nhận |
| [Orbital — Minecraft dọc](https://ko-fi.com/s/8f5586d625) | Minecraft parkour, 19 phút, 1080×1920, 60fps | Mô tả cho phép dùng làm nền và kiếm tiền | Shop cung cấp link file chất lượng gốc; không mặc định tải miễn phí. Giá/khả dụng cần kiểm tra tại shop |
| [Orbital — GTA 5](https://ko-fi.com/s/a1551ff76a) | GTA 5, 11 phút, 4K | Đối chiếu điều kiện từng clip; kênh yêu cầu credit và không reupload thành kênh cung cấp footage | Nguồn file gốc trong shop, không gắn nhãn CC0 hay tự tải |
| [Spicy Sauce — Ocean Minecraft](https://ko-fi.com/s/4b8826cbf1) | Minecraft chủ đề đại dương, 33 phút, 1216×2160, 60fps, 6.17 GB | Trang sản phẩm ghi dùng cá nhân và thương mại | Shop, chưa xác minh giá cuối. Quá lớn để upload thẳng vào Studio hiện tại |
| [Parkoured — Biomes Part 1](https://parkoured.gumroad.com/l/fzpws) | Minecraft biomes, 10 phút, dọc | Trang sản phẩm ghi mua gồm download và quyền dùng | Lựa chọn mua thêm, chưa mua |

[Orbital — Roblox Parkour](https://www.youtube.com/watch?v=ne4v0NLcGfs) là lựa chọn thể loại thứ ba: mô tả chính chủ nói có thể dùng/kiếm tiền, yêu cầu credit kênh và không reupload làm kho footage. Link file gốc được tác giả dẫn tới [Ko-fi](https://ko-fi.com/s/c4cdd4eb10). Không coi nhãn “no copyright” là giấy phép CC0 hay quyền đóng gói lại file nguồn trong repository.

Ứng viên miễn phí khác: [Minecraft Parkour — video của tác giả](https://www.youtube.com/watch?v=vph4Euw7n6E) công bố cho dùng làm nền, không bắt buộc credit; [website được giới thiệu](https://minecraftparkouring.weebly.com/) dẫn qua `bst.gg` rồi `boost.ink`, nơi công cụ đọc không truy cập được. Chưa kiểm tra được file cuối nên chưa chọn làm nguồn tự động tải.

## Thứ tự đưa vào Studio

1. Minecraft parkour dọc: Castle, biomes, shader/ocean. Ưu tiên Castle vì tác giả công bố miễn phí và có sẵn 9:16.
2. GTA mega ramp/đua xe: chọn clip có đường chạy rõ, không chữ nổi/nhạc chèn.
3. Roblox parkour và nhóm satisfying như kinetic sand: bổ sung sau khi có file và điều kiện dùng tương ứng. Hiện chưa xác minh nguồn kinetic sand đủ rõ để đóng gói lại.

UI đã đặt các link nguồn Minecraft/GTA ngay trong kho nền. Đây là link tới tác giả, không phải nút chọn một clip đã cài. Giữ bộ minh họa CC0 như lựa chọn phụ; không đổi tên chúng thành gameplay. Đã kiểm tra trên Chrome thật: [ảnh mục nguồn](../screenshots/studio-maker/gameplay-source-links.png).

## Tích hợp local và giới hạn thực tế

Studio hiện nhận MP4 tối đa 20 MB, thời lượng 1–300 giây. Pack gốc dài hàng chục phút/hàng GB phải cắt và nén trước. Khi có file hợp lệ, dùng “Thêm nền hoặc nhạc từ máy”; chọn nền sẽ phát ngay video tắt tiếng. Điểm bắt đầu nền và lặp đã có; ảnh post/comment và TTS vẫn ở phía trước.

Ví dụ cắt 60 giây từ file đã tải hợp lệ, không sửa file gốc:

```powershell
ffmpeg -ss 00:01:00 -i "castle-vertical.mp4" -t 60 -an -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1" -r 30 -c:v libx264 -b:v 1600k -maxrate 1800k -bufsize 3600k -pix_fmt yuv420p -movflags +faststart "castle-studio-60s.mp4"
```

Kiểm tra dung lượng thực tế trước khi upload. Không cắt từ link stream của MakeShort hay tải lại bản reupload chưa rõ nguồn. Quyền dùng bản ghi của creator và [hướng dẫn nhà phát hành Minecraft](https://www.minecraft.net/en-us/usage-guidelines) là hai lớp riêng; giữ bằng chứng điều khoản/credit của clip khi nhập. Chưa xác nhận quyền phân phối lại các pack thương mại/miễn phí này thành starter pack của dự án.

## Kết quả lượt này

- Đã nghiên cứu kho MakeShort và ghi nguồn thật, thêm link nguồn ngay trong Studio.
- Đã sửa preview catalog từ thư mục ẩn `.data`; chọn nền hiện video ngay, chọn nhạc phát ngay và dùng âm lượng đang đặt; chỉ một preview audio phát cùng lúc.
- Đã nhập bộ cũ 10 nền minh họa + 12 nhạc vào workspace đang dùng. Không có clip gameplay mới được nhập; chưa mua pack hoặc tạo video của người dùng trong lượt này.
- Chi tiết kiểm thử và ảnh Chrome thật: [STUDIO_MEDIA_LIBRARY_REPORT.md](STUDIO_MEDIA_LIBRARY_REPORT.md).
