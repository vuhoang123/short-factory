# Paste this prompt into Codex

Implement **Shorts Factory** following the checked-in project spec. First read `AGENTS.md`, `README.md`, `docs/01-PRD.md` through `docs/08-DELIVERY-PLAN.md`, `prisma/schema.prisma`, `contracts/*`, and `examples/*`. Treat specifications as requirements, not as pre-existing working code.

**Begin with Phase 0 and Phase 1 only.** Bootstrap a pnpm + Turborepo monorepo with Next.js dashboard, NestJS API, packages/database/shared, Docker Compose for PostgreSQL and Redis, local object storage strategy, lint/typecheck/test, environment template. Implement auth/workspace isolation, content channels, manual post + comments import, content rights, and basic dashboard. Provide mocked integrations by default and no vendor credentials. Do not attempt unrestricted Facebook Groups scraping or automated TikTok Direct Post.

Prisma starter schema may require small consistency refinements: validate it, generate initial migrations, implement missing constraints and tenant checks. Keep all features behind documented permissions. The first deliverable must include documented local run commands and tests proving tenant isolation, import deduplication and rights gate. Work iteratively; summarize completed work, test output, blockers and the next phase. Do not claim a feature is complete until tests or working behavior demonstrate it.
