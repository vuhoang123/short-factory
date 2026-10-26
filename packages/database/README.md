# Database package

The canonical Prisma schema and migration history remain in the repository's `prisma/` directory so the supplied architecture and starter contract have one source of truth. This package exports the generated Prisma client and owns local seed and PostgreSQL constraint tests.

From the repository root:

```sh
pnpm db:validate
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm test:integration
```

`db:seed` reads the root `.env`, refuses production or nonlocal database hosts, and creates one local owner, workspace, channel, and manual source. Supply a private `SEED_DEMO_PASSWORD` with at least 12 characters and at most 128 UTF-8 bytes; the CLI never prints passwords. Reruns preserve the existing account and password. Seed creates no posts, approved rights, social credentials, or publications. The dashboard sign-up flow can bootstrap an account without running seed.

All tenant-owned tables include `workspaceId`. Relations between tenant rows use composite foreign keys that include it. Identity users and sessions are global; a session's active workspace must match an existing `(workspaceId, userId)` membership. The API still authorizes every read and write; foreign keys do not replace query scoping or role checks.

Import identity and normalized content hash uniqueness are scoped to workspace and source platform. Rights start as `UNKNOWN`, `PENDING`, unattested, noncommercial, and with unspecified territory. Server-side rights evaluation and explicit human review are required; schema existence does not approve reuse or enable external integrations.

Integration tests require a separate `TEST_DATABASE_URL` and committed migrations applied by the root test runner. Tests prove cross-workspace relation rejection in PostgreSQL, tenant-scoped duplicate constraints, fail-closed rights defaults, and atomic state/outbox commit and rollback. They create and delete only their own fixtures.
