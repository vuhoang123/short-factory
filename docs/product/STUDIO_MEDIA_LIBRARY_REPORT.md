# Thư viện nền và nhạc local — 03/11/2026

Đã thêm **10 nền minh họa chuyển động + 12 bản nhạc không lời**. Mở **Studio → Nền & âm nhạc → Khám phá nền & nhạc miễn phí**. Có ảnh thu nhỏ, xem/nghe thử, tìm tên/tác giả, lọc phong cách, chọn từng mẫu hoặc thêm toàn bộ 22 lựa chọn vào workspace. Thêm cả bộ không thay lựa chọn hiện tại và không tạo render/TTS.

## Research và nguồn

| Nguồn chính thức | Giấy phép kiểm tra | Kết quả |
|---|---|---|
| [Nidhoggn — Backgrounds](https://opengameart.org/content/backgrounds-3) | CC0 | 10 nền từ tranh |
| [Holizna — Lo-Fi and Chill](https://opengameart.org/content/lo-fi-and-chill-collection) | CC0/public domain | 7 bản lo-fi trong ZIP đầu tiên |
| [Holizna — Chills](https://opengameart.org/content/chills) | CC0 | Chillhop |
| [Indieteur — Mystical Piano](https://opengameart.org/content/mystical-piano) | CC0 | Piano nhẹ |
| [zesona — Sherwood](https://opengameart.org/content/sherwood) | CC0 | Chill nhẹ |
| [Joth — Funked Up](https://opengameart.org/content/funked-up) | CC0 | Funk vui tươi |
| [extenz — Emotional Piano](https://opengameart.org/content/emotional-piano-loop) | CC0 | Piano cảm xúc |
| [Pexels](https://www.pexels.com/license/), [Mixkit](https://mixkit.co/license/) | Có giới hạn phân phối lại; Mixkit phân biệt loại license | Link tìm footage quay thật; upload file phù hợp giấy phép. Chưa tích hợp API |

[CC0](https://creativecommons.org/publicdomain/zero/1.0/) cho phép sao chép, chỉnh sửa và phân phối tác phẩm, kể cả thương mại. Mỗi tài nguyên vẫn lưu tác giả, trang nguồn và giấy phép. URL nguồn và SHA-256 được pin trong `assets/studio-starter/sources.json`. Binary không commit vào repository.

## Bộ đã có

Nền: Rừng xanh, Rừng tuyết, Thung lũng nắng, Làng quê, Hang tím, Rừng thu vàng, Rừng lá đỏ, Hầm đá ánh đèn, Sân đá cổ, Đồng cỏ. MP4 H.264 720×1280@24fps, 8 giây/vòng, pan/zoom nhẹ từ tranh CC0. Output của renderer vẫn 1080×1920.

Nhạc: First Snow, Laundry On The Wire, Everything You Ever Dreamed, Keeping Cool, Snow Drift, Windows Down, 2 Hour Delay, Chills, Mystical Piano, Sherwood, Funked Up, Emotional Piano. WAV PCM16 stereo 44.1kHz, tối đa 60 giây/vòng; hai bản ngắn giữ độ dài gốc. Chuẩn hóa RMS với giới hạn peak và fade đầu/cuối, tiếp tục dùng volume/ducking của renderer.

Đã tạo file local trên máy này, khoảng **113 MiB**, chưa tính cache nguồn. Máy khác chạy:

```powershell
pnpm local:media:setup
pnpm local:export
```

Setup dùng Sharp/FFmpeg đã có và Python stdlib để đọc ZIP, không cần API key. Lần đầu tải khoảng 110 MB nguồn. Lần sau kiểm tra checksum/cache; file bị đổi được dựng lại từ nguồn pin. File chuyển đổi và catalog được hoàn tất trước khi dùng. Preview/import trong Studio không tải thêm từ bên ngoài.

## API và phạm vi

- `GET /studio-assets`: catalog metadata, cần session, không trả đường dẫn file.
- `GET /studio-assets/:key/{preview,thumbnail}`: file đã kiểm tra checksum; preview hỗ trợ byte ranges.
- `POST /studio-assets {keys}`: editor thêm vào object store riêng của workspace. Transaction, idempotency và audit; từ chối URL/path/workspaceId từ client, key lặp và file đổi checksum. Không tạo queue job.

Adapter `packages/media/src/curated-media.ts` chỉ đọc bộ local; setup chỉ tải các URL cố định có hash. Quyền render/publishing, kiểm tra quyền nguồn và tenant isolation hiện có được giữ nguyên. Không có migration.

## Kiểm tra

**43/43 UI**, **3/3 unit catalog**, **4/4 PostgreSQL media integration**, lint và root/13 package typechecks đã qua. Bao gồm preview/range, replay không tạo asset/audit trùng, Viewer/foreign-workspace denial, từ chối path/license/key sai và file bị sửa; UI xác nhận preview không import và chọn nhạc/nền không tự chạy render/TTS.

Tất cả 22 file và 10 thumbnail đã qua checksum; cả 12 WAV có tín hiệu âm thanh. Mẫu ghép thật `test-results/studio-media/background-music-4s.mp4`: H.264 720×1280 + AAC, khoảng 4.08 giây có padding. Evidence: `test-results/studio-media/evidence.json`; logs `studio-media-{setup,checks,integration,ui}.log`.

Thay đổi: catalog nguồn, setup script/command, adapter/tests media, API routes/service, `StudioMediaCatalog`, phần Nền & âm nhạc, CSS, UI/integration fixtures và tài liệu. Lượt này chưa dựng lại video có lời đọc của người dùng.

## Sửa preview và kiểm tra workspace thật

Kho tài nguyên nay mở sẵn, có đường dẫn “Chọn nền & nhạc” ngay đầu phần biên tập. Đã nhập đủ 22 tài nguyên vào workspace đang mở trên Chrome, nên danh sách nền/nhạc không còn rỗng. Chọn nền hiện trình phát video hoặc ảnh ngay dưới ô chọn; video tự phát tắt tiếng và lặp. Chọn nhạc tự phát, theo slider âm lượng; phát một preview audio sẽ dừng preview audio khác.

Lỗi thực tế đã sửa: Express `sendFile` từ đường dẫn tuyệt đối chứa thư mục `.data` bị mặc định ẩn dotfiles, trả lỗi thay vì thumbnail/preview. Nay truyền basename với root là thư mục file đã xác thực. Kiểm thử tích hợp dùng thư mục ẩn `.catalog` để tái hiện, kiểm tra thumbnail HTTP 200 và audio byte range 206.

Lượt sửa này: lint, API/web typecheck, **13/13 product UI** và **4/4 PostgreSQL integration** qua. Chrome thật đã hiện nền được chọn và nút pause/thanh thời gian nhạc chạy sau khi chọn, âm lượng 15%. Ảnh: [selected-media-live-preview.png](../screenshots/studio-maker/selected-media-live-preview.png). Log: `test-results/preview-live-{checks,ui,runtime}.log`, `preview-final-{api,web,lint}.log`.

Nguồn gameplay mới và giới hạn lấy file được ghi riêng tại [GAMEPLAY_BACKGROUND_RESEARCH.md](GAMEPLAY_BACKGROUND_RESEARCH.md). Các clip gameplay chưa được nhập, mua hoặc phân phối lại. Bộ 10 nền ở trên vẫn là minh họa.
