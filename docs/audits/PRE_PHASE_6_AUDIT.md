# PRE-PHASE 6 — Báo cáo audit toàn dự án

> Cập nhật nút mở/chụp ngày 02/11/2026: [Chrome/Edge hiện tại qua extension](../product/CURRENT_BROWSER_CAPTURE_REPORT.md) là mặc định; cửa sổ Chromium riêng là tùy chọn phụ. Không sao chép cookie hoặc bật cổng debug của trình duyệt.

> Cập nhật sau Milestone 2: [ảnh nguồn thật và bộ đọc video](../product/SOURCE_CAPTURE_REPORT.md), [repo tham khảo và quyết định áp dụng](../research/VIDEO_READER_REFERENCES.md). Profile trình duyệt do người dùng mở riêng ở local; không thay đổi trạng thái BLOCKED_EXTERNAL của publishing.

> Cập nhật chất lượng audio và thời lượng sau snapshot: [Milestone 2](../product/MILESTONE_2_REPORT.md). Bài Facebook người dùng cung cấp chưa được render vì người dùng xác nhận chưa có quyền sử dụng; kiểm chứng media dùng dữ liệu thử tự tạo.

> Đây là snapshot trước Phase 6 ngày 28/10/2026. Audit sản phẩm và kết quả UX Milestone 1 ngày 02/11/2026 được ghi tại [PRODUCT_UX_AUDIT](../product/PRODUCT_UX_AUDIT.md) và [MILESTONE_1_REPORT](../product/MILESTONE_1_REPORT.md); không dùng số liệu snapshot này thay cho trạng thái hiện hành.

**Cập nhật baseline trước Phase 6:** 28/10/2026, múi giờ Asia/Saigon, sau lượt triển khai export local. **Repository:** `E:\Workspaces\short-factory`. **Base commit:** `cbe7099af609e21d72d38b69aeced0e4fd6f99b7`; các thay đổi local export/Phase 6 đang nằm trong working tree, chưa commit.

## A. Executive Summary

**Đã đủ baseline để bắt đầu Phase 6 ổn định export local theo phạm vi OWNER xác nhận; chưa sẵn sàng chạy production đầy đủ.** Luồng manual input → duyệt → giọng Việt offline → render → tải MP4 đã được kiểm chứng thật. Phase 4 và các tích hợp social/live analytics vẫn chưa hoàn tất; việc bắt đầu Phase 6 không xác nhận Phase 1–5 đã shipped toàn bộ.

- **Phase 1:** foundation/auth/workspace/manual import/rights/tenant constraints đã có bằng chứng unit và PostgreSQL integration mới; hạ tầng production vẫn chưa sẵn sàng.
- **Phase 2:** có manual/synthetic discovery, scoring giải thích được, candidate review, queue/outbox. Reddit/Threads/Facebook live chưa được triển khai. Scoring là heuristic, chưa phải AI ranking.
- **Phase 3:** cache audio nhiều bình luận, selection theo rendition/model và comment grounding đã sửa. Luồng ba bình luận → MP4 1080×1920/30 FPS → review/download đã pass qua API/queue và giao diện thật. Background upload Studio, precise alignment/QC và production storage còn giới hạn.
- **Phase 4:** chưa có OAuth, publisher thật, calendar, account management hay remote reconciliation. POST publication bị chặn 501. Có mock adapter và tải MP4; chưa có TikTok export bundle/handoff workflow hoàn chỉnh.
- **Phase 5:** có versioned rules, orchestration, ngân sách ước tính, QC/review, manual/mock analytics và live-read adapter code. Publish chỉ mock; paid Autopilot cố ý bị chặn. Recommendations/experiments chưa chứng minh tối ưu hiệu quả thật.

**Blocker còn mở ở baseline trước Phase 6:** recovery sau mất job Redis, render timeout/cancel/fencing và global history; Phase 4 chưa triển khai; paid manual thiếu budget gate; deployment/secrets/permissions production chưa xác minh. Launcher export local dùng deterministic script + speech offline, không phát sinh paid calls/publishing.

### Phạm vi, phương pháp và giới hạn bằng chứng

Đã kiểm tra inventory 192 tệp tracked; nhóm audit đọc instructions, CODEX_START_HERE, README, toàn bộ 15 tài liệu Markdown trong docs, schema/migrations, contracts/examples, routes, frontend, backend, workers, các packages, tests, Docker/CI/env. Lockfile/dependency manifests được kiểm cấu trúc/cấu hình; không tuyên bố đã audit từng dòng mã thư viện bên thứ ba hoặc mọi binary. Không có `.codegraph/`; không tạo index mới.

Các findings dựa trên source và kiểm tra trực tiếp. Kết quả trong docs/12–15 vẫn là lịch sử; bằng chứng local mới V01 được tách riêng bên dưới. DONE_VERIFIED chỉ áp dụng đúng phạm vi test/luồng đã chạy, không áp dụng cho API thật chưa được cấp quyền.

Lượt audit đầu thiếu dependencies/client/env/services. Sau khi OWNER yêu cầu chạy local, dependencies đã cài hoàn chỉnh bằng frozen lockfile, Prisma Client đã generate, `.env` private có credentials local ngẫu nhiên; WSL Ubuntu có PostgreSQL 16, Redis riêng cổng 6380 và eSpeak NG tiếng Việt. Database ứng dụng `shorts_factory_local` và DB fixture `shorts_factory_local_test` tách biệt; không xóa/reset dữ liệu PostgreSQL Windows cũ. Chrome/managed FFmpeg đã render thực. Docker và cloud/provider account/approval vẫn chưa xác minh.

**Lịch sử ngoại lệ audit đầu:** pnpm từng tự bootstrap deps và cleanup bị policy chặn. Trạng thái đó đã được giải quyết bằng lượt cài đặt hoàn chỉnh được phép để chạy local; không còn yêu cầu xóa dependency dở. Audit đầu chỉ ghi hai báo cáo; lượt triển khai local sau đó được OWNER cho phép sửa source/config và tạo fixture/artifact. Không gọi paid API, không publish; schema/migrations và dependency lockfile không thay đổi trong lượt local export.

### V01 — Bằng chứng mới sau local export, trước Phase 6

- [Báo cáo local export](E:/Workspaces/short-factory/docs/16-LOCAL-EXPORT.md): **116/116 unit/contract tests**, **59/59 PostgreSQL integration tests**, lint/strict typecheck/build **13/13 packages**, **3/3 mocked browser tests**.
- [Metadata API/queue smoke](E:/Workspaces/short-factory/test-results/local-export-smoke.json): ba bình luận, WSL Vietnamese speech thật, MP4 **1080×1920/30 FPS, 36.971 ms, 2.503.980 bytes**, review và authenticated attachment download PASS.
- [MP4 từ browser thật](E:/Workspaces/short-factory/test-results/local-export-browser.mp4): **35,669 giây, 2.405.111 bytes**, reload/resume, preview, review/download, 0 page errors, mobile 390×844 không overflow; playback đã decode 95 frames qua giây thứ 3.
- Source/tests: [wizard](E:/Workspaces/short-factory/apps/web/components/local-export.tsx:1), [input/idempotency](E:/Workspaces/short-factory/apps/web/lib/local-export.test.ts:1), [browser export](E:/Workspaces/short-factory/apps/web/test/local-export-ui.spec.ts:1), [audio selection regressions](E:/Workspaces/short-factory/workers/media/src/audio-selection.test.ts:1), [grounding](E:/Workspaces/short-factory/packages/media/src/production.test.ts:1), [WSL TTS](E:/Workspaces/short-factory/packages/media/src/local-tts.test.ts:1), [launcher](E:/Workspaces/short-factory/scripts/local-export.mjs:1).

V01 là snapshot baseline trước Phase 6; kết quả mới về history/cancel/timeout/recovery sẽ được ghi riêng trong `docs/17-PHASE-6-REPORT.md`, không suy từ code đang viết thành PASS.

### V02 — Đối chiếu sau Phase 6 local reliability

Ngày 28/10/2026: đã triển khai history/resume, cancel, render deadline, attempt fencing và DB recovery cho local manual export. **161 unit tests, 64 PostgreSQL integration tests, 8 browser tests, root/13-package typecheck, lint và build 13/13 PASS.** Smoke dùng API thật, PostgreSQL, BullMQ và render child thật: hủy QUEUED/RUNNING, timeout 1 giây, explicit retry lần 2 thành công, review và tải MP4 với 3 bình luận. Smoke này dùng **MOCK_TEST_TONE**, tách biệt giọng Việt offline thật của V01. Metadata/artifacts cuối được ghi tại report Phase6.

G07 đóng trong phạm vi media/manual import/queued sync; RUNNING synthetic source sync chưa có lease nên không reclaim. G08/G09/G10 đóng local; G13 đóng history/resume ở `/export`. Cấu hình CI đã bổ sung browser export và smoke; remote CI/load/soak chưa xác minh. Xem [báo cáo Phase 6](E:/Workspaces/short-factory/docs/17-PHASE-6-REPORT.md) để biết kết quả browser cuối cùng, files, commands và giới hạn. Các phần ghi “baseline V01” dưới đây giữ lịch sử trước Phase 6.

Quy ước: DONE_VERIFIED chỉ cho luồng đã có kiểm chứng mới phù hợp; DONE_UNVERIFIED là code có nhưng chưa đủ gate; PARTIAL là còn chức năng thiếu; MOCK_ONLY là fixture; BLOCKED gồm điều kiện môi trường/quyền cần nói rõ; NOT_STARTED là chưa có implementation; BROKEN là đường chạy có lỗi xác định. Không tính phần trăm hoàn thành.

### Danh mục bằng chứng mã nguồn

Các ID dưới đây được tham chiếu trong các bảng; số dòng là tại commit audit, đường dẫn tuyệt đối.

