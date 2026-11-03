# Shorts Factory

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: the owner, a Vietnamese-speaking creator making short videos on a local PC. Confirmed on 03 November 2026. Workspace roles also support editors/reviewers/admins, but administration is secondary to the creator's daily workflow.

## Product Purpose

Turn a permitted Facebook/Threads post and selected comments into a narrated video using their original captured images, then let the user review and download an MP4. Success means a clear, easy local workflow from source to a downloadable video, with actionable feedback when a step is blocked.

## Operating Context

Confirmed priority: paste link → capture original post/comments → edit script, local voice, background/music → create MP4 → review/download. Chrome/Edge extension capture uses the user's browser only after an explicit capture action. An optional dedicated browser and manual text/file import exist. Local rendering, local/free TTS and custom voices are important existing requirements.

## Capabilities and Constraints

- Keep existing source images, provenance, author privacy controls, comment selection, scripts, presets, previews, media uploads and review/download flows.
- Workspace membership and permissions are checked server-side. Human content/rights review remains required; unknown rights cannot authorize publication.
- Keep durable job history, cancellation, timeouts and recovery. Progress and failures must describe actual server state.
- No stealth/cookie extraction, unattended social crawling, automatic social publishing or simulated third-party success. Production social integrations remain BLOCKED_EXTERNAL.
- Preserve Next.js/TypeScript and the existing adapters/API contracts. No new account, paid API or remote hosting is needed for the redesign.
- Main UI language is Vietnamese. Settings, automation, source administration and analytics are secondary to creating videos.

## Brand Commitments

Keep the Shorts Factory product name. The owner explicitly requested a full UI/UX redesign; the previous green palette and card layouts are implementation evidence rather than binding visual commitments.

## Evidence on Hand

The app has real local workflows, authenticated APIs, original-image rendering and screenshot fixtures. Repository reports in ../../docs/product/ and browser tests document implemented behavior and limitations. Tests use labeled synthetic data; no fabricated user rights, testimonials, usage numbers or publishing capabilities may be presented as facts.

## Product Principles

1. Put the creator's next useful action first.
2. Prefer a short, understandable task path over exposing every setting at once.
3. Make source review, editability, progress, errors and recovery explicit.
4. Preserve source integrity, rights gates and workspace isolation.
5. Keep setup and rendering usable on the owner's local PC.
