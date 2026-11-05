# Bàn giao redesign Shorts Factory — 03/11/2026

**Cập nhật 04/11/2026: người dùng yêu cầu tiếp tục trong cùng chat.** Đã khôi phục decision board sau khi daemon cũ dừng: **http://127.0.0.1:51043/**, vẫn key `89d45c30` và payload đã lưu. Chưa nhận lựa chọn hướng tại thời điểm cập nhật. `git status --short` sạch khi tiếp tục; ghi chú 78 dirty entries bên dưới là trạng thái lịch sử ngày 03/11, không còn là baseline hiện tại. Đây là ghi chú bàn giao, không phải báo cáo hoàn thành redesign.

## Yêu cầu và quyết định đã xác nhận

Người dùng yêu cầu: dùng skill `impeccable` để **redesign toàn bộ UI/UX, dễ sử dụng**. Các lần trước chỉ sửa khoảng cách/card chưa đáp ứng mong muốn; cần thay bố cục và phân cấp thông tin thực sự.

Người dùng đã xác nhận công cụ chủ yếu dành cho mình tạo video trên PC local, ưu tiên tiếng Việt và luồng:

**Dán link Facebook/Threads → chủ động chụp ảnh post/bình luận trong Chrome/Edge → duyệt nguồn và quyền → chỉnh lời đọc/giọng local/nền/nhạc → xuất MP4 → duyệt/tải về.**

Quản trị workspace, nguồn, kênh, analytics, autopilot và publishing nằm ở phần phụ. Không cần hỏi lại mục tiêu này. Người dùng muốn dùng ảnh chụp nguồn thật, không thay chúng bằng thẻ nội dung tự dựng khi đã có ảnh.

Giữ nguyên chức năng và các bảo đảm: authorization theo tenant, rights review, job bền vững/idempotent, lịch sử/hủy/timeout/phục hồi, duyệt trước khi tải/xuất bản. Không đổi backend chỉ để làm redesign. Không tự động xác nhận quyền hoặc mô phỏng publish thành công.

Với bài Facebook từng gửi, người dùng đã trả lời chưa có quyền và chỉ tiếp tục bằng dữ liệu thử. Dùng fixture/synthetic data để kiểm chứng; không tự chuyển sang render bài thật đó.

## Đã làm trong lượt redesign này

- Đã đọc Impeccable, chạy `context` đúng một lần cho `apps/web/components/story-studio.tsx`, đọc init/new-work/Operate và craft floor.
- Đã ghi product truth đã xác nhận tại `apps/web/PRODUCT.md`.
- Đã lập bảy hướng grounded tại `apps/web/.impeccable/grounded-directions.md`.
- Đã chạy direction seed ở mode `operate`; hướng được giao là tham chiếu số 4, phụ đề và nhịp dựng phim. Seed reference: **`seed:a24a812c6ce36039`**. Kết quả máy đầy đủ ở `.data/diagnostics/redesign-direction-roll.txt`; schema ở `.data/diagnostics/redesign-decision-schema.txt`.
- Đã tạo decision payload `apps/web/.impeccable/direction-options.json` và năm HTML sketch standalone. Ba sketch được các agent chuyên sketch hoàn thành; không agent nào sửa production UI.
- Đã mở decision board cho người dùng. **Chưa nhận được lựa chọn.** Lần chờ gần nhất kết thúc với thông báo `WAITING: no answer yet after 60s`.
- Đã tải và xem bốn ảnh QUALITY BAR của hai challenger cạnh tranh, chỉ làm tham chiếu craft, không phải asset của sản phẩm.
- **Chưa sửa production UI trong lượt redesign này. Chưa viết surface brief/direction contract. Chưa chạy detector, kiểm thử hoặc finish review cho redesign. Chưa có DESIGN.md.**

## Điểm tiếp tục chính xác: chọn hướng trên decision board

- URL đang chạy: **http://127.0.0.1:57104/**
- Board key: **`89d45c30`**
- Working directory của Impeccable cho board: **`E:/Workspaces/short-factory/apps/web`**
- Launcher: **`C:/Users/pc/.codex/skills/impeccable/scripts/impeccable.cmd`**
- Skill: **`C:/Users/pc/.codex/skills/impeccable/SKILL.md`**, version 4.8.0.