| ID | Nguồn |
|---|---|
| S01 | [delivery plan](E:/Workspaces/short-factory/docs/08-DELIVERY-PLAN.md:1), [PRD](E:/Workspaces/short-factory/docs/01-PRD.md:1), [API spec](E:/Workspaces/short-factory/docs/07-API.md:1) |
| S02 | [root scripts/dependencies](E:/Workspaces/short-factory/package.json:1), [strict TS](E:/Workspaces/short-factory/tsconfig.base.json:1), [ESLint](E:/Workspaces/short-factory/eslint.config.mjs:1) |
| S03 | [auth/session/tenant context](E:/Workspaces/short-factory/apps/api/src/auth/auth.service.ts:21), [password](E:/Workspaces/short-factory/apps/api/src/auth/password.ts:1), [API middleware/routes](E:/Workspaces/short-factory/apps/api/src/app.ts:59) |
| S04 | [schema](E:/Workspaces/short-factory/prisma/schema.prisma:1), [initial migration](E:/Workspaces/short-factory/prisma/migrations/20261026000000_initial/migration.sql:1), [discovery](E:/Workspaces/short-factory/prisma/migrations/20261026010000_discovery_engine/migration.sql:1), [counts](E:/Workspaces/short-factory/prisma/migrations/20261026020000_discovery_counts/migration.sql:1), [media](E:/Workspaces/short-factory/prisma/migrations/20261027000000_phase3_media/migration.sql:1), [autopilot](E:/Workspaces/short-factory/prisma/migrations/20261028000000_phase5_autopilot/migration.sql:1) |
| S05 | [manual import](E:/Workspaces/short-factory/apps/api/src/content.service.ts:101), [rights review](E:/Workspaces/short-factory/apps/api/src/content.service.ts:167), [takedown](E:/Workspaces/short-factory/apps/api/src/content.service.ts:200), [publication block](E:/Workspaces/short-factory/apps/api/src/content.service.ts:276) |
| S06 | [discovery service](E:/Workspaces/short-factory/apps/api/src/discovery.service.ts:1), [source adapters](E:/Workspaces/short-factory/packages/sources/src/index.ts:1), [scoring](E:/Workspaces/short-factory/packages/sources/src/scoring.ts:1) |
| S07 | [discovery pipeline](E:/Workspaces/short-factory/workers/discovery/src/pipeline.ts:1), [scheduler](E:/Workspaces/short-factory/workers/discovery/src/scheduler.ts:13), [outbox](E:/Workspaces/short-factory/workers/discovery/src/outbox.ts:11), [worker/config](E:/Workspaces/short-factory/workers/discovery/src/main.ts:1) |
| S08 | [production service](E:/Workspaces/short-factory/apps/api/src/production.service.ts:1), [production boundary validation](E:/Workspaces/short-factory/apps/api/src/production.validation.ts:1) |
| S09 | [media pipeline](E:/Workspaces/short-factory/workers/media/src/pipeline.ts:1), [media outbox](E:/Workspaces/short-factory/workers/media/src/outbox.ts:15), [media runtime](E:/Workspaces/short-factory/workers/media/src/main.ts:1) |
| S10 | [script adapters/grounding](E:/Workspaces/short-factory/packages/media/src/script.ts:1), [TTS/cache key](E:/Workspaces/short-factory/packages/media/src/tts.ts:1), [media contracts](E:/Workspaces/short-factory/packages/media/src/contracts.ts:1) |
| S11 | [alignment](E:/Workspaces/short-factory/packages/media/src/alignment.ts:1), [subtitles](E:/Workspaces/short-factory/packages/media/src/subtitles.ts:1), [manifest](E:/Workspaces/short-factory/packages/media/src/manifest.ts:1) |
| S12 | [renderer](E:/Workspaces/short-factory/packages/media/src/render.ts:19), [composition](E:/Workspaces/short-factory/packages/media/src/composition.tsx:1), [cards](E:/Workspaces/short-factory/packages/media/src/cards.tsx:1), [Sharp background](E:/Workspaces/short-factory/packages/media/src/background.ts:1), [local object store](E:/Workspaces/short-factory/packages/media/src/index.ts:9) |
| S13 | [publisher mock](E:/Workspaces/short-factory/packages/publishers/src/index.ts:1), [publisher contract](E:/Workspaces/short-factory/contracts/publisher-adapter.ts:1), [source contract](E:/Workspaces/short-factory/contracts/source-adapter.ts:1) |
| S14 | [automation API](E:/Workspaces/short-factory/apps/api/src/automation.service.ts:1), [phase5 validation](E:/Workspaces/short-factory/apps/api/src/phase5.validation.ts:1), [transaction/idempotency helper](E:/Workspaces/short-factory/apps/api/src/phase5.common.ts:1) |
| S15 | [automation rules](E:/Workspaces/short-factory/packages/automation/src/rules.ts:1), [schedule](E:/Workspaces/short-factory/packages/automation/src/scheduler.ts:1), [selection](E:/Workspaces/short-factory/packages/automation/src/selection.ts:1), [quality](E:/Workspaces/short-factory/packages/automation/src/quality.ts:1), [experiments](E:/Workspaces/short-factory/packages/automation/src/experiments.ts:1) |
| S16 | [workflow pipeline](E:/Workspaces/short-factory/packages/workflows/src/pipeline.ts:19), [reservation/budget](E:/Workspaces/short-factory/packages/workflows/src/automation.ts:1), [worker scheduler/recovery](E:/Workspaces/short-factory/workers/automation/src/main.ts:1), [outbox](E:/Workspaces/short-factory/workers/automation/src/outbox.ts:1) |
| S17 | [analytics adapters](E:/Workspaces/short-factory/packages/analytics/src/index.ts:118), [analytics API](E:/Workspaces/short-factory/apps/api/src/analytics.service.ts:1), [analytics worker/token resolver](E:/Workspaces/short-factory/packages/workflows/src/analytics.ts:1) |
| S18 | [workspace screens](E:/Workspaces/short-factory/apps/web/components/workspace-page.tsx:1), [app shell](E:/Workspaces/short-factory/apps/web/components/app-shell.tsx:18), [frontend API](E:/Workspaces/short-factory/apps/web/lib/api.ts:1), [UI contracts](E:/Workspaces/short-factory/apps/web/lib/contracts.ts:1) |
| S19 | [Studio](E:/Workspaces/short-factory/apps/web/components/story-studio.tsx:42), [Autopilot](E:/Workspaces/short-factory/apps/web/components/autopilot-dashboard.tsx:27), [Analytics](E:/Workspaces/short-factory/apps/web/components/analytics-dashboard.tsx:37), [responsive CSS](E:/Workspaces/short-factory/apps/web/app/globals.css:1) |
| S20 | [Compose](E:/Workspaces/short-factory/infrastructure/compose.yaml:1), [Dockerfile](E:/Workspaces/short-factory/infrastructure/Dockerfile:1), [startup](E:/Workspaces/short-factory/scripts/local-up.mjs:1), [env template](E:/Workspaces/short-factory/.env.example:1), [CI](E:/Workspaces/short-factory/.github/workflows/ci.yml:1) |
| S21 | [unit config](E:/Workspaces/short-factory/vitest.config.ts:1), [integration runner](E:/Workspaces/short-factory/scripts/test-integration.ts:1), [integration config](E:/Workspaces/short-factory/vitest.integration.config.ts:1), [browser config](E:/Workspaces/short-factory/playwright.config.ts:1) |
| S22 | [tenant SQL tests](E:/Workspaces/short-factory/packages/database/test/constraints.integration.test.ts:54), [API integration](E:/Workspaces/short-factory/apps/api/test/api.integration.test.ts:1), [Phase5 integration](E:/Workspaces/short-factory/apps/api/test/phase5.integration.test.ts:87), [workflow integration](E:/Workspaces/short-factory/packages/workflows/src/pipeline.integration.test.ts:46), [discovery integration](E:/Workspaces/short-factory/workers/discovery/src/discovery.integration.test.ts:1) |
| S23 | [browser real API slice](E:/Workspaces/short-factory/tests/browser/phase-one.spec.ts:37), [Phase5 mocked UI](E:/Workspaces/short-factory/apps/web/test/phase5-ui.spec.ts:16), [Phase5 browser config](E:/Workspaces/short-factory/apps/web/playwright-phase5.config.ts:1) |
| S24 | [media smoke](E:/Workspaces/short-factory/scripts/smoke-media.ts:1), [Autopilot smoke](E:/Workspaces/short-factory/scripts/smoke-autopilot.ts:15), [media tests](E:/Workspaces/short-factory/packages/media/src/production.test.ts:1) |

## B. Phase Progress Matrix

Phase 0 scaffold trong delivery plan được gộp vào Foundation của Phase 1 theo tên phase trong yêu cầu. “Mức hoàn thành” mô tả phần thực tế, không phải tỷ lệ ước lượng.

### Phase 1 — Foundation & Infrastructure

| Module / Feature | Trạng thái | Mức hoàn thành | Bằng chứng | Vấn đề còn lại |
|---|---|---|---|---|
| Monorepo strict TS, Next/Nest, task graph | DONE_VERIFIED | Root + 13 workspace package typecheck/build, lint PASS | S02/V01 | Remote CI chưa xác minh |
| PostgreSQL schema/migrations/tenant FK | DONE_VERIFIED | Prisma validate, 5 migrations trên DB local mới, tenant SQL tests PASS | S04/S22/V01 | Chưa production migration/restore/drift audit |
| Auth, session, membership, active workspace | DONE_VERIFIED | Unit + SQL/API auth/role/tenant tests PASS ở local | S03/S22/V01 | Limiter public/multi-replica G11 còn mở |
| Channels/manual post + comments/dedupe | DONE_VERIFIED | Import 3 comments, scoring, review, dedupe/tenant tests PASS | S05/S22/V01 | Nội dung thật vẫn cần OWNER xác nhận quyền |
| Content rights, review, takedown local | PARTIAL | Gate/expiry/platform/local scrub và grounding regression PASS | S05/S22/V01 | Remote removal và scheduled retention chưa có |
| Docker local PG/Redis/web/API/workers | DONE_UNVERIFIED | Compose/Dockerfile/local startup thật | S20 | Không có Docker CLI/engine đã xác minh; không dùng startup để mutate DB |
| Production deployment/ops | PARTIAL | Local volumes, loopback, non-root image, health API/web | S20 | HTTPS, backup, worker health, resource/restart/secrets/monitoring thiếu |
| Dashboard/Settings | PARTIAL | Backend-connected screens | S18/S19 | Thiếu dashboard vận hành Phase5; xem G UI |

### Phase 2 — Content Discovery Engine

| Module / Feature | Trạng thái | Mức hoàn thành | Bằng chứng | Vấn đề còn lại |
|---|---|---|---|---|
| Source CRUD/verify/topic rules/history | DONE_UNVERIFIED | Role/tenant/idempotency boundaries có | S06/S03/S22 | Chưa runtime; sources UI giới hạn 50 |
| Manual import posts/comments | DONE_VERIFIED | Full local UI/API/queue workflow với 3 comments | S05/S06/V01 | Không chứng minh quyền nguồn thật |
| Scheduled fetch posts/comments | MOCK_ONLY | MANUAL + MOCK_FIXTURE, synthetic pagination/cursor | S07, scheduler:13, pipeline:101 | Không có live source collection |
| Reddit/Threads/Facebook live adapters | NOT_STARTED | Class gate báo BLOCKED_EXTERNAL; capabilities rỗng | S06, source adapters:110–128 | Thiếu network adapter **và** quyền bên ngoài; thêm key không đủ |
| Viral score/candidate ranking | PARTIAL | heuristic-v1, factors/weights/missing metrics, topic filters | S06/S15 | Không có AI ranking; không chứng minh viral performance |
| Candidate selection/reviewer gates | DONE_VERIFIED | Local score→explicit review→production, SQL/API gates PASS | S06/S22/V01 | Chưa predictive/live ranking verification |
| Queue/outbox/retries/scheduling | PARTIAL | Transactional outbox + local DB recovery; completed sync replay no-op | S07/S22/V02 | RUNNING synthetic sync reclaim và production soak còn mở |

### Phase 3 — AI Script & Video Production

