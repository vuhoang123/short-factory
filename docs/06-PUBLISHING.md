# 06 — Publication Integrations

## Shared model
A `Video` maps to separate `Publication` rows per social account. Each attempt is stored with stage, provider operation ID, session identifiers if permitted, request checksum, response status and error code. No direct service-specific fields in generic domain logic. See `contracts/publisher-adapter.ts`.

## YouTube
Use official Google OAuth authorization, least permissions, `videos.insert` resumable upload, capture remote video ID, poll processing as appropriate. A vertical video is not uploaded through a separate Shorts-specific API. Validate current channel eligibility, video size, privacy, quotas, verification/audit restrictions against current provider docs at implementation. API quota and public/private defaults can change.

## Facebook
Official Facebook Page Reels flow with eligible Page admin authorization/token and required permissions. Create session, upload, finalize/publish and verify remote state. Do not assume personal profiles or groups support equivalent API posting.

## TikTok
Manual/export handoff as MVP baseline. TikTok Content Posting API direct publication is only enabled after verifying app product eligibility, approved scope/audit, genuine creator integration, user-controlled privacy/consent and content policy requirements. A private utility reposting stories to internal accounts must not assume approval. Store as `NEEDS_ACTION` when blocked.

## Publishing rules
- `approved` and rights permitted for target before enqueue and before upload.
- Platform-specific title/caption/privacy/AI labeling/media validation.
- Scheduled at workspace TZ with UTC persisted; all actual timestamps UTC.
- On 429 follow provider reset; on 5xx backoff; on 401 refresh once; missing permissions action required; media rejected permanent until edits.
- Timeout after remote create: query/check session ID before retry. Never submit twice blindly.
- No fabricated remote links/status in production; mock environments clearly labeled.
- Analytics separate adapter/permission gate and metric provenance.

## Verification checklist
Before shipping: review latest API endpoints/scopes, platform app review, consent, rate limits, test accounts, webhooks, restrictions on commercial automated content and platform content originality policies. Official docs: `developers.google.com/youtube/v3`, `developers.facebook.com`, `developers.tiktok.com`.
