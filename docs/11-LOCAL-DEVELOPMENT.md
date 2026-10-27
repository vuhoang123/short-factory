# 11 — Local development

## Requirements and startup

Use Node.js 22.12 or later, pnpm 11.25.0 and a running Docker engine with Compose. Run commands from the repository root.

```sh
pnpm install
pnpm local:up
```

The startup script generates `.env` only when it does not already exist. Local PostgreSQL and Redis passwords are random and are not printed. `.env.example` is a reference containing placeholders, not runnable credentials. Existing environment settings are preserved.

Compose builds the NestJS API, Next.js dashboard, discovery worker, media worker and automation worker; starts PostgreSQL 17 and Redis 7; applies committed Prisma migrations; waits for health checks; then starts the applications. PostgreSQL, Redis and local objects use named Docker volumes. The discovery worker schedules synthetic demo sources and never scrapes or publishes. The media worker renders Remotion jobs outside the API process. The automation worker resumes rule runs and queues permitted analytics syncs from the PostgreSQL outbox.

| Service | Local address | Purpose |
|---|---|---|
| Dashboard | `http://localhost:3000` | Local sign-in and editorial workspace |
| Web health | `http://localhost:3000/health` | Web process health |
| API health | `http://localhost:3001/api/v1/health` | API and PostgreSQL connectivity |
| Discovery worker | No HTTP port | PostgreSQL outbox relay, BullMQ discovery jobs and demo-source scheduler |
| Media worker | No HTTP port | PostgreSQL outbox relay, BullMQ production jobs, local TTS, Remotion/FFmpeg rendering and media validation |
| Automation worker | No HTTP port | PostgreSQL outbox relay, rule scheduler, resumable Autopilot runs and analytics refresh polling |
| Development API docs | `http://localhost:3001/api/docs` | OpenAPI route documentation outside production |
| PostgreSQL | `localhost:5432` | Authoritative application state |
| Redis | `localhost:6379` | Infrastructure reserved for later queues/cache |

Compose host port bindings use `127.0.0.1`. Container service names such as `postgres`, `redis` and `api` are internal network addresses.

To stop the stack while keeping its data:

```sh
pnpm local:down
```

Do not remove named volumes unless you intend to erase their local data. If an existing PostgreSQL volume was initialized with a different password, keep its matching configuration or deliberately migrate/reset that development data; editing `.env` does not change an existing database password.

## Run applications on the host

This mode uses Docker for the databases and runs the web/API with watch mode:

```sh
node scripts/local-up.mjs --env-only
docker compose --env-file .env -f infrastructure/compose.yaml up -d --wait postgres redis
pnpm db:generate
pnpm db:deploy
pnpm dev
```

Stop an already running Compose web/API before using host development so ports 3000/3001 are available. `pnpm dev` loads the root `.env`. Prisma commands load it too, while explicit process environment variables take precedence for CI and test runs. Generate the Prisma client before development or checks on a clean checkout. Stop a host API process before regenerating after schema changes, especially on Windows where the active query-engine DLL can be locked.

Host local objects use `.data/objects`; Compose uses the `local-objects` volume mounted at `/app/.data/objects`. Objects are addressed by workspace UUID and SHA-256 checksum, written immutably and verified on reads. The storage helper is not an unauthenticated file-serving endpoint: API callers must pass workspace authorization and current rights/safety checks. This phase uses the local filesystem store; R2, signed remote URLs and production object access policies are not implemented.

## First editorial workflow

1. Open the dashboard and choose **Create account**. Use a private password of at least 12 characters. A new account has no workspace until you create one.
2. Create a workspace. Its creator receives `OWNER`; choose the active workspace using the workspace switcher.
3. Add a channel in `/channels` and set its minimum candidate score. In `/sources`, add a `MANUAL` source in **Synthetic demo discovery** mode to try pagination, comments, metrics, scoring and sync history. The fixtures are labeled synthetic and contain no real social posts. Other source types remain disabled and visibly `BLOCKED_EXTERNAL` until approved adapters exist.
4. Select **Sync now** or wait for the configured interval. Open `/library/posts` → **Scored candidates** to inspect platform/topic/score filters, source URLs, comments, metric snapshots and score factors. Repeated syncs count duplicates and preserve existing post and rights records.
5. Manual imports remain available from **All source posts** using the checked-in `examples/manual-import.json` fixture or the nested request shape in `07-API.md`. The example is synthetic material for local testing.
6. Open `/reviews`. Inspect the post, comments, evidence and intended use. A reviewer records a known rights basis, explicit territory, commercial permission, allowed destinations, attribution when needed and any expiry. Return to **Scored candidates** to approve or reject after rights and safety gates pass. Approval does not create a script or schedule publication.
7. Open `/studio`. Choose an approved candidate, source comments, channel, voice, template and subtitle style. Upload only a background image you own or have permission to use, and provide evidence for licensed or consented media. Queue production, edit grounded script segments into a new version, then render and review the MP4. Outputs remain pending review and are never published automatically. `TTS_PROVIDER=mock` emits a deterministic test tone, not speech. Use `TTS_PROVIDER=local` for Windows SAPI/Linux eSpeak NG speech, or configure the optional OpenAI adapter. The Compose media worker includes eSpeak NG; host voice availability depends on installed system voices.
8. Configure channel keywords, allow/deny terms and score thresholds under `/settings`. Review dashboard counts and audit history there as well. An administrator can record an author deletion/takedown from the post detail. This removes source text/comments, revokes rights and blocks downstream use. Remote removal remains `NEEDS_ACTION`; no provider removal API is integrated.