| Module / Feature | Trạng thái | Mức hoàn thành | Bằng chứng | Vấn đề còn lại |
|---|---|---|---|---|
| Source-grounded scripts/versioning/editor | PARTIAL | COMMENT bắt buộc VERBATIM/exact excerpt; deterministic script+versions đã test | S08/S10/V01 | LLM thật và advanced editor/QC chưa đầy đủ |
| TTS segmented local/mock/provider | PARTIAL | Local eSpeak Việt + 3 comments render PASS; G01/G02 đã sửa | S09/S10/V01 | OpenAI chưa gọi thật; paid manual budget G06 mở |
| Alignment + SRT/Karaoke subtitles | PARTIAL | Có segment duration và approximate word timing | S11/S09 | Chưa forced alignment; không coi approximate là sync đã đạt QC |
| Remotion/managed FFmpeg render đơn lẻ | DONE_VERIFIED | Hai full local render, MP4 1080×1920/30 FPS phát/tải được | S12/V01 | Reliability/deadline/resource gates thuộc Phase 6 |
| Render timeout/cancel/fencing | DONE_VERIFIED local | Owned child + deadline + stage/progress attempt fencing; abort/timeout/retry smoke PASS | S09/S12/V02 | CPU/RAM quotas và production load chưa kiểm chứng |
| Background image/Sharp | PARTIAL | PNG/JPEG/WebP → normalized portrait, attestation | S08/S12/S19 | G04/G05 metadata upload; chưa video background/mixing/library |
| Storage/authorized preview/download | PARTIAL | Local immutable checksummed files, auth + rights media API | S08/S12 | R2/signed URL/production access policy chưa có |
| QC/human approval | PARTIAL | Review server thật; Autopilot QC có blockers | S08:211, S15 | Manual không bắt buộc QC; silence chưa đo, timing approximate |
| Studio/editor/preview/run progress | DONE_UNVERIFIED | APIs/action thật | S19 | Chưa browser run; upload bug, run monitor mất sau reload |
| Gate DoD post + 3 comments → playable reviewed video | DONE_VERIFIED | Slice local review/download qua API+queue và UI thật PASS | V01 | Full PRD publishing/live/precise alignment vẫn chưa hoàn tất |

### Phase 4 — Multi-Platform Publishing

| Module / Feature | Trạng thái | Mức hoàn thành | Bằng chứng | Vấn đề còn lại |
|---|---|---|---|---|
| Publisher contract/fixture | MOCK_ONLY | Mock YouTube/Facebook, TikTok NEEDS_ACTION | S13 | In-memory mock không phải durable remote reconciliation |
| Publication/attempt/metrics models | DONE_UNVERIFIED | Schema có entities/keys | S04:598 | Table không chứng minh workflow hoạt động |
| OAuth connect/refresh/revoke/KMS lifecycle | NOT_STARTED | Chỉ secretRef model/env resolver analytics | S03 routes/S04/S17 | Không start/callback/account management |
| Schedule/API/worker thật | NOT_STARTED | POST /publications kiểm gate rồi 501 BLOCKED_PHASE | S05:276–288 | Chưa create/schedule/enqueue cho platform thật |
| YouTube/Facebook Page uploads/reconcile | NOT_STARTED | Không real publisher adapter | S13/S16 | Code + credentials/scopes/consent/review cần cùng hoàn thiện |
| TikTok direct publication | BLOCKED | Không implementation, giữ platform gate | S13/S16 | Eligibility/intended use/creator consent/audit, không chỉ API key |
| TikTok export/manual handoff | PARTIAL | Tải MP4 được thiết kế; chưa bundle/manifest/caption/task state | S08 media route/S13 | Không gọi download chung là TikTok handoff đã shipped |
| Accounts/calendar/history/retry UI | PARTIAL | Analytics có list/history publication | S18/S19/S23 | /accounts và /publishing không tồn tại |

### Phase 5 — AI Content Autopilot, Analytics & Optimization

| Module / Feature | Trạng thái | Mức hoàn thành | Bằng chứng | Vấn đề còn lại |
|---|---|---|---|---|
| Rules/version/snapshot/schedules/TZ/dry run | DONE_VERIFIED | Unit và PostgreSQL Phase5 tests trong 59 tests PASS | S14–S16/S22/V01 | Production provider/soak chưa xác minh |
| Deterministic candidate/comment selection | DONE_VERIFIED | Unit selection/rule tests và local run PASS | S15/V01 | Không phải AI optimization hoặc chứng cứ uplift |
| Budget reservations/usage | PARTIAL | Serializable limits/ledger/ước tính Autopilot | S16 | Paid auto bị chặn; manual paid không gate; billed cost null |
| Pause/cancel/retry/emergency stop | PARTIAL | Local render cancel/deadline và DB delivery recovery PASS | S14/S16/S09/V02 | Provider calls khác và full automation production recovery chưa kiểm chứng |
| QC/approval inbox | PARTIAL | Human review và eligibility checks | S15/S19 | Chưa silence đo thật/forced alignment/manual QC thống nhất |
| Autopilot production→publication | MOCK_ONLY | Nonproduction + MOCK account/provider only | S16:233–287 | Không mở Phase4 bằng cách bật full-auto |
| Manual/mock metrics/time series | DONE_VERIFIED | Unit/HTTP mock và SQL snapshots/history tests PASS | S17/S22/V01 | Không có permitted live metrics sample |
| Live metrics providers | DONE_UNVERIFIED | Network read adapters thật sau capability gates | S17 | Token/permission chưa xác minh; metric definitions/units và runtime live chưa xác minh |
| Recommendations/experiments | PARTIAL | Evidence/sample counts/human decisions/assignment | S15/S17 | Không causal result; accept chưa tự áp rule, thiếu dữ liệu thật |
| Retention/remote takedown/observability/DLQ | PARTIAL | Local scrub/delete outbox + structured logs | S05/S07/S09/S20 | Không remote removal/scheduled retention/traces/metrics/alert/DLQ UI |
| Phase5 E2E bằng API+queue+DB+render | PARTIAL | Smoke gọi pipelines trực tiếp và dùng mocks | S24/S23/S22 | Không chứng minh queue transport hoặc social API thật |

## C. End-to-End Pipeline Audit

**Kết luận:** luồng local manual input → 3 comments → rights/candidate review → deterministic script → offline speech → real render → video review/download đã PASS (V01). Không có bằng chứng luồng social publishing/analytics/optimization production; link Facebook/Threads chỉ là provenance, không live fetching.

| Bước | Implementation/mock/API key | Kết nối và dữ liệu lưu | Error/retry/idempotency | Kiểm chứng và production |
|---|---|---|---|---|
| Crawl/Import Post | Manual service thật, discovery synthetic; không scraper/live source | SourceConfig→SourcePost; tenant/external ID/hash dedupe | Transaction/idempotency key; sync cursor | Tests hiện hữu S22, chưa chạy lại; live BLOCKED_EXTERNAL |
| Fetch Comments | Import comments thật do user cung cấp; fixture adapter | SourceComment, source refs/normalization/PII flags | Dedupe theo post/external ID; live access chưa có | Không fetch Reddit/Threads/Groups thật |
| Viral Scoring | Heuristic thật, không key/AI scoring | Candidate + metric snapshots + factor JSON | Missing metrics loại khỏi weight, threshold/safety | Unit tests hiện hữu; chưa xác minh predictive quality |
| Candidate Selection | Review API + deterministic Autopilot rank | ContentCandidate/SelectionDecision/run snapshot | Role/rights/safety/version/limits | Không dùng approval UI để tự cấp quyền nguồn |
| AI Script | Deterministic hoặc OpenAI adapter; local không key | StoryVersion immutable/ref validation | G03 đã đóng; schema+runtime cấm COMMENT không VERBATIM | Deterministic local PASS; OpenAI live chưa thử |
| TTS | Mock tone/local SAPI/eSpeak/OpenAI | AudioAsset theo exact IDs mỗi run/model/rate | G01/G02 đóng; replay/legacy selection tested | WSL tiếng Việt thật PASS; paid manual G06 còn mở |
| Subtitles/Alignment | Measured segment durations + approximate words | SubtitleTrack timeline/SRT, storyVersion | Stage output/schema | Không forced alignment; QC cần review |
| Video Render | Remotion/Chromium + managed FFmpeg thật | Manifest/RenderJob/Video/local object store | Local recovery/cancel/deadline/fencing PASS V02 | Local MP4 + playback/download PASS; chưa production load |
| Approval | Role+rights+safety review API thật; QC trong Autopilot | Video review status/audit/quality report | Idempotent decision và server recheck | Manual QC thiếu thống nhất; không tự publish sau render |
| Publishing | Chỉ mocks trong dev/test; API user scheduling 501 | Schema Publication/Attempt; mock workflow tạo test rows | Real remote sessions/reconcile chưa có | NOT_STARTED cho live; không publish trong audit |
| Analytics | Manual/mock + official read-adapter code | PublicationMetric snapshots/sync runs/provenance | RetryAfter/token/permission errors; scope-separated | Chưa có permitted live observation; FB mapping/live metrics chưa được kiểm chứng |
| Optimization | Descriptive recommendations/experiments | Recommendation/evidence/status/assignments | Human approve, sample thresholds | Chưa có closed-loop optimization hay measured uplift |

Ranh giới quyền: rights của source ≠ scope OAuth ≠ creator consent ≠ app approval ≠ quality PASS. Cần kiểm từng loại trước khi scheduling/upload. Queue payload chứa IDs thay vì raw private text/token theo S07/S09/S16.

## D. Integration Readiness Matrix

**Credentials:** `.env` private đã cấu hình database/Redis local và speech/browser offline. Không công bố giá trị secret. Account/cloud/provider token/permission ngoài local vẫn **CHƯA XÁC MINH**; không suy từ placeholder hoặc DB flag thành approval thật.

