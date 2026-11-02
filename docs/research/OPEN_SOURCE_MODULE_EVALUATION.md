# Open-source module evaluation — source inspection

Inspected **2 November 2026**, shallow source checkouts under ignored `.data/research-2026-11-02/`. No upstream code or dependencies were incorporated into the product. Recommendations concern specific modules, not wholesale integration. Source is pinned below so later upstream changes cannot silently change the decision.

| Repository | Inspected commit | Root license verified from source |
|---|---|---|
| [Postiz](https://github.com/gitroomhq/postiz-app) | `4d13c6a2a84796ea5000baf08459417ec015ef3d` | [AGPL-3.0](https://github.com/gitroomhq/postiz-app/blob/4d13c6a2a84796ea5000baf08459417ec015ef3d/LICENSE) |
| [Postmill](https://github.com/postmill-ai/postmill-app) | `564569110b267562a21bc662a8d30ea77786ea6e` | [AGPL-3.0](https://github.com/postmill-ai/postmill-app/blob/564569110b267562a21bc662a8d30ea77786ea6e/LICENSE) |
| [Short Video Maker](https://github.com/gyoridavid/short-video-maker) | `9bb9a212ced86caa7e09099c382da1a44d638760` | [MIT](https://github.com/gyoridavid/short-video-maker/blob/9bb9a212ced86caa7e09099c382da1a44d638760/LICENSE) |
| [ShortGPT](https://github.com/RayVentura/ShortGPT) | `3df4e0f7a422bf7386565d498bf4521a2544c614` | [MIT](https://github.com/RayVentura/ShortGPT/blob/3df4e0f7a422bf7386565d498bf4521a2544c614/LICENSE) |

License gate: Postiz/Postmill remain **REFERENCE ONLY**. No code copying, package incorporation or extracted service is approved without an explicit review of the actual integration/distribution/operation and corresponding compliance plan. Service separation is not treated as removing AGPL obligations. These are engineering decisions and review requirements, not a legal clearance. MIT reuse still needs notice preservation and review of dependencies, models, assets and APIs. Remotion has its own [commercial licensing terms](https://www.remotion.dev/docs/license); an upstream MIT root does not replace them.

## Postiz

Actual inspected source: `apps/backend/src/api/routes/integrations.controller.ts`, `posts.controller.ts`; `libraries/nestjs-libraries/src/integrations/social.abstract.ts`, `social/youtube.provider.ts`, `social/facebook.provider.ts`; `database/prisma/posts/posts.service.ts`, `posts.repository.ts`; frontend `components/launches/calendar.tsx`, `calendar.context.tsx`, `new-launch/providers/youtube/youtube.provider.tsx`. These implement real provider-specific auth/upload/metrics and composer/calendar behavior, not just README claims.

| Candidate | Ours now | Upstream / potential use | Complexity | Maintenance risk | Dependencies | License | Decision |
|---|---|---|---|---|---|---|---|
| Social OAuth/account connection | SocialAccount rows/status only; no verified OAuth | Study provider auth/token refresh/account selection contracts | High | Provider/API permission churn | Nest, provider SDKs, upstream auth/storage | AGPL review required | Reference now; evaluate adapter only later |
| YouTube/Facebook publishing | PublisherAdapter + mocks; production scheduling blocked | Reference chunked/provider upload and per-platform validations | High | Ambiguous timeouts require our durable reconciliation | Google/provider APIs, HTTP/media helpers | AGPL review required | Reference; do not transplant service |
| Scheduling/calendar | Existing schedule/rule primitives, no completed publishing calendar | Calendar grouping/timezone/view patterns | Medium | Upstream store/data assumptions | React calendar context, dates, upstream post model | AGPL review required | Reference UX only |
| Composer/platform preview | Source video editor exists, social composer absent | Platform-specific controls and media previews | Medium–high | Platform metadata rules change | React/editor libraries, provider components | AGPL review required | Reference only |
| Retry/error handling | Durable outbox, attempts/leases, mock reconciliation | Study provider error classification; preserve our orchestration | High | Two retry/workflow engines would conflict | Upstream Prisma/Temporal services | AGPL review required | Reject whole engine; reference classifications |
| Analytics | Own nullable/manual/mock/read adapters | Reference metrics endpoints/definitions where approved | Medium | Deprecations/scope changes | Provider SDKs + platform grants | AGPL review required | Reference definitions, verify docs before live |

## Postmill

Actual inspected source: frontend `components/composer/composer.tsx`, `content-qa/preflight.panel.tsx`, `launches/calendar/index.tsx`; backend `api/routes/media.controller.ts`, `media-studio.controller.ts`, `inngest/functions/{post-publish,media-render}.ts`; `libraries/nestjs-libraries/src/chat/tools/{comms-confirmation.gate,posts.approve.tool}.ts`. The confirmation gate parks non-read-only communication actions in Redis and consumes explicit confirmation before execution; this pattern is not blanket permission to publish.

| Candidate | Ours now | Upstream / potential use | Complexity | Maintenance risk | Dependencies | License | Decision |
|---|---|---|---|---|---|---|---|
| Workspace UX | Existing membership/session epochs and tenant keys | Reference channel/workspace context and worklist grouping | Low–medium | Replacing auth would break proven isolation | Next/React + upstream user/integration store | AGPL review required | Reference visual flow; retain own auth |
| Media library | Immutable MediaAsset + licensed images | Reference media browsing/picking and job feedback | Medium | Provider capability and storage semantics | Media services, provider registry, object storage | AGPL review required | Reference UX; own media records remain source of truth |
| Templates/media tools | Two owned Remotion templates | Reference template discovery and capability disclosure | Medium–high | Large provider/tool surface | Render/media services, third-party model APIs | AGPL review required | Reference; no broad tool import |
| Content composer | Fragmented Studio + Export | Reference progressive composer/preflight layout | Medium | Upstream state/store coupling | React editor/store and post schema | AGPL review required | Reference only; implement original UX |
| Approval experience | Existing rights/output review, QC inbox | Reference preflight and deliberate approve action | Medium | Approval semantics differ from content rights | QA service, PostsService, membership grants | AGPL review required | Reference; never substitute source rights approval |
| AI agent confirmation | No conversational agent executor | Reference scoped parked-action confirmation, expiry and execute-confirmed separation | Medium | Redis-only confirmation cannot replace our durable workflow | RedisService, tool registry, chat context | AGPL review required | Reference design; defer agent feature |

Do not adopt Postmill's Inngest jobs, database/auth or media-render worker alongside the existing BullMQ/outbox pipeline. That would create competing execution systems for the same content.

## Short Video Maker

Actual inspected source: `src/short-creator/ShortCreator.ts`, libraries `{Kokoro,Whisper,Pexels,Remotion,FFmpeg}.ts`, `src/server/routers/{rest,mcp}.ts`, `src/components/videos/{PortraitVideo,LandscapeVideo}.tsx`, `src/types/shorts.ts`, `src/config.ts` and `package.json`.

| Candidate | Ours now | Upstream / potential use | Complexity | Maintenance risk | Dependencies | License | Decision |
|---|---|---|---|---|---|---|---|
| Scene composition | Grounded segments + immutable render manifest | Adapt scene/portrait composition concepts as future template fixtures | Medium | Must preserve sourceRefs/attribution/durations | React, Remotion | MIT notices + Remotion terms | Adapt narrowly later; keep current renderer now |
| TTS | Mock/local eSpeak/optional provider | Kokoro wrapper is a possible alternate TtsProvider | Medium | Model/language/voice support and runtime cost | kokoro-js, ONNX/model downloads | MIT code; model terms separate | Defer; not a Vietnamese replacement as-is |
| Captions | Approximate timings, SRT/presets | Whisper-cpp word/caption pipeline can inform alignment adapter | Medium | Model memory/latency/accent quality | whisper-cpp, FFmpeg, native/model downloads | MIT code + dependency/model review | Highest-priority later adaptation candidate |
| Background media | Attested static images | Pexels selection and clip preparation | Medium | Asset licence, availability, attribution and remote fetch security | Pexels API, FFmpeg, provider key | MIT code, asset/API terms separate | Reference/adapt only with permitted licensed fixtures |
| Remotion render | Owned cancellable child/deadline/fencing | Reference scenes/transitions, not worker replacement | Medium | Must preserve cancellation and result validation | Remotion bundler/renderer | MIT code + Remotion terms | Reference scenes; retain our renderer adapter |
| REST/jobs | Authenticated tenant API + PostgreSQL/outbox | Simple API/status examples; ShortCreator queue is process memory, file-existence statuses | High to make equivalent | Restart/tenant/cancel/idempotency differences | Express, MCP, filesystem queue | MIT code | Reject queue/server replacement |

Vietnamese evidence: `config.ts` defaults Whisper to `medium.en`; `VoiceEnum` in `types/shorts.ts` enumerates English Kokoro voice identifiers. Therefore Vietnamese speech/alignment is **not verified or supported by the inspected defaults**. A multilingual Whisper model/config, Vietnamese voice provider, Unicode/font/punctuation handling and diacritic/timing regression corpus must replace/extend those defaults. Retain working eSpeak Vietnamese now. No model weights or external media were downloaded during this research.

## ShortGPT

Actual inspected source: `shortGPT/engine/{abstract_content_engine,content_short_engine,content_video_engine}.py`, `audio/{edge_voice_module,eleven_voice_module}.py`, `editing_utils/captions.py`, `config/languages.py`, `requirements.txt`. It uses Python content-engine steps/checkpoints and its own ContentDatabase/TinyDB rather than our tenant outbox.

| Candidate | Ours now | Upstream / potential use | Complexity | Maintenance risk | Dependencies | License | Decision |
|---|---|---|---|---|---|---|---|
| Script generation | Deterministic/optional provider, strict source grounding | Reference story/hook planning only | Medium | Upstream generation is not our exact-source comment contract | OpenAI client/prompts, Python runtime | MIT code, provider terms | Reference only; reject ungrounded prompt transplant |
| Production pipeline | Durable typed stages/leases/recovery | Reference editing step decomposition/checkpoints | High | Duplicate workflow/data systems | Python, ContentDatabase/TinyDB, MoviePy | MIT code + dependency review | Reject engine replacement |
| Media selection | Rights-attested background assets | Reference timing and selection concepts | Medium | Download/asset permission and deletion concerns | Search/download and MoviePy/FFmpeg tooling | MIT code, asset/API terms separate | Reference permitted fixtures only |
| TTS/captions | Working Vietnamese eSpeak; approximate timing | Reference multilingual voice catalog and caption timing | Medium–high | Network endpoint/provider support, old pinned dependencies | edge-tts, ElevenLabs, Whisper/Torch, MoviePy | MIT code; endpoint/model terms separate | Reference catalog/alignment, defer provider adoption |

Vietnamese is explicitly listed in `config/languages.py` and mapped to `vi-VN-NamMinhNeural` / `vi-VN-HoaiMyNeural`; the inspected ElevenLabs supported-language list does not establish Vietnamese coverage. A mapping is not a live functional, permission or quality test. Do not silently adopt unofficial service endpoints or source scrapers as an approved adapter.

## Recommendation

Milestone 1 uses original project code and existing dependencies only. Later: first evaluate a small MIT Whisper alignment/scene adapter against Vietnamese fixtures; then consider provider-specific publishing references after owner permissions and an explicit license-compliance review. Postiz/Postmill can inform UX and capability contracts now; their code is not approved for reuse. Full upstream applications, auth/DB schemas and competing job engines are rejected for this product.
