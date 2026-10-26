# 05 — Source Connectors, Provenance and Rights

## Data collection policy
Use official, approved APIs or permissioned content feeds. Manual import accepts user-owned/licensed material. Public visibility alone does not establish commercial reuse rights. Do not implement automated session-cookie extraction, rotating accounts, CAPTCHA bypass, stealth scraping or unrestricted Facebook Group crawling.

## Source priorities
1. `manual` paste/JSON/CSV: supported fully in MVP; provenance/rights attestation required.
2. `threads`: scoped approved Meta keyword search where app permission and API capability exist. Do not promise full historical/search/comment coverage; gate by capability.
3. `reddit`: access only after API/data-use authorization appropriate to commercial use; obey current data retention/deletion terms.
4. `facebook`: Groups API is not a general discovery path; use approved licensed feeds/admin exports/user-provided material instead.

## Interface
See `contracts/source-adapter.ts`. Adapters expose `capabilities()` and `validateAccess()`; disabled if permission missing. Normalize external fields, maintain cursor with sync run, metrics snapshot, source URL and `fetchedAt`. Persist raw payload only if terms allow and redact unneeded fields.

## Scoring proposal
0–100 composite: engagement velocity 20%, hook/curiosity 25%, comment quality 25%, topic relevance 15%, and short-video suitability 15%. Missing platform metrics are excluded and remaining weights are normalized; unavailable metrics are never treated as zero. The current deterministic `heuristic-v1` fallback is explainable and configurable by channel. It is not a guaranteed algorithm of any platform, and no AI scoring provider exists yet. Negative filters include sensitive personal data, denied topics, missing rights and duplicates.

## Rights gate
`OWNED | LICENSED | CONSENTED | EXCEPTION_REVIEWED | UNKNOWN`; unknown defaults blocked. Record supporting evidence, reviewer, territory/platform/commercial scope, attribution and expiry. Exception-based reuse requires informed human review and is jurisdiction-specific.

## Data minimization
Avoid storing unnecessary author personal info, no raw cookies, support original source deletion, author objection and audit of content reused, trace story segments to source post/comment IDs. Do not invent comments as authentic quotes.