Các mẫu:

| id | Nhãn | Trọng tâm | File trong `apps/web/.impeccable/mocks/decision/` |
| --- | --- | --- | --- |
| `video-focus` | Tập trung vào video | Preview dọc tối luôn cạnh phần biên tập; thanh cảnh nối với lời đọc | `video-focus.html` |
| `guided-blue` | Rõ ràng từng bước | Từng bước, một thao tác tiếp theo rõ ràng; xanh navy/blue | `guided-blue.html` |
| `journey` | Hành trình tới MP4 | Các giai đoạn có trạng thái, quay lại chỉnh; navy/đỏ | `journey.html` |
| `easy-studio` | Studio dễ bắt đầu | Nhãn đời thường, vùng bấm rộng, nền ấm; tùy chọn xuất hiện đúng lúc | `easy-studio.html` |
| canon | Giao diện quen thuộc tối giản | Mẫu công cụ web tiêu chuẩn | `canon.html` |

Payload cũng có bốn challenger declined/demoted cùng lý do và phần học được: map, folio, wayfinding, exposure. Không tự ý bỏ hoặc nâng chúng lên để lấp số lượng lựa chọn.

Đường đi hiện tại là **code-led**. Các đường dẫn PNG `comp` trong payload là chỗ dự phòng khi người dùng chuyển toggle sang comp; hiện chưa sinh comp và không cần tự sinh nếu chưa có yêu cầu chuyển.

Nếu board còn sống, lấy lựa chọn bằng:

```powershell
Set-Location 'E:/Workspaces/short-factory/apps/web'
& 'C:/Users/pc/.codex/skills/impeccable/scripts/impeccable.cmd' serve-question --wait --key 89d45c30
```

Chờ bằng exec session có thể poll; không tự bấm chọn thay người dùng. Nếu chưa có câu trả lời, thực hiện quy trình chờ/fallback trong skill. Nếu user chọn reroll, cập nhật **cùng board/key** theo skill, không start server thứ hai khiến tab hiện tại bị bỏ lại. Nếu daemon đã tắt giữa hai chat, xác nhận không còn server rồi mở lại từ payload đã lưu; không chạy seed/context lại chỉ để khôi phục trang.

Người dùng tạm dừng chủ động; không để polling hoặc công việc triển khai tự chạy sau yêu cầu dừng. Tại lúc ghi note, client chờ đã kết thúc, ba agent sketch đều completed. Board daemon được giữ để có thể xem lại; nó có thể không còn sau khi khởi động lại máy/app.

## Tiếp tục sau khi chốt lựa chọn

1. Đọc ghi chú này, AGENTS.md, PRODUCT.md và skill Impeccable. Không khởi động lại discovery hoặc hỏi lại các quyết định sản phẩm đã xác nhận. Đọc docs/schema/contracts/examples theo quy định repo trước khi chạm module bị ảnh hưởng; các tài liệu đã đọc trong chat cũ không tự có trong context chat mới.
2. Chốt hướng bằng lựa chọn đã nhận từ board hoặc chỉ định mới rõ ràng của người dùng; nếu chưa có, tiếp tục đúng bước chọn hướng. Không triển khai một hướng tự chọn.
3. Xem sketch được chọn và QUALITY BAR tương ứng. Hai challenger đã có board + hero trong `apps/web/.impeccable/references/`:
   - `vernacular-ephemera-jet-age-ticket-wallet[ -hero ].webp`
   - `digital-design-canon-warm-consumer-app-surface[ -hero ].webp`
   Tên file thực không có dấu cách quanh `-hero`. Không bê hình, motif vé máy bay hoặc dữ liệu giả vào sản phẩm. Đây là mode Operate: điều hướng, form và điều khiển phải quen thuộc.