## Phase 5 Autopilot and analytics

1. Use an owned or otherwise documented source in `/library/posts`; approve its current rights for each intended destination and review the candidate. Synthetic discovery fixtures are suitable for local UI checks only.
2. Open `/autopilot`, choose a channel, voice, posting timezone/windows, language, permitted platform/accounts, limits and estimated cost. Start in **Semi-auto** or **Manual** mode. A rule edit creates a new version; each run keeps the version and control state it started with.
3. Use **Dry run** to inspect candidate ranking and blockers without reserving budget or starting media work. Use **Run once** for the reviewed channel workflow. The worker rechecks membership, candidate/rights state, pause/stop state and budget before expensive stages.
4. Inspect stage status and the QC report in the approval queue. An unmeasured or approximate quality check remains visible for review; mock TTS test tones do not satisfy automatic-publish quality. Approve the completed video explicitly to continue to the configured development mock publisher. Production publishing remains blocked in this checkout.
5. Open `/analytics` to inspect provider, scope, period, freshness and missing-metric information. Unknown values remain unavailable (`null`), not zero. In development the mock analytics adapter marks its snapshots synthetic. Recommendations show sample counts and evidence; experiments remain paused pending review and require separate eligible variants.
6. Pause/resume, disable, emergency stop, cancel or retry from `/autopilot`. Estimated USD limits are reservations and are not provider billing. Provider charges remain unavailable until a verified adapter reports them.

To run the end-to-end Autopilot smoke on a separate migrated database whose name ends in `_test`, set `TEST_DATABASE_URL` and use a local speech voice plus Chrome/Edge/Chromium:

```sh
pnpm smoke:autopilot
```

The script creates synthetic fixture records, renders an MP4, exercises two development mock destinations and records synthetic metric snapshots. It keeps those rows in the dedicated test database for inspection; never point it at a development or production database.

The standalone rendering smoke test exercises a deterministic source, test-tone TTS, subtitles, manifest, real Remotion/FFmpeg render and private storage:

```sh
pnpm smoke:media
```

It writes `.data/smoke-media/` objects and a playable `test-results/phase3-smoke.mp4`. Remotion uses its managed FFmpeg renderer and a Chrome/Chromium browser. Windows Chrome or Edge is auto-detected; on Linux set `REMOTION_BROWSER_EXECUTABLE` to the installed Chromium path if needed. Smoke output does not require PostgreSQL, Redis or provider credentials.

External source adapters, account OAuth, production publishing and live analytics are not enabled. The local mock publisher and mock analytics adapter are explicit development/test fixtures; a rights decision alone is not account authorization or approval to publish.

## Roles and request boundaries

| Action | Authorized roles |
|---|---|
| Read workspace content, channels and source status | `OWNER`, `ADMIN`, `EDITOR`, `REVIEWER`, `VIEWER` |
| Create channels, source configurations and topic rules | `OWNER`, `ADMIN` |
| Edit/delete sources and trigger source access checks | `OWNER`, `ADMIN` |
| Trigger a source sync | `OWNER`, `ADMIN`, `EDITOR` |
| Import authorized posts and comments | `OWNER`, `ADMIN`, `EDITOR` |
| Review content rights | `OWNER`, `ADMIN`, `REVIEWER` |
| Manage registered members, read audits, record takedowns | `OWNER`, `ADMIN` |

Users must register before an administrator grants workspace membership. This phase has no email invitation delivery. Existing owner membership cannot be downgraded by the member endpoint.

The API prefix is `/api/v1`. Workspace context comes from the server session and a current membership lookup; a request's `workspaceId` cannot grant access. Tenant-owned queries include the workspace predicate, and composite PostgreSQL foreign keys reject cross-workspace relations. Role checks run on the server even when a UI control is hidden.

Passwords use scrypt with random salts. Session cookies are HttpOnly and SameSite=Lax; only hashes of opaque session tokens are persisted. Cookie-authenticated mutations must carry the configured `APP_URL` origin. Production cookies are secure, and production registration defaults to disabled unless `ALLOW_REGISTRATION=true` is explicitly configured. The local development environment enables registration so the UI can bootstrap its own account.

