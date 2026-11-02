# Video đọc bài và bình luận: quyết định từ mã nguồn

Kiểm tra ngày 2026-11-02. Mục tiêu đã được chủ dự án sửa rõ: **ảnh chụp post/comment thật**, đọc bằng giọng local, có xem trước và tải MP4. Thẻ dựng từ chữ chỉ là lựa chọn nhập văn bản cũ.

| Nguồn / phiên bản kiểm tra | Phần đọc trực tiếp | Điều áp dụng |
|---|---|---|
| [RedditVideoMakerBot](https://github.com/elebumm/RedditVideoMakerBot/tree/569f25098a64f85d2b30b3045c9c8b6232a3c758), `569f2509` | `video_creation/screenshot_downloader.py`, `video_creation/final_video.py`; [GPL-3.0](https://github.com/elebumm/RedditVideoMakerBot/blob/569f25098a64f85d2b30b3045c9c8b6232a3c758/LICENSE) | Tham khảo luồng chụp phần tử nguồn và đặt ảnh theo từng đoạn lời đọc. Không chép mã hoặc mang bộ thu thập Reddit vào dự án. |
| [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo/tree/10714e1085f56c014415f7b6401b98ca41d778a6), `10714e10` | `app/services/video.py`, `app/services/subtitle.py`; [MIT](https://github.com/harry0703/MoneyPrinterTurbo/blob/10714e1085f56c014415f7b6401b98ca41d778a6/LICENSE) | Tham khảo cách phối clip, phụ đề và thời lượng. Giữ renderer Remotion, giọng VieNeu và timeline audio hiện có để tránh hai pipeline cạnh tranh. Không thêm dịch vụ trả phí. |
| [Short Video Maker](https://github.com/gyoridavid/short-video-maker/tree/9bb9a212ced86caa7e09099c382da1a44d638760), `9bb9a212` | README, luồng tạo cảnh/giọng/phụ đề; [MIT](https://github.com/gyoridavid/short-video-maker/blob/9bb9a212ced86caa7e09099c382da1a44d638760/LICENSE) | Tham khảo ranh giới từng đoạn và caption. Không đưa cấu hình giọng/nhận dạng tiếng Anh mặc định vào video tiếng Việt. |
| [Mozilla Readability](https://github.com/mozilla/readability/tree/ab4027a8b37669745016869a37a504727992b2ba), `ab4027a8` | README, API `parse()`, package metadata; [Apache-2.0](https://github.com/mozilla/readability/blob/ab4027a8b37669745016869a37a504727992b2ba/LICENSE.md) | Có thể dùng cho bài báo web ở giai đoạn sau; không giải quyết bình luận Facebook/Threads. Chưa thêm dependency hay mở rộng crawler. |
| `E:/Workspaces/ai-comment` | `app/importer.py`, `source_capture.py`, Facebook/Threads parsers, comment pool/ranking | Dùng checkout local qua adapter riêng; không sao chép mã engine. Setup ghi SHA-256 từng file Python; startup từ chối nếu engine thay đổi. Chưa thấy LICENSE trong checkout, nên không đóng gói/phân phối engine cùng sản phẩm. |

## Phần đã chuyển thành thay đổi trong dự án

- Dán link → mở Chromium riêng cho từng người trong từng workspace → người dùng đăng nhập → yêu cầu chụp. Không đọc profile/cookie của Chrome đang dùng.
- Snapshot post/comment gắn với sourceRef, hash nội dung, checksum ảnh, kích thước, biến thể ORIGINAL/ANONYMIZED. Job dựng đóng băng các ID này; không tự lấy ảnh của bài/bình luận khác.
- Ảnh giữ nguyên tỷ lệ và nội dung. Ảnh dài pan ở kích thước đọc được; các câu liên tiếp của cùng nguồn dùng một shot để tránh nhảy ảnh. Khoảng nghỉ giữa câu vẫn giữ ảnh.
- Thiếu ảnh hoặc thiếu bản che tên/avatar thì chặn, không thay bằng thẻ chữ. Hai chế độ preview dùng đúng file ảnh sẽ render.
- Bình luận xếp bằng số react đọc được, không suy diễn số bị thiếu. Adapter đặt ngưỡng xếp hạng của engine local về 0, thay heuristic ưu tiên độ dài ở nhóm ít react. Kết quả chỉ là top trong phần đã tải được, không cam kết toàn bộ post/group.
- Giữ VieNeu local, giọng mẫu/giọng riêng và forced alignment tiếng Việt đã kiểm chứng ở Milestone 2. Không thay model chỉ dựa vào demo của repo khác.

## Phạm vi và bằng chứng

`scripts/smoke-source-capture.py` chụp DOM tổng hợp do dự án viết bằng bộ chụp thật: 1 post + 5 comment, 12 ảnh gốc/che tên, viewport được khôi phục, không truy cập mạng xã hội. Fixture được lưu ở `examples/source-capture/`.

`pnpm smoke:source-video` dùng các ảnh thật của fixture qua transport giả lập, API/DB/outbox/worker thật, VieNeu và renderer thật. Đây không phải bằng chứng đã đọc được một bài Facebook đăng nhập thực tế. Bài người dùng gửi trước đó vẫn chưa được dùng để render vì người dùng đã chọn chỉ thử bằng dữ liệu mẫu.

Chưa áp dụng: nhạc nền, hiệu ứng âm thanh, nguồn tin báo chí, thêm model giọng mới ngoài phần VieNeu đã có. Ưu tiên hoàn thiện chụp/xem lại ảnh đúng nguồn và lời đọc/phụ đề trước.