4. Đọc/ghi/read-back surface brief qua `impeccable surface-brief` với target chính `components/story-studio.tsx` và các target liên quan. Ghi đầy đủ Direction contract, THESIS, OWN-WORLD, STORY, FIRST VIEWPORT, FORM, FINISH và seed reference theo new-work. Contract chỉ ở tài liệu phát triển, không đưa vào JSX/UI/bundle.
5. Đọc lại craft floor ngay trước sửa UI. Triển khai xuyên suốt các route, giữ product truth và hành vi hiện có. Không dừng ở đổi màu hoặc thêm margin; giảm các card lồng nhau, đầu trang dư thừa và các CTA cạnh tranh; preview và đường đi đến duyệt/tải phải dễ thấy.
6. Kiểm tra hành vi và layout ở desktop/mobile/tablet; cập nhật selector kiểm thử nếu nhãn thay đổi, không xóa test bảo vệ chức năng. Gom các ảnh/thử nghiệm thành các vòng theo skill, mở từng ảnh xác minh evidence hợp lệ.
7. Đã chạy detector **một lần** trên changed targets; kết quả `[]`. Sau đó finish reviewer yêu cầu một patch CSS responsive nhỏ; patch này được xác minh bằng suite UI, detector không chạy lại để giữ đúng một lượt detector trong session.
8. Đã hoàn tất fresh finish review theo skill. Verdict cuối: **SHIP**, high confidence; blocker mobile nav đã được sửa và kiểm thử lại.
9. Đã tạo **`apps/web/DESIGN.md` + `apps/web/.impeccable/design.json`** với token Easy Studio thực tế.
10. Báo cáo hoàn tất nằm ở `docs/product/IMPECCABLE_REDESIGN_REPORT.md`; full UI 51/51, unit 26/26, typecheck/lint pass.

## Phạm vi code và các điểm cần giữ

Các route: `/dashboard`, `/discover`, `/studio`, `/studio?mode=import`, `/export`, `/publish`, `/channels`, `/sources`, `/library/posts`, `/reviews`, `/autopilot`, `/analytics`, `/settings`, `/guide`, `/login`.

Các file chính trong `apps/web/components/`:

- `app-shell.tsx`: điều hướng còn admin/dashboard trước, nhiều nhãn Anh; workspace/session/logout phải giữ.
- `studio-workbench.tsx`: trang vào Studio, import, hàng đợi bài, video library, công việc gần đây.
- `story-studio.tsx`: script/voice/settings, preview, render blocker, MP4 review, progress/cancel/retry. Giữ API/validation/job semantics.
- `local-export.tsx`, `source-capture.tsx`: link/capture/nhập thủ công/quyền; extension trên Chrome/Edge là mặc định, browser riêng là tùy chọn. Không lấy cookie/profile/debugging port, không cài extension ngầm.
- `studio-draft-preview.tsx`, `studio-media-catalog.tsx`, `studio-presets.tsx`, `studio-asset-upload.tsx`, `voice-library.tsx`, `studio-video-library.tsx`.
- `product-overview.tsx`, `discover.tsx`, `content-detail.tsx`, `workspace-page.tsx`, `analytics-dashboard.tsx`, `autopilot-dashboard.tsx`, `publish-handoff.tsx`, `auth-form.tsx`.
- `apps/web/app/globals.css`: hệ thống CSS cũ có nhiều override, cần thống nhất sau khi chốt hướng.

Nền hiện có: khoảng 10 nền minh họa local và 12 nhạc CC0; chưa cài footage gameplay. Không ghi UI như thể đã có footage gameplay. Giữ provenance/license của media.

## Baseline từ lượt sửa trước — không nhầm với kết quả redesign

Trước yêu cầu full redesign đã có các bản sửa spacing/card, giữ lỗi API đúng, evidence upload có required/description, preset empty/loading rõ hơn, placeholder contrast và notice spacing. Báo cáo: `docs/product/IMPECCABLE_STUDIO_REVIEW.md` và các báo cáo UI/UX liên quan.

- Full UI: **51/51 pass**, log `test-results/impeccable-full-ui.log`.
- Lint và web typecheck pass ở lượt đó.
- Ảnh trước đó ở `docs/screenshots/ui-ux/impeccable-*.png`.
- Kết quả detector trước đó chỉ cho các file polish hẹp, không phải redesign này.