Protected content/workspace mutations accept `Idempotency-Key`. Replaying the same key and request returns the saved result; reusing it for different input is rejected. Imported external IDs and normalized content hashes deduplicate within a workspace and source platform. Discovery retries are idempotent; duplicates are counted on sync runs, and existing content and rights, including takedown tombstones, are preserved. Source sync requests store the run and outbox event in one PostgreSQL transaction. The relay enqueues BullMQ jobs with the stable outbox event ID before marking the event delivered.

## Commands and validation

| Command | Purpose |
|---|---|
| `pnpm db:validate` | Validate the canonical Prisma schema |
| `pnpm db:generate` | Generate the client into `packages/database/generated/client` |
| `pnpm db:deploy` | Apply committed migrations to the configured database |
| `pnpm db:migrate --name change_name` | Create a development migration after an intentional schema change |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Check strict root/application/package TypeScript using the generated client |
| `pnpm test` | Run unit, adapter contract and workflow helper tests |
| `pnpm check` | Run schema validation, lint, typecheck and the unit suite |
| `pnpm test:integration` | Migrate a separate PostgreSQL test database and run SQL/API tests |
| `pnpm build` | Check application/package builds and build the Next.js dashboard |
| `pnpm test:browser` | Run the Playwright browser suite |
| `pnpm smoke:autopilot` | Run the database-backed synthetic Autopilot slice and render a sample video |

The committed baseline is `prisma/migrations/20261026000000_initial/migration.sql`. Phase 3 schema changes are additive in `prisma/migrations/20261027000000_phase3_media/migration.sql`; Phase 5 adds automation/analytics tables and indexes in `prisma/migrations/20261028000000_phase5_autopilot/migration.sql`. Deploy with `pnpm db:deploy` before starting the updated API or workers.

Run `pnpm db:generate` once before the check/build/test commands on a clean checkout. These commands reuse that client so parallel validation processes do not compete to replace the query-engine binary. CI performs explicit generation before its checks.

The integration runner uses `TEST_DATABASE_URL` when set; otherwise it derives `shorts_factory_test` from the local connection. It requires a database name ending in `_test`, creates the database if necessary, deploys migrations and runs the suite. Fixtures are isolated and cleaned by their tests; the runner does not truncate the development database. Its local database user needs permission to create the dedicated test database if it does not exist yet.

Install a browser once before browser checks when it is not already available:

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

Browser checks start separate local API/web processes on ports 3003/3002. They require PostgreSQL and the configured schema to be available. CI generates the client, runs schema/lint/type/unit checks, PostgreSQL integration tests and application builds, deploys the development test schema, installs Chromium and runs browser checks. It uploads the browser report and screenshots. Adding a workflow file does not itself constitute a completed remote CI run.

## Optional demo seed

The normal startup flow uses UI registration and does not run seed. For an optional local demo owner, privately set `SEED_DEMO_PASSWORD` in the process environment, then run:

```sh
pnpm db:seed
```

Use at least 12 characters and at most 128 UTF-8 bytes. Do not paste real passwords into committed files or shared command logs. Seed creates `owner@shorts.local`, one workspace, a channel and a manual source. It refuses production/nonlocal databases, preserves existing accounts on rerun and prints no password. It creates no posts, rights approvals, provider credentials or publications.

## Data and integration limits

OAuth tokens and cookies are never stored in application rows. Manual and discovered text is normalized; email, common phone patterns and possible street addresses are redacted before persistence and flagged for safety review. Raw payload retention is off by default and limited to synthetic fixtures in this implementation. Names and identifying context still require human review. Arbitrary source text is excluded from audit/outbox payloads and logs.

Canonical URLs are provenance references only. They are validated and query/fragment data is removed before persistence; this phase never fetches them. Future fetching adapters must add DNS/IP validation, redirect checks, timeouts and source-specific permission rules before making network requests.

Content-rights decisions remain authoritative on the server: unknown, unreviewed, expired, revoked, missing commercial/platform scope, missing attribution or insufficient evidence block eligibility. Exception-based reuse requires informed human review. Automated retention schedules and full remote takedown reconciliation remain future operations work.

Outbox records contain IDs and are committed in the same PostgreSQL transaction as their state changes. Workers enqueue by durable event ID before marking outbox events delivered; Redis is only the delivery mechanism. The media and automation workers use expiring, attempt-fenced database leases so a second worker cannot write outputs for a live attempt and a crashed run can resume when its lease expires. Local mock discovery is restricted to development and contains synthetic data. Official discovery, production posting, TikTok export/manual handoff and live analytics require verified permissions/adapters and remain `BLOCKED_EXTERNAL` in this checkout.

This is a local development scaffold. A production deployment still needs HTTPS, operational secrets management, an identity/registration policy, rate limiting appropriate to multiple processes, private object storage, backups, monitoring and the later-phase provider approvals. The current in-process sign-in rate limit is a local safeguard, not a distributed rate-limiting service.