| Integration | Code | Credentials | API Permission | Tested | Production Ready |
|---|---|---|---|---|---|
| Reddit API | Gate placeholder, không network source adapter (S06) | CHƯA XÁC MINH; env token không có | CHƯA XÁC MINH; commercial/data-use cần phù hợp | Mock/gate tests có; live không | Không |
| Threads API | Gate placeholder/capabilities=[] (S06) | CHƯA XÁC MINH | CHƯA XÁC MINH; không hứa full search/comments | Mock/gate có; live không | Không |
| Facebook Groups/authorized sources | Licensed-source gate; manual export/import strategy | CHƯA XÁC MINH | Không phải chỉ thiếu key Groups | Gate/manual tests có; live không | Không |
| Manual Import | Service+DB thật (S05) | Không cần vendor key | Quyền nguồn thật chưa xác minh | Unit/SQL/full browser local PASS V01 | Local verified, chưa production |
| LLM/OpenAI | Chat completions adapter thật (S10) | Không OPENAI_API_KEY; model chưa cấu hình | Account/model entitlement chưa xác minh | Deterministic/structural tests; API thật chưa | Không |
| TTS | Tone mock/local Việt WSL/OpenAI network adapter | Local không cần key; paid chưa xác minh | N/A cho offline; paid entitlement chưa xác minh | Unit+WSL WAV+3-comment MP4 PASS | Local verified; production/paid chưa |
| Audio Alignment | Approximate + provider-metadata interface | Không key riêng | N/A cho approximate | Unit hiện hữu; forced alignment chưa có | Không cho precise alignment claim |
| Remotion | Renderer/composition thật S12 | Chrome/runtime local có | N/A API; thương mại license chưa audit | Hai MP4 thật + browser decode PASS | Local verified; resource gates chưa đủ |
| FFmpeg | Managed FFmpeg đã encode H.264/AAC | Không secret | N/A API | MP4 metadata/playback PASS V01 | Local verified; production chưa |
| Sharp | Normalize images thật | Không secret | N/A | Native unit tests PASS trong V01 | Chưa production/studio upload Unicode |
| Playwright | 2 real-API browser tests + 3 Phase5 fixture tests | Không provider secret; suite thật cần DB | N/A | Không chạy audit; Phase5 mock toàn API | N/A như production service |
| Cloudflare R2 | Không adapter; local fs trực tiếp | Không R2 config dùng được | CHƯA XÁC MINH bucket/IAM | Không | Không |
| YouTube Data API publishing | Publisher mock only | Không OAuth implementation/config hoạt động | CHƯA XÁC MINH | Mock contract; live không | Không |
| Facebook Page Reels | Publisher mock only | CHƯA XÁC MINH | CHƯA XÁC MINH Page/app scopes | Mock contract; live không | Không |
| TikTok Content Posting | Không direct post code | CHƯA XÁC MINH | Eligibility/intended-use/audit/consent chưa xác minh | NEEDS_ACTION fixture; live không | Không |
| Manual Export | /export nhập thủ công→render→review→auth download | Session + rights | Không vendor key | Full API/queue/UI local PASS | DONE_VERIFIED local; chưa TikTok bundle riêng |
| YouTube Analytics | Network adapter có (S17:138) | env-reference resolver; token thiếu | analyticsApproved + CONNECTED + readonly scopes, chưa xác minh grants | Injected fetcher mocks; live chưa | Không |
| Facebook Insights | Network adapter có; worker truyền configurable mapping | CHƯA XÁC MINH token | read_insights/pages_read_engagement được code yêu cầu, grant chưa xác minh | Mock HTTP adapter tests; worker live chưa | Không; chưa live-verify |
| TikTok authorized metrics | Display API video/query; lifetime counters | CHƯA XÁC MINH token | video.list của authorized owner; độc lập Direct Post | Mock HTTP; live chưa | Không |

### Giới hạn nền tảng và tài liệu chính thức

Ngày tra cứu **28/10/2026**; không dựa trên bài hướng dẫn của bên thứ ba.

