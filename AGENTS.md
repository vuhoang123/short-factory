# Instructions to Codex

You are implementing Shorts Factory, a production-minded hybrid MVP. Read all files in `docs/`, `prisma/schema.prisma`, `contracts/`, and `examples/` before building affected modules. Follow `docs/08-DELIVERY-PLAN.md` sequentially. Do not start by writing a scraper.

## Mandatory standards
- Use TypeScript strict mode; no `any` in public contracts; Zod validation at boundaries.
- Tenant isolation: workspaceId on tenant-owned rows and server-side authorization for every read/write; test cross-workspace leakage. Never trust workspace IDs provided by client alone.
- Use PostgreSQL transactions and durable outbox for state change + queue enqueue; Redis/BullMQ is not the source of truth.
- Jobs are resumable and idempotent. Remote uploads are reconciled after ambiguous timeouts; do not blindly retry a publish.
- Store no plaintext OAuth secrets in application DB; use encrypted secret references/KMS envelope encryption. Never log secrets or post raw private data.
- External APIs are accessed only via adapters; include mocked adapters for local development.
- DO NOT bypass platform limits or use stealth browser/cookie scraping to access Facebook Groups, Threads or Reddit. Use only approved APIs or licensed/user-supplied data.
- Rights unknown = do not automatically publish. Ensure explicit user review or verified allowed usage before scheduling. Handle personal data minimization, author deletion/takedown and attribution rules.
- TikTok is export/manual-handoff by default; enable API direct post only after confirmed product eligibility, permissions, creator consent and approval.
- Mark features requiring approvals as `BLOCKED_EXTERNAL`, not as shipped. Do not simulate successful third-party publishing in production.
- Provide `.env.example` with placeholders only. Avoid hardcoding provider quota limits; make configurable and verify current docs.
- Tests: unit, contract, workflow transition, idempotency, tenant isolation, and at least one mocked end-to-end vertical slice.
- At each phase, output changed files, commands to run, tests passed/failed and known blockers.

## Coding skills
- Use the installed `ponytail` skill in `full` mode by default for coding tasks in this repository; read `C:/Users/ACER/.codex/skills/ponytail/SKILL.md` before applying it. Follow any explicit user request to change the mode or stop using the skill.
- Apply Ponytail within the current delivery phase and keep the mandatory standards and checked-in specifications authoritative. Prefer the smallest complete change while preserving required validation, tenant isolation, transactions/outbox, idempotency, adapters, rights checks and tests.