Các test quan trọng: `apps/web/test/product-studio.spec.ts`, `apps/web/test/ui-layout.spec.ts`, các suite trong `playwright-ui.config.ts`; mock workspace ở `apps/web/test/fixtures/workspace.ts`.

Lệnh xác minh:

```powershell
$env:LOCAL_EXPORT_UI_BASE_URL='http://127.0.0.1:3000'
pnpm test:ui
pnpm lint
pnpm --filter @shorts-factory/web typecheck
```

Không chạy production build ghi chung `.next` trong khi dev server đang phục vụ người dùng; dùng cách cô lập nếu cần build.

## Workspace/runtime và quy tắc an toàn khi tiếp tục

- Repo **`E:/Workspaces/short-factory`**, PowerShell, TypeScript/Next.js 16.4.3; đọc tài liệu Next bundled theo `apps/web/AGENTS.md` trước sửa code.
- **78 dirty entries** lúc ghi note, phần lớn là công việc các lượt trước. Không reset/clean/revert toàn repo, không ghi đè thay đổi người khác. Những artifact mới của redesign là PRODUCT.md và `.impeccable/` nêu trên; note này bổ sung sau khi đếm.
- Không có `.codegraph/` ở lượt kiểm tra trước: bỏ qua CodeGraph nếu vẫn không có, không tự index.
- Ponytail full bắt buộc. Đường dẫn ACER trong AGENTS cũ không khớp máy; bản đã đọc đang ở `C:/Users/pc/.codex/plugins/cache/ponytail/ponytail/5.3.3/skills/ponytail/SKILL.md`.
- Skill Impeccable đã cài, engine 0.1.18. Không cài lại, không thêm npm dependency cho skill và không bật hook ngầm.
- Web `http://127.0.0.1:3000`, API **3004**, TTS 3002, capture 3003; kiểm tra runtime trước khi khởi động lại. **3001 thuộc dự án khác, không dừng/đổi nó.** WSL Ubuntu dùng PostgreSQL 16 ở 5432, Redis ở 6380.
- `.env` có secrets, không in/log. Dữ liệu local hiện có không phải disposable.
- Dùng CUA cho tương tác UI người dùng. Chrome control đã bị tắt trong Work settings ở lượt trước; không dùng shell/Playwright để vượt cài đặt đó. Bộ test tự động của repo với fixture vẫn dùng để xác minh code. Không sửa bản nháp trong tab Studio người dùng.
- Bốn agent slot tổng cộng. Ba agent sketch hoàn tất; không có worker triển khai đang chạy. Chỉ spawn agent khi người dùng hoặc skill/AGENTS yêu cầu rõ (Impeccable cho phép/chỉ định sketch, finish reviewer, documenter); không tự mở thêm user-owned chat.

## Prompt ngắn để tiếp tục trong chat khác

```text
Tiếp tục full redesign UI/UX Shorts Factory trong E:\Workspaces\short-factory bằng skill impeccable.
Đọc docs/product/REDESIGN_HANDOFF_2026-11-03.md trước, rồi AGENTS.md và apps/web/PRODUCT.md.
Đã xác nhận ưu tiên tiếng Việt, PC local, luồng dán link → chụp post/comment → chỉnh lời đọc/giọng/nền/nhạc → xuất MP4 → duyệt/tải; quản trị là phụ.
Đang dừng ở bước chọn hướng trên decision board http://127.0.0.1:57104/ (key 89d45c30), chưa nhận lựa chọn. Payload và 5 HTML sketch đã lưu trong apps/web/.impeccable/; chưa sửa production UI của redesign. Tiếp tục từ bước này, không chạy lại discovery/seed và không tự chọn thay tôi.
Giữ mọi thay đổi chưa commit. Sau khi chốt hướng, triển khai toàn bộ phạm vi, kiểm thử và kiểm tra desktop/mobile, finish review độc lập rồi DESIGN.md + design.json theo skill. Đừng dừng ở kế hoạch hoặc chỉ sửa CSS spacing.
```