- TikTok guideline loại utility nội bộ đăng vào account của mình/đội khỏi intended use chấp nhận; vì vậy khả năng Direct Post của sản phẩm này cần quyết định eligibility, không thể hứa chỉ cần key/audit là mở. Giữ manual handoff mặc định. [TikTok guideline](https://developers.tiktok.com/docs/en/content-sharing-guidelines).
- TikTok metrics qua Display API chỉ cho video của người dùng đã ủy quyền; không suy ra quyền post từ scope đọc. [Video query](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query).
- YouTube upload cần OAuth phù hợp. Trang videos.insert được đọc trong audit hiện ghi uploads từ unverified projects **không bị mặc định giới hạn private**; vì vậy không lặp lại quy tắc private của tài liệu cũ. Vẫn kiểm consent/verification/entitlement/quota theo project hiện hành, không hardcode quota. [videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert).
- Quyền Analytics là quyền đọc riêng, không tự có từ upload scope. [YouTube reports.query](https://developers.google.com/youtube/analytics/reference/reports/query).
- Reddit commercial/data access cần permission/thỏa thuận phù hợp; public URL không cấp quyền tái sử dụng. [Reddit access](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data).
- Meta Groups không phải đường discovery chung theo spec S01/source policy; không có Groups client trong repo. Trang changelog và Threads/Reels guide chính thức trả 429 nên nội dung/scope hiện hành **chưa xác minh** trong audit. Đường thay thế là licensed/user-supplied data, không cookie/browser/internal API bypass. [Meta changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0/), [mẫu Page Reels của Meta](https://github.com/fbsamples/reels_publishing_apis).

## E. ACTION REQUIRED FROM PROJECT OWNER

Checklist chi tiết dưới đây cũng được xuất nguyên nội dung nghiệp vụ vào [OWNER_ACTION_CHECKLIST.md](E:/Workspaces/short-factory/docs/audits/OWNER_ACTION_CHECKLIST.md). Không chuyển việc viết adapter, sửa bugs, cài dependency, chạy test, viết deploy config hoặc triển khai recovery sang OWNER.

**Cách đọc:** `CHƯA XÁC MINH` nghĩa là repository/môi trường audit không cung cấp bằng chứng; không có nghĩa tài khoản của OWNER chưa tồn tại. Các mục `[x]` chỉ xác nhận quyết định/môi trường local đã chứng minh; account/cloud/API approval bên ngoài vẫn chưa xác minh. `P0`: cần trước khi vận hành thật phạm vi đã chọn; `P1`: cần trước khi bật nền tảng tương ứng; `P2`: có thể hoãn. Local manual + local speech không bắt buộc API key trả phí, R2, Reddit, Meta hay TikTok.

### A — Bắt buộc để hệ thống chạy thực tế

#### O01 — Chốt phạm vi vận hành, nguồn nội dung và trần chi phí

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

#### O02 — Cấp môi trường thực thi và quyền truy cập hạ tầng

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

#### O03 — Xác nhận quyền đối với bài gốc và bình luận

- [ ] **P0 · OWNER/người được ủy quyền duyệt · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** mọi nguồn; production, approval và publishing. **Dependency:** O01.
- **Vì sao cần OWNER:** Codex không thể cấp license/consent thay tác giả hoặc xác nhận sự thật của bằng chứng.
- **Bằng chứng:** [server rights review](E:/Workspaces/short-factory/apps/api/src/content.service.ts:167); fixture OWNED chỉ là dữ liệu mẫu, không chứng minh quyền đối với nội dung thật.
- **Các bước:** 1. Chọn nội dung tự sở hữu hoặc có phép rõ ràng, gồm quyền bình luận cần dùng. 2. Lưu giấy phép/đồng ý, phạm vi thương mại, nền tảng, lãnh thổ, thời hạn và attribution. 3. Nhập vào Library, người có role REVIEWER/ADMIN xác nhận tại `/reviews`; loại thông tin nhận dạng không cần thiết.
- **Thông tin/cấu hình:** evidence/reference phù hợp trong rights form; không đưa giấy tờ cá nhân dư thừa vào chat.
- **Xác minh:** eligibility cho đúng destination; UNKNOWN/expired/revoked phải bị từ chối ở API/worker.
- **URL:** hợp đồng/chứng cứ từ chủ quyền cụ thể; không có trang web chung cấp quyền tái sử dụng.
- **Có thể bỏ qua?** Không cho nội dung thật; có thể dùng fixture tổng hợp để kiểm thử.

#### O04 — Cung cấp media nền và tài sản có quyền sử dụng

- [ ] **P0 nếu dùng tài sản ngoài · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** background, ảnh/video/nhạc/font của Phase 3. **Dependency:** O03 và sửa X05; X15 nếu license yêu cầu attribution nền.
- **Vì sao cần OWNER:** cần lựa chọn tài sản và giấy phép sử dụng thương mại từ bên có quyền.
- **Bằng chứng:** [background upload](E:/Workspaces/short-factory/apps/api/src/production.service.ts:54), [image processing](E:/Workspaces/short-factory/packages/media/src/background.ts:1). Hiện chỉ ảnh PNG/JPEG/WebP; không có thư viện video nền đã xác minh license.
- **Các bước:** 1. Chọn ảnh tự sở hữu hoặc có license phù hợp. 2. Giữ nguồn/evidence và yêu cầu attribution. 3. Upload tại Studio sau khi lỗi metadata tiếng Việt được CODEX sửa; duyệt hình/narration/output.
- **Thông tin/cấu hình:** ảnh và attestation/evidence ở `/studio`; video nền phải chờ X15, không tải gameplay bên thứ ba tùy tiện.
- **Xác minh:** ảnh thuộc workspace đúng, rights còn hiệu lực, nếu license yêu cầu attribution nền, phải chờ CODEX bổ sung contract/render ở X15 trước khi dùng; upload hiện chỉ ghi basis/attestation/evidence.
- **URL:** nguồn cấp phép thực tế do OWNER chọn; chưa xác minh nhà cung cấp.
- **Có thể bỏ qua?** Baseline /export dùng nền template sẵn, không bắt buộc cung cấp background ngoài. Nếu dùng tài sản ngoài vẫn cần license và attribution tương ứng.

#### O05 — Chốt người duyệt, xử lý dữ liệu và yêu cầu gỡ bỏ

- [ ] **P0 trước nội dung thật · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** membership, editorial, retention/takedown; Phase 1–5. **Dependency:** O01/O03.
- **Vì sao cần OWNER:** quyết định ai được duyệt, thời hạn lưu, người nhận yêu cầu xóa và phạm vi sử dụng là trách nhiệm vận hành.
- **Bằng chứng:** [takedown local](E:/Workspaces/short-factory/apps/api/src/content.service.ts:200), [data policy](E:/Workspaces/short-factory/docs/05-SOURCES.md:21). Chưa có chứng cứ policy production; remote removal/retention scheduler còn thuộc CODEX.
- **Các bước:** 1. Chỉ định OWNER/ADMIN/EDITOR/REVIEWER và kênh tiếp nhận yêu cầu gỡ. 2. Chốt thời hạn lưu bài, audio, video, audit và chứng cứ quyền. 3. Đăng ký tài khoản của người dùng được phép; cấp role tại Settings; duyệt nội dung/PII trước khi dùng thật.
- **Thông tin/cấu hình:** danh sách vai trò và policy không nhạy cảm; `/settings`, `/reviews`; hiện chưa có UI chỉnh retention policy hoàn chỉnh.
- **Xác minh:** hai người/role thử các action được phép và bị cấm; takedown local chặn media; remote removal chờ X16.
- **URL:** trang chính sách riêng của dự án sau khi có domain, chưa tồn tại trong repo.
- **Có thể bỏ qua?** Không trước nội dung thật; có thể hoãn policy công khai cho demo nội bộ tổng hợp.

#### O06 — Cấp domain/DNS và xác nhận nhận diện ứng dụng

- [ ] **P0 trước public deployment; P1 cho OAuth · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** domain registrar/DNS, hosting, OAuth consent; Phase 4–5. **Dependency:** O02.
- **Vì sao cần OWNER:** quyền domain, nội dung nhận diện/legal/contact và thay đổi DNS cần chủ sở hữu.
- **Bằng chứng:** [APP_URL local](E:/Workspaces/short-factory/.env.example:26); [local deployment](E:/Workspaces/short-factory/infrastructure/compose.yaml:90). Không có domain/HTTPS production được kiểm chứng.
- **Các bước:** 1. Chọn domain thuộc quyền quản lý. 2. Cấp quyền DNS giới hạn hoặc thực hiện record do CODEX chuẩn bị. 3. Xác nhận tên app, contact, privacy/terms và chính sách đăng ký. 4. Sau X10, đăng ký redirect URI chính xác do implementation cung cấp.
- **Thông tin/cấu hình:** domain, app name/contact; `APP_URL`, `API_URL`, `ALLOW_REGISTRATION`. Tên biến OAuth chưa được code, không tự đặt `GOOGLE_CLIENT_SECRET` rồi kỳ vọng chạy.
- **Xác minh:** HTTPS hợp lệ, cookie Secure/Origin, callback exact-match trên staging do CODEX kiểm.
- **URL:** console DNS của nhà cung cấp do OWNER chọn; chưa xác minh tài khoản cụ thể.
- **Có thể bỏ qua?** Có cho local; không cho public/OAuth production.

#### O07 — Cấp quyền secret manager và tài khoản vận hành

- [ ] **P0 trước OAuth/paid production · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** secret manager/KMS của hosting đã chọn. **Dependency:** O02.
- **Vì sao cần OWNER:** cấp IAM, quyền đọc/rotate secret và quyền chi tiêu thuộc account owner.
- **Bằng chứng:** [SocialAccount.secretRef](E:/Workspaces/short-factory/prisma/schema.prisma:598), [resolver hiện tại chỉ env reference](E:/Workspaces/short-factory/packages/workflows/src/analytics.ts:34). Chưa có KMS/OAuth lifecycle.
- **Các bước:** 1. Chọn secret store của hạ tầng. 2. Cấp quyền đọc tối thiểu cho runtime phù hợp, tách staging/production. 3. Nạp secret trực tiếp tại console/private environment sau khi CODEX hoàn thiện X10; thống nhất rotation/revocation.
- **Thông tin/cấu hình:** secret reference/IAM identity, không secret plaintext. Hiện analytics hiểu `env:ANALYTICS_TOKEN_*`; env phải được runtime inject an toàn, không commit.
- **Xác minh:** token không nằm trong DB/log/UI, role không được phép không đọc được secret; rotate/revoke được kiểm thử.
- **URL:** console của secret store do OWNER chọn; chưa chọn nên chưa có URL cụ thể được xác minh.
- **Có thể bỏ qua?** Local mock/local speech có thể; production OAuth/paid API không.

### B — Bắt buộc để sử dụng đầy đủ các nền tảng đã chọn

#### O08 — Google Cloud, OAuth và quyền kênh YouTube

- [ ] **P1 · OWNER quản lý kênh · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** YouTube Data/Analytics API; Phase 4–5. **Dependency:** O06/O07, CODEX X10/X11.
- **Vì sao cần OWNER:** tạo/xác minh app và chấp thuận truy cập kênh là thao tác danh tính/account.
- **Bằng chứng:** [publisher chỉ mock](E:/Workspaces/short-factory/packages/publishers/src/index.ts:1); [analytics scopes thật trong code](E:/Workspaces/short-factory/packages/analytics/src/index.ts:138). Không có OAuth callback hay account connect UI.
- **Các bước:** 1. Tạo/chọn Cloud project và bật API cần dùng. 2. Cấu hình branding, audience/test users, consent, scopes tối thiểu và OAuth web client. 3. Sau X10, thêm redirect URI chính xác và cấp consent bằng chủ kênh. 4. Hoàn thành verification/audit nếu console/chính sách áp dụng yêu cầu; giữ bằng chứng.
- **Thông tin/cấu hình:** project ID, channel ID, client ID, granted scopes và trạng thái review; secret qua O07. Chưa có biến OAuth hoạt động hoặc trang Accounts để kết nối. Analytics cần `yt-analytics.readonly` + `youtube.readonly`; upload dùng quyền phù hợp của adapter sau X11.
- **Xác minh:** đọc identity/capability trước; upload thử chỉ sau O12. Không suy quyền từ flag DB.
- **URL:** [OAuth web-server](https://developers.google.com/youtube/data/guides/auth/server-side-web-apps), [consent](https://developers.google.com/workspace/guides/configure-oauth-consent), [videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert).
- **Có thể bỏ qua?** Có nếu chỉ export local. Không hardcode quota hoặc mặc định quy tắc private của tài liệu cũ.

#### O09 — Meta app, quyền Facebook Page và Insights

- [ ] **P1 · OWNER có quyền Page/app · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** Facebook Page Reels/Insights; Phase 4–5. **Dependency:** O06/O07, X10/X11/X13.
- **Vì sao cần OWNER:** cần tư cách developer, quyền Page, consent và review từ Meta.
- **Bằng chứng:** [mock publisher](E:/Workspaces/short-factory/packages/publishers/src/index.ts:1); [Insights adapter](E:/Workspaces/short-factory/packages/analytics/src/index.ts:187). Không có Page thật/token/quyền đã xác minh.
- **Các bước:** 1. Tạo/chọn Meta developer app và Page được quản lý. 2. Xác định use case/Page role và quyền app cần theo phiên bản API hiện hành; làm verification/app review nếu được yêu cầu. 3. Sau X10, cấu hình callback và consent; sau X13, xác minh Insights metric mapping. 4. Lưu approval evidence, không chỉ đánh dấu flag.
- **Thông tin/cấu hình:** app/Page ID, API version, scope thực được cấp; secret qua O07. Code Insights hiện yêu cầu `read_insights`, `pages_read_engagement`; worker đã truyền mapping; metric names/units và API version thực tế vẫn chưa được live-verify. Chưa có biến OAuth Facebook hoạt động.
- **Xác minh:** đọc Page identity/capabilities và sample Insights được phép; test publish cần O12.
- **URL:** [mẫu Reels chính thức của Meta](https://github.com/fbsamples/reels_publishing_apis), [Reels guide](https://developers.facebook.com/docs/video-api/guides/reels-publishing/). Guide trả HTTP 429 khi audit nên **chưa xác minh danh sách permission hiện hành**.
- **Có thể bỏ qua?** Có, dùng YouTube/export. Facebook **Page** không đồng nghĩa Groups/profile.

#### O10 — Quyết định nguồn Reddit và xin quyền sử dụng phù hợp

- [ ] **P1 nếu cần live Reddit · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** Reddit Data API; Phase 2. **Dependency:** O01/O03; X12 trước sync thật.
- **Vì sao cần OWNER:** thỏa thuận sử dụng dữ liệu/commercial approval thuộc chủ ứng dụng và Reddit.
- **Bằng chứng:** [ExternalSourceAdapter](E:/Workspaces/short-factory/packages/sources/src/index.ts:110). Credential và approval flag vẫn không tạo một live adapter.
- **Các bước:** 1. Xác định mục đích commercial, nguồn/phạm vi và retention. 2. Gửi yêu cầu qua cổng chính thức; hoàn thành thỏa thuận nếu Reddit yêu cầu. 3. Lưu quyền được cấp, điều kiện xóa/attribution và account authorization; đưa secret vào O07 sau X12.
- **Thông tin/cấu hình:** approval evidence và nguồn được phép; `REDDIT_ACCESS_TOKEN`, `REDDIT_DATA_USE_APPROVED` trong env example hiện là placeholder **inert**, không đủ để chạy.
- **Xác minh:** access test bằng adapter đã code, pagination/deletion/rate-limit trong scope được cấp; không dùng token cá nhân để né approval.
- **URL:** [Developer access](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data), [Data API Terms](https://redditinc.com/policies/data-api-terms).
- **Có thể bỏ qua?** Có, manual/licensed import thay thế.

#### O11 — Threads và chiến lược dữ liệu Facebook Groups được phép

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

#### O12 — Chấp thuận từng phép thử API thật và publish có kiểm soát

- [ ] **P1 trước live acceptance · OWNER/người quản lý tài khoản · CHƯA ĐƯỢC CHO PHÉP trong audit này.**
- **Dịch vụ/chức năng:** từng provider, Phase 3–5. **Dependency:** các code gate X01–X14 tương ứng đã PASS; quyền platform O08–O11.
- **Vì sao cần OWNER:** user đã cấm phát sinh phí/publish thật khi chưa cho phép; cần chỉ định tài khoản và giới hạn rõ ràng.
- **Bằng chứng:** yêu cầu audit hiện tại; không có live run/remote post ID được kiểm chứng.
- **Các bước:** 1. Sau kết quả mock/fault-injection, chọn một account và media có quyền. 2. Cho phép rõ loại call, số lượng, ngân sách, privacy và thời điểm thử; tách read-only metrics với upload. 3. Duyệt preview rồi mới cho chạy live smoke; kiểm remote result trước mọi retry.
- **Thông tin/cấu hình:** approval không chứa secret, account ID, sample và budget. Chỉ bật capability sau khi kiểm quyền thực; không sửa flag để giả approval.
- **Xác minh:** ghi remote ID/session, read-back trạng thái, media QC, metric provenance, test timeout/reconcile không nhân bản upload.
- **URL:** endpoint docs của platform đã chọn trong O08/O09/O14; không có nút live test khả dụng trong checkout này.
- **Có thể bỏ qua?** Có khi chưa bật integration; không thể tuyên bố production-ready cho integration chưa thử.

#### O13 — Xác định TikTok Direct Post có phù hợp hay giữ manual handoff

- [ ] **P1 cho quyết định TikTok; app Direct Post chỉ khi use case đủ điều kiện · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** TikTok; Phase 4–5. **Dependency:** O01/O03; CODEX X11 làm export.
- **Vì sao cần OWNER:** eligibility/product purpose, creator consent và review không thể giải quyết bằng code/key.
- **Bằng chứng:** [mock TikTok needs action](E:/Workspaces/short-factory/packages/publishers/src/index.ts:1); chưa có Direct Post hoặc export bundle riêng.
- **Các bước:** 1. Giữ tải MP4 và upload thủ công làm mặc định. 2. Đối chiếu mục đích sản phẩm với intended-use guideline; utility nội bộ đăng vào account của mình/đội có thể thuộc trường hợp không được chấp nhận. 3. Chỉ khi phù hợp mới tạo app, xin sản phẩm/scope, thực hiện audit và UX consent bắt buộc. 4. Nếu không phù hợp, ghi quyết định bỏ Direct Post.
- **Thông tin/cấu hình:** eligibility/audit evidence và quyết định handoff; hiện không có env TikTok Direct Post đang hoạt động.
- **Xác minh:** X11 tạo handoff rõ `NEEDS_ACTION`; direct post không được mở trước eligibility/consent và O12.
- **URL:** [TikTok Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines).
- **Có thể bỏ qua?** Có thể bỏ Direct Post lâu dài. Đây không đơn thuần là thiếu API key; tạo app không bảo đảm được duyệt.

#### O14 — Cấp consent cho metrics đúng tài khoản và scope

- [ ] **P1 khi bật live analytics · OWNER/người quản lý account · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** YouTube Analytics, Facebook Insights, TikTok Display metrics; Phase 5. **Dependency:** O07, account/app phù hợp; X13.
- **Vì sao cần OWNER:** consent/entitlement dữ liệu của tài khoản và quyền provider không thể tự cấp.
- **Bằng chứng:** [live adapter gates](E:/Workspaces/short-factory/packages/analytics/src/index.ts:118), [secret injection](E:/Workspaces/short-factory/packages/workflows/src/analytics.ts:34). Không có token thực trong environment audit.
- **Các bước:** 1. Chọn account và metrics cần dùng. 2. Cấp quyền đọc tối thiểu bằng OAuth sau X10, kiểm scope thực. 3. Nạp token qua O07; duyệt read-only smoke qua O12. 4. Xác nhận metric definition, period và dữ liệu còn thiếu.
- **Thông tin/cấu hình:** `ANALYTICS_LIVE_ENABLED`, `SocialAccount.secretRef=env:ANALYTICS_TOKEN_...`, granted scopes/approval/CONNECTED sau khi được xác minh. Không tạo SocialAccount/quyền bằng SQL tay.
- **Xác minh:** snapshot provider/period/freshness đúng, null không biến thành 0; token expired/revoked bị chặn.
- **URL:** [YouTube reports](https://developers.google.com/youtube/analytics/reference/reports/query), [TikTok video query](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query). TikTok `video.list` cho metrics được ủy quyền là quyền khác với Direct Post.
- **Có thể bỏ qua?** Có, manual metrics sau khi có publication/handoff workflow; synthetic data không được coi là hiệu quả thật.

### C — Tùy chọn, có thể làm sau

#### O15 — Chọn LLM/TTS trả phí, tài khoản và billing

- [ ] **P2; P1 nếu yêu cầu AI/speech provider thật · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** OpenAI script/TTS hiện có; Phase 3/5. **Dependency:** O01/O07 và CODEX X07 trước sử dụng có phí.
- **Vì sao cần OWNER:** mở account, payment, đồng ý xử lý nội dung và trần chi tiêu cần chủ tài khoản.
- **Bằng chứng:** [script adapter](E:/Workspaces/short-factory/packages/media/src/script.ts:70), [TTS adapter](E:/Workspaces/short-factory/packages/media/src/tts.ts:84). Không có `OPENAI_API_KEY` trong môi trường audit. Local speech tiếng Việt đã tạo WAV và MP4 thật qua WSL; mock tone không phải giọng đọc.
- **Các bước:** 1. Chọn dùng local speech hay paid provider. 2. Nếu trả phí, tạo project/key theo quyền tối thiểu và quản lý billing/budget. 3. Chọn model/voice được account hỗ trợ; đưa key trực tiếp vào secret store. 4. Chỉ cho phép smoke nhỏ sau X07/O12.
- **Thông tin/cấu hình:** `SCRIPT_PROVIDER=openai`, `SCRIPT_MODEL`, `TTS_PROVIDER=openai`, `TTS_MODEL`, `OPENAI_API_KEY`, `TTS_COST_PER_1K_CHARS`. Không cần tạo hai account nếu cùng provider.
- **Xác minh:** kiểm output grounded/speech/timing/usage; Autopilot hiện cố ý báo `PAID_PROVIDER_BUDGET_UNBOUNDED`, không mở bằng cách sửa approval flag.
- **URL:** [OpenAI quickstart](https://developers.openai.com/api/docs/quickstart).
- **Có thể bỏ qua?** Có, deterministic script + local TTS để kiểm luồng; không tương đương AI provider đã test thật.

#### O16 — Chọn và cấp Cloudflare R2 nếu cần remote object storage

- [ ] **P2 cho local; P1 trước deployment dùng R2 · OWNER · CHƯA XÁC MINH.**
- **Dịch vụ/chức năng:** Cloudflare R2; Phase 3/production storage. **Dependency:** O02/O07 và CODEX X14.
- **Vì sao cần OWNER:** subscription, payment, bucket và IAM thuộc chủ account.
- **Bằng chứng:** [storage chỉ local fs](E:/Workspaces/short-factory/packages/media/src/index.ts:9); không có R2 adapter hoặc biến R2 được sử dụng.
- **Các bước:** 1. Chọn R2 hoặc lưu trữ production khác. 2. Nếu chọn R2, bật subscription và tạo bucket private riêng cho staging/production. 3. Tạo quyền object giới hạn bucket, thống nhất retention/access policy. 4. Cấp endpoint/bucket/reference cho CODEX sau khi adapter sẵn.
- **Thông tin/cấu hình:** account/bucket/endpoint và secret reference. **Chưa có tên env R2 hoạt động**; CODEX phải bổ sung contract/config trong X14, không yêu cầu OWNER sửa source.
- **Xác minh:** private read/write, checksum, workspace isolation, delete/takedown và restore; không public bucket tùy tiện.
- **URL:** [R2 Get started](https://developers.cloudflare.com/r2/get-started/).
- **Có thể bỏ qua?** Có cho local hoặc nếu chọn storage khác đáp ứng yêu cầu. Tạo bucket riêng không làm app hiện tại tự dùng R2.

### Bằng chứng hoàn tất cần lưu

Mỗi mục chỉ đổi thành `[x]` khi có bằng chứng không nhạy cảm: ID resource/account, scope thực, approval/reference, owner decision và kết quả verification có ngày. Không lưu token, API key hay refresh token vào checklist. CODEX phải cập nhật code/test tương ứng trong lượt triển khai sau được cho phép.

Các tài liệu chính thức được truy cập ngày **28/10/2026**; trang Meta nêu trên bị HTTP 429 nên ghi rõ chưa xác minh nội dung hiện hành. Không có tài khoản bên ngoài nào được đăng nhập/thay đổi trong lần audit này.


## F. CODEX REMAINING WORK

Các mục dưới đây là **công việc code/kiểm thử của CODEX**, không thực hiện trong audit. P0 là gate chặn phát hành/vertical slice đã cam kết; P1 cần trước khi bật chức năng hoặc vận hành thường xuyên; P2 có thể theo sau. Thứ tự bảng thể hiện quan hệ phụ thuộc; quyền bên ngoài không thay thế acceptance code.

| ID/Ưu tiên | Feature, vấn đề hiện tại và file liên quan | Dependency | Acceptance criteria | Cách kiểm thử |
|---|---|---|---|---|
| X01 · P0 | **ĐÃ ĐÓNG LOCAL V01**. Sửa audio collision G01; media pipeline:287–315 và TTS cache key:144 (S09/S10) | Không; O02 cho DB test | Mỗi segment có link audio hợp lệ dù text trùng; replay không nhân asset | DB-backed manual post + **3 comments**, worker chạy tới reviewed MP4; crash/replay |
| X02 · P0 | **PARTIAL: grounding đóng, mandatory QC còn mở**. Enforce COMMENT grounding mọi narrationType, manual/auto QC thống nhất; script:113, production review:211 (S08/S10/S15) | X01 để full flow | COMMENT bịa không được tạo/render/approve; commentary phải khác quoted comment; review không vượt mandatory QC | PATCH/provider malicious output với 3 types; direct API + worker; valid paraphrase chỉ đúng policy |
| X03 · P1 | **ĐÃ ĐÓNG LOCAL V01**. Bind audio/voice/rate/provider/model vào rendition và manifest; pipeline:314/342/402 (S09) | X01 | Mỗi render chỉ dùng audio của cấu hình cụ thể; duration không cộng bản cũ; model đổi không hit cache sai | Hai voice/rates cùng storyVersion, deterministic replay và concurrency |
| X04 · P1 | **PARTIAL: /export đóng; clients khác còn mở**. Operation idempotency qua UI lost response; api.ts:18, Studio:237, backend create mutations (S18/S19/S08) | X01/X03 | Retry cùng logical action dùng cùng key; không tạo production/run/budget trùng | Mô phỏng commit xong mất response, retry/reload; khác payload conflict |
| X05 · P1 | Sửa Unicode upload, capture form trước await, preserve API errors; Studio:229–246 và production upload:54 (S19/S08) | Không | Tên/evidence tiếng Việt upload được, success không thành lỗi, message validation đúng | Browser upload UTF-8 + successful reset + denied rights/oversize |
| X06 · ĐÓNG LOCAL, CÒN FULL OPS | V02: media/manual-import/queued sync DB recovery + attempt/event fencing PASS | Full automation/RUNNING source sync cần scope riêng | Không reclaim lease sống/terminal; durable version + bounded counters | PostgreSQL/BullMQ mất delivered job, competing sweepers, stale attempt/event PASS; production soak chưa chạy |
| X07 · P0 trước paid API | Budget reservation/accounting cho **manual và Autopilot**; media guard:137, workflow paid block:117 (S09/S16) | O01/O15; X06 | Paid calls có bounded admission/usage settlement và timeout semantics; không “fix” bằng bỏ paid block | Mock provider charge/timeout/crash, concurrent caps, model-price config, exhausted workspace |
| X08 · ĐÓNG DEADLINE/CANCEL, CÒN QUOTA | V02: owned render child, abort/deadline/cleanup PASS | CPU/RAM quota và resource profiling ngoài scope local | Cancel/timeout không tạo completed output; explicit retry thành công | Mid-render cancel/timeout thật PASS; production resource/soak chưa chạy |
| X09 · PARTIAL | V01/V02 local gates và recovery tests PASS; CI thêm export browser/smoke | Remote CI, fresh-host reproduction, production load/soak chưa xác minh | Giữ exact test counts/artifacts trong report Phase6 | Không paid calls/publishing; không dùng mock tone làm bằng chứng speech quality |
| X10 · P0 trước external production | OAuth start/callback, state/CSRF/PKCE khi áp dụng, refresh/revoke, encrypted secret lifecycle; API routes/schema/accounts UI (S03/S04/S13/S17/S18) | O06/O07, O08/O09 khi kết nối | Real account connection, provider grants/capabilities verified, secrets không plaintext/log; auth/tenant chuẩn | Mock OAuth threats, revoke/refresh/expiry/concurrent tenant tests; read-only live sau approval |
| X11 · P0 trước publish | Phase4 durable per-target publishing worker, adapters YouTube/Page, validations, schedule TZ, attempt/session/reconcile, TikTok export/handoff và /accounts,/publishing (S05/S13/S16/S18) | X02/X06/X10, O08/O09/O12/O13 | Human approval/current rights hai phía; ambiguous upload reconcile trước retry; account-independent states; no fake success production | Contract + mock E2E/fault-injection 401/429/5xx/timeout; sau đó live smoke được OWNER cho phép |
| X12 · P1 nếu cần live discovery | Implement source adapters có capability thật; dedupe/metrics replay G10; source index + discovery pipeline (S06/S07) | O10/O11 tương ứng | Không khả năng ngoài scope, cursor/deletion/rate-limit/retention đúng, replay SUCCEEDED không duplicate metrics | Approved-fixture contract+SQL tests; read-only live sau scope verification |
| X13 · P1 | Hoàn thiện token refresh/revoke integration, metric-config/period UI và production tests; workflows analytics:34–38, adapters:187, Analytics UI (S17/S19) | X10/X11 cho publications thật; O14 | Worker đã truyền FB mapping; UI/config phải cho quản lý definitions/units/period đúng, token lifecycle tích hợp; snapshot authorized, no fabricated zero | Worker-level mock HTTP, mapping/count/unit variants, real authorized read smoke sau O12 |
| X14 · P1 trước remote storage | Storage abstraction + R2/private URLs/stream/retention/delete; local store concrete (S12/S08/S09) | O16 nếu R2; O07 | API/worker cùng store, checksum/workspace checks, private access, safe signed expiry, takedown/restore | Local contract và S3 fixture; staging bucket check có phép, no public exposure |
| X15 · P2 | Video backgrounds/library/looping/mixing, background attribution metadata/render và forced/provider alignment nếu tiếp tục full Phase3 scope; media package/Studio (S11/S12/S19) | X01/X03/X08, O04 | Licensed assets/attribution managed; precise timing thật hoặc giữ approximate label; media QC phù hợp | Media fixture render, rights/loop/duration/audio/QC regression |
| X16 · P1 trước nội dung thật ở scale | Retention scheduler/remote takedown and reconciliation; content takedown:200, delete outbox, publishers (S05/S09/S13) | O05, X11/X14 | Due content scrub/revoke, remote state NEEDS_ACTION tới khi verify removed; no orphan leakage | Due retention/time travel, takedown after upload/timeout, cross-tenant deny |
| X17 · P0 trước public deployment | Production infra, trusted/distributed rate limiter, worker health, backups, quotas, telemetry/alerts/DLQ; auth:27/app:175/Compose/CI (S03/S20) | O02/O06/O07, X06/X08 | Production env chặn mocks, HTTPS, multi-replica auth đúng, backup restore, process/resource health, actionable logs/alerts | Proxy two-clients, load/render/soak, restore drill, worker death, secret/log probes |
| X18 · PARTIAL, ĐÓNG EXPORT | V02: /export history/resume/filter/pagination/cancel, reload đã verified | Dashboard/approval diff/analytics/settings completeness ngoài Phase6 | User mở tab mới thấy run lỗi/đang chạy theo workspace | 6 export browser tests + API tenant/cursor/cancel tests PASS; full ops UI còn mở |
| X19 · P2 | Recommendation application + experiment outcome workflow nếu muốn optimization loop (S15/S17) | X13, dữ liệu thật đủ mẫu, O01 policy | Accept có versioned proposal/change cần duyệt; evidence/sample boundaries, không causal claim sai | Deterministic assignments, no reuse, inadequate samples, drift/rollback/human approval |
| X20 · P1 tài liệu/gates | **PARTIAL: dependency cài hoàn chỉnh; audit đang đồng bộ**. Đồng bộ báo cáo sau khi gate thực sự PASS và khôi phục môi trường audit sạch, không sửa source để che lỗi (S01/S20–S24) | X09; cleanup theo policy khi được phép | docs status phản ánh current logs; không còn artifact deps dở; không đánh “Phase1–5 complete” từ file/class | git diff/status + logs + artifact provenance |

Cài dependencies/generate client/chạy tests là việc CODEX có thể thực hiện trong lượt verification được cho phép, không phải “owner phải tự sửa”. OWNER chỉ cần O02 cấp hoặc cho phép môi trường/dữ liệu test chuyên dụng. Tương tự, chưa có biến OAuth/R2 thì CODEX phải thiết kế/bổ sung config khi implementation, không yêu cầu OWNER đoán tên biến.

## G. Bugs & Technical Debt

### Các lỗi có tình huống cụ thể

13 nhóm từ audit baseline và G14 phát hiện khi verification Phase6; không liệt kê “style taste”. “Tái hiện mới” giới hạn chính xác mức kiểm chứng, không đồng nhất với full DB/browser E2E.

| ID / Ưu tiên | Lỗi, trigger và hậu quả | Bằng chứng, mức kiểm chứng | Sửa tối thiểu / ảnh hưởng nếu hoãn |
|---|---|---|---|
| G01 · ĐÃ ĐÓNG LOCAL | Cache cùng text trước đây làm thiếu AudioAsset; hiện key gồm segment, run lưu exact audio IDs | Regression 3 comments/replay + full queue/render V01 PASS | Không còn blocker baseline; tiếp tục giữ regression |
| G02 · ĐÃ ĐÓNG LOCAL | Audio selection đóng băng theo run/rate/provider/model, không cộng lịch sử cũ | Audio selection/rate/model/legacy/tenant tests PASS V01 | Chưa suy ra provider paid đã live-verify |
| G03 · ĐÃ ĐÓNG LOCAL | COMMENT phải VERBATIM và exact excerpt, ở schema lẫn assertGroundedScript | Grounding regression PASS + full local narration V01 | Mandatory QC manual/auto thống nhất vẫn nằm X02 PARTIAL |
| G04 · P1 | Tên/evidence tiếng Việt đưa raw HTTP headers → ByteString TypeError trước fetch | S19 Studio:236–239; S08 upload:58. **Đã tái hiện 2 Headers TypeError bằng Node built-in, không gửi request** | Metadata UTF-8 multipart/JSON hoặc encoding hai phía; tính năng upload cho người dùng Việt bị hỏng |
| G05 · P2 | Upload đã await xong mới event.currentTarget.reset; có thể currentTarget=null, báo lỗi sau success. API validation message cũng bị generic connection error che | S19 Studio:229–246. Source-only; chưa browser reproduce | Capture form trước await, dùng ApiError chuẩn; hoãn gây false failure và retry thừa |
| G06 · P0 trước paid | Manual media không có parent Autopilot nên assertAutomationAction return; OpenAI calls thiếu cap/reservation; paid auto thì bị chặn | S09:137–145/249–251/290–291; S16:117. Source-only | Budget admission thống nhất; hoãn gây chi phí vượt policy khi bật paid manual |
| G07 · ĐÓNG LOCAL, CÒN PHẠM VI HOÃN | Media/manual-import/queued sync delivery mất trong Redis được đối chiếu và phát lại từ DB, giữ event ID/version và bounded recovery | Recovery unit + PostgreSQL/BullMQ fault tests PASS V02 | RUNNING synthetic source sync chưa có durable lease/fence: chưa reclaim; không đánh đóng toàn hệ thống |
| G08 · ĐÃ ĐÓNG LOCAL | Wall-clock deadline/cancel xuyên bundle/browser/encode trong owned child; cleanup trước khi nhả lease | Render-control tests + abort/timeout thật + retry/download PASS V02 | CPU/RAM isolation/quota và production soak chưa triển khai |
| G09 · ĐÃ ĐÓNG LOCAL | Progress/failure/lease writes fence theo active attempt; event cũ không tiêu hao epoch retry mới | Stale attempt/event regression + Serializable claim/version check PASS V02 | Giữ regression khi thay đổi orchestration |
| G10 · ĐÃ ĐÓNG LOCAL | Completed/terminal sync delivery replay là no-op, không tạo metrics lần nữa | Replay regression cho SUCCEEDED/PARTIAL/FAILED/CANCELLED PASS V02 | Chưa suy ra live provider đã được kiểm chứng |
| G11 · P1 public auth | Next rewrite gom request tới API; limiter request.ip không trust proxy → nhiều users chung quota 30/15min; in-memory map không shared replicas | S03 auth:27–35/app:175–201; [Next proxy](E:/Workspaces/short-factory/apps/web/next.config.ts:5). Source-only | Trusted proxy boundary + shared limiter; không tin X-Forwarded-For tùy ý |
| G12 · P1 · ĐÓNG MỘT PHẦN | /export giữ cùng key khi retry lost response; helper API nhận key override | Unit + browser lost-response retry PASS V01 | Studio/clients khác chưa áp dụng đầy đủ; không đánh đóng toàn hệ thống |
| G13 · P2 · ĐÓNG EXPORT | /export có scoped history, status filter, pagination và resume từ tab mới; scoped session IDs | V01 real reload + V02 API/6 browser tests | Studio/dashboard/analytics completeness ngoài phạm vi Phase 6 còn mở |
| G14 · ĐÃ ĐÓNG LOCAL | Remotion bind IPv4 nhưng advertise localhost, browser có thể vào app khác trên IPv6 cùng port | Tái hiện thật MEDIA_RENDER_FAILED; owned numeric-loopback server/cổng OS cấp + regression + smoke PASS V02 | Giữ test khi nâng renderer; không cần dừng app khác |

### Audit UI/UX — 17 màn hình yêu cầu và /export local

Routes hiện có: dashboard, channels, sources, library/posts, reviews, studio, **export**, autopilot, analytics, settings, guide. Post details/editor/preview/rules có thể tích hợp trong màn hình khác; thiếu route riêng không tự động nghĩa thiếu chức năng.

Các routes thực nằm dưới [workspace app directory](<E:/Workspaces/short-factory/apps/web/app/(workspace)/layout.tsx:1>); bằng chứng chính là component thực thi S18/S19.

| Màn hình | Trạng thái / path thực tế | Backend/buttons/forms | Phần thiếu hoặc chưa verify |
|---|---|---|---|
| Dashboard | PARTIAL · /dashboard; S18 workspace-page:53–71 | GET dashboard/posts thật | Thiếu queue/failures/budget/last sync; badge Phase2 cũ |
| Content Sources | DONE_UNVERIFIED · /sources; workspace:89–148 | CRUD/verify/sync/toggle/history thật, native constraints | External blocked; source list 50 chưa phân trang |
| Content Library | DONE_UNVERIFIED · /library/posts; workspace:151–220 | Posts/candidates filters/pagination; JSON Zod import | Không runtime/browser mới |
| Post Details | DONE_UNVERIFIED · inline library/reviews; workspace:222–279 | Comments/eligibility/review/takedown APIs thật | Không cần route detail riêng; privacy review cần người |
| Video Studio | DONE_UNVERIFIED · /studio | Source-grounded production APIs thật | G04/G05 upload Studio còn mở; /export full flow đã verify riêng |
| Script Editor | PARTIAL · Studio | Version/reorder/save có; grounding đã sửa và test | Advanced controls và Studio browser flow chưa verify |
| Media Library | PARTIAL · Studio:229–246/286–289 | Background list/upload/select có rights | Chỉ ảnh, chưa video/catalog quản lý; Unicode bug |
| Video Preview | DONE_VERIFIED cho /export; Studio còn riêng | Auth MP4 metadata/playback/download thật PASS | Remotion editable Studio preview chưa browser-verify mới |
| Render Jobs | DONE_VERIFIED local tại /export; Studio còn PARTIAL | History/status filter/pagination/resume/cancel + current-run progress/retry | Full ops/DLQ UI và Studio global history còn ngoài scope |
| Social Accounts | NOT_STARTED · không /accounts | /automation/accounts chỉ đọc identity/status | Không connect/disconnect/scopes/privacy UI |
| Publishing Calendar | NOT_STARTED · không /publishing | Không schedule/calendar actions | Phase4 chưa implement |
| Publishing History | PARTIAL · /analytics; Analytics:102–105 | Publication list/snapshot history/sync status | Không upload attempts/reconcile/safe retry UI |
| Analytics | DONE_UNVERIFIED · /analytics; Analytics:37–110 | Overview/history/manual import/refresh/recommendations/experiments APIs | Live blocked; filter scope G13 |
| Autopilot | PARTIAL · /autopilot; Autopilot:27–126 | Rules/run/dry-run/control/budget/history thật | UI tests mocked; production publish/paid auto chưa |
| Automation Rules | DONE_UNVERIFIED · Autopilot:67–114; Settings:287–319 | PUT expectedVersion, controls/topic rules thật | Runtime validation/state chưa test mới |
| Approval Inbox | PARTIAL · Autopilot:126, Studio:305, /reviews | Reject/approve role-gated API; QC/rights visible | Dedicated source/script side-by-side đầy đủ chưa có; manual QC loophole |
| Settings | PARTIAL · /settings; workspace:282–344 | Workspace/members/topic rules/audits thật | Không provider OAuth/credentials/retention policy UI |
| Local export bổ sung | DONE_VERIFIED local · /export; V01/V02 | Form/review/render/download; history/resume/filter/pagination/cancel | Local only; không fetch link hoặc publish |

Có loading/empty/error/retry components: [feedback](E:/Workspaces/short-factory/apps/web/components/feedback.tsx:3), [phase5 hooks](E:/Workspaces/short-factory/apps/web/components/phase5-shared.tsx:7), workspace loading/error routes. GET responses Zod-validate; forms dùng required/min/max/email/number và server Zod, import/editor có client Zod. Role-based visibility không thay thế server checks.

CSS có responsive/accessibility controls. /export đã browser-verify desktop và mobile 390×844, không overflow/page errors; strict TypeScript toàn repo PASS trong V01. Studio/Autopilot/Analytics chưa được suy là responsive đầy đủ từ kết quả /export.

### Chất lượng code, database và infrastructure

| Hạng mục | Kết quả audit | Bằng chứng / giới hạn |
|---|---|---|
| TypeScript strictness | strict/noUncheckedIndexedAccess và no-explicit-any, typecheck/lint PASS | S02/V01; 13 packages |
| Auth/authz/tenant | Server derive session→membership, role guards; workspace FK composite | S03/S04/S22/V02; cross-tenant FK/API/cursor/cancel tests trong 64 integration tests PASS |
| Schema/migrations | Prisma validate và 5 migrations trên DB local/test PASS | S04/V01; chưa production drift/restore |
| SQL constraints | Unique/FK/index mạnh cho tenant/dedupe/idempotency | S04. Không thấy RLS/SQL CHECK; Zod không bảo vệ direct DB writer, cần xem theo deployment threat model |
| OAuth token security | Schema chỉ secretRef, không plaintext access/refresh columns | S04/S17. Chưa có OAuth/KMS/refresh lifecycle; không gắn security DONE |
| Secrets/config | .env.example placeholders, ignore env/object/generated, no real token observed | S20. Không secret scan cloud/history sâu; không tuyên bố “không có secret ở mọi nơi” |
| SSRF/import | Canonical URL là provenance, không fetch; future network adapters phải có controls | S05/S06. Không có basis cho unrestricted crawler |
| API rate limits | Auth local guard và queue rate config có | G11; thiếu shared/admission limiter cho expensive upload/import/render |
| Retry/idempotency | Transactional outbox, stable queue ID, leases/serializable/versioning | S07/S09/S14/S16; G01/G02/G07/G09/G10/G12 còn gaps |
| Render resource management | Concurrency config, renderer ngoài API, temp cleanup | S09/S12/S20; G08, chưa đo tải/limit container |
| Budget enforcement | Autopilot reservations/estimates có, billed unknown | S16, G06; paid auto fail-closed đúng, manual chưa đủ |
| Emergency stop | Cấm stage mới; local renderer quan sát controls và abort child | S14/S16/S09/V02; provider call khác chưa có abort xuyên suốt |
| Observability | Request ID/security headers/error-code logs, worker JSON logs | S03/S07/S09; chưa OTel/metrics/traces/alert sink/DLQ UI, automation logs thiếu context |
| Deployment | Local Docker volume/health/non-root tồn tại | S20; workers hardcode development; không production config/resource/restart/backup evidence |
| Compliance | Rights gate/provenance/PII redaction/local takedown | S05/S10/S15; G03, remote removal/retention/actual licenses chưa giải quyết |

### Lệnh thực hiện, kết quả và giới hạn — baseline V01

| Gate | Kết quả đã chạy trong lượt export local | Giới hạn |
|---|---|---|
| Frozen install + Prisma generate/validate | PASS | Không đổi lockfile; không gọi provider |
| 5 migrations | PASS trên DB local mới và *_test | Không reset/xóa dữ liệu cũ, chưa production deploy |
| Lint + strict typecheck | PASS root và 13 packages | Không phải security/load audit đầy đủ |
| Unit/contract | 116/116 PASS, 20 files | Có mock adapters; live credentials không được thử |
| PostgreSQL integration | 59/59 PASS, 5 files | DB riêng *_test và scoped fixture cleanup |
| Build | 13/13 PASS, có /export | Turbo outputs warning cho tsc --noEmit, Docker chưa build lại |
| Browser export mock | 3/3 PASS | Mock contract; không thay thế full flow thật |
| Full API/queue + full browser local | PASS; số liệu/artifacts V01 | Dữ liệu tổng hợp, speech offline, human review, không publish |
| Playback/download | MP4 decode/playback + attachment download PASS | Chưa audio perceptual quality/load/soak benchmark |
| Live source/publish/metrics/paid API | KHÔNG CHẠY | Giữ gates bên ngoài; chưa được cho phép live smoke |
| Redis-loss/crash/cancel/timeout/history | CHƯA ĐÓNG tại baseline | Phạm vi Phase6 được OWNER xác nhận, cần report riêng sau test |
| Remote CI/production backup/restore/load | CHƯA XÁC MINH | Cấu hình CI hoặc local PASS không chứng minh production-ready |

Các lệnh tương đương: pnpm db:generate, pnpm db:validate, pnpm lint, pnpm typecheck, pnpm test, pnpm test:integration, pnpm build; UI: pnpm --filter @shorts-factory/web exec playwright test --config playwright-local-export.config.ts. Verification dùng binary Node trực tiếp khi cần tránh bootstrap ngoài dự kiến. Chỉ chạy integration/browser với DB fixture riêng và queue riêng; không FLUSHDB, reset hoặc truncate dữ liệu đang dùng.

Audit đầu 6 focused assertions xác nhận G01/G03/G04 tồn tại; sau đó G01/G03 đã có regression RED→GREEN và full local verification. G04/G05 vẫn mở vì /export không dùng upload background. Docs12–15 là lịch sử; docs16/V01 là local baseline, docs17/V02 là reliability verification. CI đã thêm export browser/render smoke; remote CI chưa xác minh.

## H. Production Readiness Assessment

Đánh giá phạm vi sản phẩm đầy đủ trong PRD, không đồng nhất local startup với production. NOT_VERIFIED nghĩa thiếu bằng chứng; NOT_READY nghĩa code/chức năng thiết yếu còn thiếu/lỗi; BLOCKED chỉ rõ phụ thuộc bên ngoài.

| Lĩnh vực | Trạng thái | Lý do và gate trước production |
|---|---|---|
| Functional completeness | NOT_READY | Slice manual local verified; Phase4/live integrations/advanced ops còn thiếu |
| API integrations | BLOCKED | Live source/publisher code còn thiếu và permissions CHƯA XÁC MINH; X10–X13 + O08–O14 |
| Content discovery | PARTIALLY_READY | Local manual recovery/terminal replay PASS; RUNNING synthetic sync/live providers còn mở |
| Video generation | PARTIALLY_READY | Local Vietnamese MP4 + cancel/deadline/retry/recovery PASS; full QC/background/upload còn gaps |
| Publishing | NOT_READY | 501/publication mock-only, không OAuth/reconcile/handoff đầy đủ |
| Analytics | PARTIALLY_READY | Manual/mock + read-adapter code; live metric definitions/grants/data chưa xác minh |
| Automation | PARTIALLY_READY | Versioned/local orchestration có; paid auto blocked, review/QC/recovery còn gaps |
| Security | PARTIALLY_READY | Local auth/tenant/CSRF tests PASS; OAuth/KMS/distributed limiter và production audit chưa đủ |
| Reliability | PARTIALLY_READY | Local media/manual recovery/cancel/fencing verified V02; full automation/provider recovery, other client idempotency, load/soak còn mở |
| Performance | NOT_VERIFIED | Không benchmark tải/concurrency/render RAM/CPU/latency/soak |
| Deployment readiness | NOT_READY | Compose development, thiếu production secrets/HTTPS/backup/resource/health/restore gates |
| Observability | PARTIALLY_READY | Logs/request IDs có; metrics/traces/alerts/DLQ/run correlation chưa đủ |
| Compliance | PARTIALLY_READY | Grounding bug đã sửa; rights/licences thật, retention và remote removal chưa xác minh |

**Blocker trước production đầy đủ:** X06/X08 reliability, X07 paid-budget, X10/X11 OAuth/publishing/reconcile, X17 production HTTPS/IAM/limits/backup/monitoring và O03/O04/O05/X16 rights/retention. G01/G02/G03 và local current-check gates đã đóng ở V01, không tiếp tục ghi là blocker đang tồn tại.

Phạm vi Phase6 local manual/offline/download đã được triển khai và kiểm chứng V02; không cần chờ provider approvals để dùng local. Production/social phases vẫn tách riêng và fail-closed.

## I. Recommended Next Actions

| Thứ tự | Việc tiếp theo | Trách nhiệm | Gate |
|---|---|---|---|
| 1 · DONE | Cập nhật audit V01/V02, giữ local vs production riêng | CODEX | Báo cáo này, docs17 và OWNER checklist đã đồng bộ |
| 2 · DONE LOCAL | Phase6 local history/resume/cancel/deadline | CODEX | Tenant/role/idempotency + 6 export browser tests + real render abort PASS |
| 3 · DONE LOCAL | DB recovery sau mất Redis delivery, durable retry bounds/fencing | CODEX | Isolated SQL/Redis fault tests PASS; RUNNING source sync vẫn hoãn rõ phạm vi |
| 4 · DONE LOCAL | Giữ baseline 3-comment local review/download hoạt động | CODEX | Full actual smoke/regressions/build/type/lint PASS V02 |
| 5 | Chốt/cung cấp quyền nội dung thật và reviewer thực tế | OWNER · O03/O05 | Không dùng synthetic rights như bằng chứng license thật |
| 6 | Sửa Studio upload và remaining client idempotency/QC | CODEX · X02/X04/X05 | Tests tiếng Việt/lost response/manual QC |
| 7 | Cấp domain/IAM và app approvals khi chọn triển khai ngoài local | OWNER · O06–O14 | Approval/entitlement evidence, không chỉ flag |
| 8 | Triển khai Phase4/remote analytics và storage theo scope được duyệt | CODEX · X10–X14 | Mock faults trước live, live cần O12 |
| 9 | Production backup/restore/limiter/metrics/retention và paid caps | CODEX · X07/X16/X17 | Operation/load/security proof |
| 10 | Đánh giá production readiness riêng sau local Phase6 | OWNER + CODEX | Không đánh đồng local reliability với toàn PRD shipped |

**Quyết định Phase 6:** OWNER đã chọn “Ổn định export local: lịch sử render, hủy/timeout, phục hồi job và kiểm thử”. Scope/acceptance đã hoàn tất và kiểm chứng local; kết quả cuối ở docs/17-PHASE-6-REPORT.md. Không suy ra Phase4/5, remote CI, Docker rebuild hoặc production load/soak đã đạt.

Báo cáo này là baseline sau local export; các findings giữ ID để theo dõi đóng/mở. Chưa gọi dịch vụ trả phí, chưa fetch bài thật hoặc publish thật. Lượt audit đầu và lượt triển khai sau có phạm vi thay đổi khác nhau được phân biệt rõ; hiện dependencies không còn dở.
