# IRAJ Task Manager — Codebase Problem Map

Audit date: 2026-09-01  
Scope: `Anahai-dev/IRAJ-Task-Manager` at `main` (`cd2d50c`). This document is evidence-only. Items that were hunches but not confirmed are marked **discarded** in the inventory.

This map is the input for a later “bulletproof” cleanup. It does not prescribe patches.

---

## Executive summary

This is a working Jira-like SPA with real auth, RBAC, GitHub/GitLab, wiki, and dual-engine persistence. It is **not** production-bulletproof. The dominant risk is architectural: almost all backend behavior lives in a single ~4.7k-line Express file, so authz, Git PAT use, backups, and schema evolution cannot be reviewed or tested in isolation.

**How bad:** High for a private team tool that will hold Git PATs, user password hashes, and the full work graph. Many security primitives exist (httpOnly cookies, AES-256-GCM PAT encryption, OAuth state HMAC, parameterized SQL, helmet, rate limits). They sit next to several **data-loss and tenancy holes** that can wipe credentials, silently write to the wrong database, or auto-admit any OAuth user.

**Biggest risks (in order):**

1. **Silent PostgreSQL → SQLite fallback** and **/tmp SQLite fallback** — production can keep running against the wrong, ephemeral store.
2. **In-app JSON backup round-trip destroys secrets** — export redacts password hashes and PATs; restore writes unusable hashes and nulls tokens, locking out the org.
3. **OAuth auto-provisions verified developer accounts** with no invite list, domain allowlist, or admin approval.
4. **`checkProjectAccess` is over-broad** — being assignee/creator of *one* task grants project-wide wiki/member/git-read access.
5. **No automated tests** despite Playwright in `devDependencies`; Docker Compose cannot boot production as written (`SECRET_KEY` missing).
6. **Monolith `server.ts`** makes every later cleanup (MCP connector included) high-risk until the map’s Phase 0–2 land.

Hunches verified: `server.ts` is a 190,588-byte monolith; `package.json` is still named `react-example`; auth/OAuth/PAT/RBAC are the highest-risk cluster; tests are effectively absent; Docker/env hardening is incomplete.

---

## Inventory

### Stack (as implemented, not as docs claim)

| Layer | Actual |
| :--- | :--- |
| Frontend | React **19** + Vite 6 + React Router 7 + Tailwind 4 + TypeScript (non-strict) |
| Backend | Node Express 4 in `server.ts`, started via `tsx` (dev) or `esbuild` bundle `dist/server.cjs` (prod) |
| Auth | Local bcrypt + JWT in httpOnly cookie `auth_token`; OAuth Google/GitHub/GitLab |
| DB | SQLite (`sqlite3`) default; PostgreSQL (`pg`) if `DATABASE_URL` is set **and** the connection test succeeds |
| Git | Server-side PAT stored on `projects.repoToken`, AES-256-GCM; GitHub REST + GitLab REST |
| AI | `@google/genai` is a runtime dependency but **has zero imports** in `src/` or `server.ts` |
| Tests | **None.** No `test/` / `e2e/` / `*.spec.*`. `package.json` has no `test` script. Playwright is unused. |
| CI | **None.** No `.github/` workflows. |

Docs/README still say “React 18”, “Framer Motion”, “first user is Admin”, “Member” role, `/git-repository`, binary SQLite download, and team email-domain restrictions. Several of those features do not exist in code.

### Entrypoints

| Path | Role |
| :--- | :--- |
| `server.ts` | Entire HTTP API, auth, DB wrappers, migrations, Git, backups, Vite middleware, background PR sync |
| `src/main.tsx` | React mount + `ErrorBoundary` |
| `src/App.tsx` | Routes; cookie-session gate |
| `scripts/db-cli.ts` | SQLite-only backup/restore/JSON import (not used by Docker image; `.dockerignore` excludes `scripts/`) |
| `Dockerfile` / `docker-compose.yaml` | Multi-stage Node 20 alpine + Postgres 18 |

### Major frontend modules (line counts)

| Path | Lines | Notes |
| :--- | ---: | :--- |
| `src/pages/Board.tsx` | 1291 | Kanban + column editor + native HTML5 drag (not `@dnd-kit`) |
| `src/pages/Profile.tsx` | 1284 | Settings carousel + backup UI |
| `src/pages/GitRepositoryPage.tsx` | 1066 | Repo link + branches + PR |
| `src/components/TaskModal.tsx` | 1002 | Task CRUD + git actions + comments |
| `src/pages/Dashboard.tsx` | 943 | Only consumer of `@dnd-kit` (widget layout) |
| `src/pages/UsersAdmin.tsx` | 691 | Users + custom roles |
| `src/components/ProjectGitModal.tsx` | 681 | Duplicate of git page flows |
| `src/components/Layout.tsx` | 594 | Nav, git feature toggle, integrations poll |

There is **no** shared data layer (no React Query / SWR). Almost every page independently `fetch`es `/api/tasks`, `/api/users`, `/api/projects`.

### Size hotspots

| Path | Size |
| :--- | :--- |
| `server.ts` | **190,588 bytes / 4,716 lines** — confirmed monolith |
| `package-lock.json` | 368,774 bytes |
| `bun.lock` | 182,336 bytes (second lockfile, unused by npm scripts) |
| `src/` TS/TSX | ~16.6k lines total |

### `server.ts` responsibility mix (confirmed)

Single file contains: dotenv/helmet/compression/rate-limit/morgan/cookies; AES helpers; `PgWrapper` + `SqliteWrapper`; `CREATE TABLE` + ad-hoc `ALTER TABLE` “migrations”; JWT middleware; register/login/logout/forgot/reset; three OAuth providers; users/roles/settings; tasks/comments; projects/members/columns; Git branches/PRs/sync; teams; documents; milestones; backup export/restore; Vite or `express.static`; `setInterval` PR sync and nonce purge.

~90 `app.get/post/put/delete` routes, all in one module.

### Hunches: confirm / discard

| Hunch | Verdict |
| :--- | :--- |
| `server.ts` ~190k monolith mixing HTTP/auth/DB/Git | **Confirmed** |
| `package.json` named `react-example` | **Confirmed** (`name: "react-example"`, `version: "0.0.0"`) |
| Auth/OAuth/JWT/PAT/RBAC high-risk | **Confirmed** (see P0/P1) |
| Tests thin despite Playwright | **Confirmed — tests are missing, not thin** |
| Docker/env/prod hardening incomplete | **Confirmed** |

---

## P0 — exploit / data-loss / auth-break

### P0-01 — Silent PostgreSQL fallback to SQLite

- **Where:** `server.ts` `initDb()` (~374–391, 793–795)
- **Evidence:** If `DATABASE_URL` is set but `pgTest.testConnection()` throws, the server logs `PostgreSQL connection failed, falling back to SQLite` and continues. The outer `catch` at ~793 also swallows init errors: *“The app will run, but DB features will fail…”* and still `return db`.
- **Impact:** Docker Compose always sets `DATABASE_URL`. A brief Postgres blip, wrong password, or DNS failure makes the app serve an **empty local SQLite file** while Compose’s Postgres still holds the real data (or vice versa after recovery). Writes diverge; operators think they are on Postgres.
- **Direction:** Fail fast in production if `DATABASE_URL` is set and Postgres is unreachable. Never implicit-fallback. Health check should fail the container.

### P0-02 — SQLite read-only fallback to `/tmp/database.sqlite`

- **Where:** `server.ts` ~407–420
- **Evidence:** On `READONLY`, the server copies (best-effort) to `/tmp/database.sqlite` and keeps running.
- **Impact:** Container/VPS restart loses the live database. `/tmp` is world-typical ephemeral storage. Combined with P0-01, production can “work” while storing nothing durable.
- **Direction:** Exit on unwritable DB path in production. Require an explicit data volume.

### P0-03 — In-app JSON backup round-trip destroys passwords and Git PATs

- **Where:** `server.ts` `GET /api/backup/export-json` (~4410–4420); `POST /api/backup/restore-json` (~4512–4520); UI `src/pages/Profile.tsx` `handleJsonDownload` / `handleJsonRestore`
- **Evidence:** Export maps `projects.repoToken` and `users.passwordHash` to `'••••••••'`. Restore treats those sentinels as: PAT → `null`; passwordHash → placeholder `$2b$10$UnusablePlaceholderPasswordHash…` except for the *currently logged-in* super_admin matching id/email.
- **Impact:** The documented happy path (Profile → Download JSON → Restore JSON) **locks out every other user** and **strips every repo PAT**. Super_admin may still log in; the rest cannot. Git integration dies. This is both data-loss and auth-break.
- **Direction:** Never export a restore-incompatible file from the same UI. Either export real secrets only to an encrypted archive with a separate confirmation, or export a “metadata-only” dump that restore refuses. Restore must reject redacted hashes instead of writing placeholders.

### P0-04 — Restore is an irreversible full wipe (docs claim a rollback)

- **Where:** `server.ts` ~4443–4532; `docs/08-database-and-backups.md` §2
- **Evidence:** Restore `DELETE`s every allowlisted table inside a transaction, then inserts. There is **no** `.rollback` file, schema validator, or dry-run. Docs say: *“automatically creates a `.rollback` backup before completing”* and mention `.sqlite` restore. Neither exists on the HTTP API (only JSON; CLI has rollback *files* for SQLite copy).
- **Impact:** A malformed or partial JSON (or the redacted export from P0-03) wipes the workspace. Transaction abort helps only if insert throws; successful insert of bad data commits.
- **Direction:** Write a pre-restore snapshot; require `confirmToken`; refuse redacted/sentinel values; add schema version.

### P0-05 — OAuth auto-joins verified users with no allowlist

- **Where:** `server.ts` GitLab ~1341–1351, Google ~1453–1463, GitHub ~1587–1597
- **Evidence:** If no user exists for the OAuth email, the handler `INSERT`s a `developer` with `emailVerified = 1` and sets the auth cookie. There is no domain allowlist, invite table, or “registration disabled” flag. `/api/auth/*/url` is unauthenticated.
- **Impact:** Any Google/GitHub/GitLab user who can complete OAuth becomes a verified member of a private task manager (sees whatever `checkProjectAccess` later grants; can be added to projects; occupies the user directory). First-user bootstrap is local-register-only (`super_admin`); OAuth never becomes first user, but it **does** join an already-bootstrapped instance.
- **Direction:** Disable OAuth account creation by default. Require invite token, email domain, or admin provisioning. Separate “login existing” from “create”.

### P0-06 — Docker production cannot set `SECRET_KEY` (and would not encrypt PATs separately)

- **Where:** `docker-compose.yaml` `app.environment`; `server.ts` ~60–64; `.env.example`
- **Evidence:** Compose passes `DATABASE_URL`, OAuth, SMTP, `APP_URL`, Gemini — **not** `SECRET_KEY` or `TOKEN_ENCRYPTION_KEY`. `NODE_ENV=production` plus missing `SECRET_KEY` → `process.exit(1)`.
- **Impact:** Documented `docker compose up` is dead on arrival. Operators who “fix” this by commenting out the check (or running without `NODE_ENV=production`) get a boot-time random JWT secret (`FALLBACK_SECRET`) that **invalidates all sessions on restart** and keys PAT encryption off that same secret (`TOKEN_ENCRYPTION_KEY || SECRET_KEY`).
- **Direction:** Require both secrets in Compose (no defaults). Fail image start via env_file. Do not reuse JWT secret for PAT encryption.

---

## P1 — real bugs / reliability / authorization holes

### P1-01 — `checkProjectAccess` treats any task assignee/creator as a full project member

- **Where:** `server.ts` `checkProjectAccess` ~885–901; used by documents, milestones mutate, git branch **read**, columns GET, members GET, activity, workload, etc.
- **Evidence:** After owner / `project_members` / `team_projects`, access is granted if `SELECT 1 FROM tasks WHERE projectId = ? AND (assigneeId = ? OR creatorId = ?)`.
- **Impact:** A user assigned **one** task can: list/edit/delete wiki docs (`/api/documents/:id` only checks `checkProjectAccess`); create milestones; read member emails; read git branch lists (PAT still gated on admin for remote calls). This is IDOR-class over-authorization, not UUID guessing.
- **Direction:** Split `project.view` vs `project.manage` vs `task.view`. Task assignment must not imply wiki/admin.

### P1-02 — Documents / milestones mutate with membership-only checks

- **Where:** `server.ts` ~4185–4326
- **Evidence:** POST/PUT/DELETE documents and milestones call `checkProjectAccess` only. No `hasPermission`, no project-role (`viewer` vs `admin`), no author check on delete.
- **Impact:** A `viewer` project member or a mere task assignee can delete another author’s PRD. Combined with P1-01 this is trivial.
- **Direction:** Require project role ≥ member (or explicit `edit_docs` permission). Author-or-admin for delete.

### P1-03 — Custom RBAC permissions never reach the client; UI and API disagree

- **Where:** `GET /api/auth/me` (~1648–1652) returns `{ id, name, email, role, skills, rolePrefix, status }` — **no `permissions`**. `src/App.tsx` `AdminRoute` and `src/components/Layout.tsx` check `user?.permissions?.manage_users`. `src/pages/UsersAdmin.tsx` ~247 then **rejects** anyone who is not `admin`/`super_admin`.
- **Evidence:** `hasPermission()` on the server reads `roles.permissions` JSON and is used for create-task / create-project / manage-users. Frontend gates on hardcoded role strings (`developer` cannot see New Task on Board ~750).
- **Impact:** A custom role with `manage_users` can call `/api/users` but cannot open `/admin/users`. A `qa` user with `create_tasks: true` may see UI the `viewer` also sees (`role !== 'developer'`). `product_owner` can `manage_projects` via API but is not `isAdminOrSuperAdmin`, so cannot list all projects.
- **Direction:** Single permission module shared conceptually: `/api/auth/me` must return resolved permissions; UI must use those flags; stop hardcoding role names in pages.

### P1-04 — `isAdminOrSuperAdmin` bypasses the permission table

- **Where:** `server.ts` `isAdminOrSuperAdmin` ~873; project listing, search, tasks listing, integrations, teams, milestones GET
- **Evidence:** Role id `admin` is treated as global omniscience even if `roles.permissions` were later narrowed. `manage_users` holders can assign role `admin` (`PUT /api/users/:id` only special-cases `super_admin`).
- **Impact:** Privilege ladder: grant `manage_users` → create/promote `admin` → full data access. Seeded `admin` permissions include `manage_users: true` already.
- **Direction:** Make `admin` a permission set, not a hardcoded bypass. Protect promotion to `admin` the same way as `super_admin`.

### P1-05 — Open local registration + forgot-password **is** email verification

- **Where:** `POST /api/auth/register` (~987–1008); `POST /api/auth/reset-password` (~1169) sets `emailVerified = 1`; register message tells users to use Forgot Password
- **Evidence:** There is no admin “verify user” action. `PUT /api/users/:id` does not set `emailVerified`. If SMTP env vars are missing, the reset link is only `console.log`’d (`[DEV MODE]`, ~1138) even when `NODE_ENV=production`.
- **Impact:** (a) Private instances cannot disable signup. (b) Without SMTP, non-first users are stuck unverified unless they can read server logs. (c) With SMTP, anyone with an inbox can join (weaker than P0-05 but still open tenancy).
- **Direction:** Invite-only flag; admin verify; never log reset URLs in production; do not treat password reset as the only verification channel.

### P1-06 — Express 4 async route errors are not caught

- **Where:** Majority of `app.get/put/post/delete` handlers in `server.ts` (e.g. `/api/auth/me`, `/api/tasks`, `/api/projects`, documents). Global handler ~4665 only sees `next(err)`.
- **Evidence:** Express 4 does not catch rejected promises. `JSON.parse(user.skills)` on `/api/auth/me` (~1652) can throw. Node 15+ may crash the process on unhandled rejection.
- **Impact:** One corrupt `skills` row or DB blip can take down the whole server (all API + SPA).
- **Direction:** Wrap handlers (`express-async-errors` or a small `asyncHandler`). Never `JSON.parse` untrusted DB text without try/catch.

### P1-07 — GET `/api/backup/export-json` is CSRF-able as a top-level navigation

- **Where:** `server.ts` ~4396; cookie `sameSite: "lax"` ~182
- **Evidence:** SameSite=Lax **does** send cookies on cross-site **GET** navigations. Export is GET + cookie auth. A super_admin clicking an attacker link downloads the workspace JSON (hashes/PATs redacted, but tasks/docs/emails/comments are not).
- **Impact:** Confidential data exfil via CSRF. POST restore is largely mitigated by Lax (cross-site POST omits cookie).
- **Direction:** Move export to POST; add CSRF token or `SameSite=Strict` + custom header check (`Origin`/`Sec-Fetch-Site`).

### P1-08 — GitHub/GitLab branch list is unpaginated (default 30)

- **Where:** `server.ts` `GET /api/projects/:id/git/branches` ~3175, ~3204. No `per_page` / `page` / Link-header loop.
- **Evidence:** GitHub REST default is 30 items. GitLab default 20.
- **Impact:** Repo page and TaskModal “existing branches” are silently incomplete. Duplicate branch create; wrong “linked task” map; docs claim “overview of all active remote branches”.
- **Direction:** Paginate until empty or cap with an explicit warning.

### P1-09 — Background / manual PR sync writes hardcoded column ids `done` / `review`

- **Where:** `server.ts` ~3707–3720 and `runBackgroundPrSync` ~4617–4627
- **Evidence:** On merge, `nextTaskStatus = 'done'`; on open PR from `todo`/`backlog`, `'review'`. Custom `project_columns` may not include those ids (Board allows arbitrary `col_${Date.now()}` ids). Task PUT otherwise **rejects** unknown column ids (~2646–2648).
- **Impact:** Tasks vanish from the Kanban (status not in any column). Sync runs every 5 minutes for every configured project using the shared PAT (confused-deputy at system level — by design, but unstoppable).
- **Direction:** Map merge → project’s last column; open PR → a configured “review” column; skip if unmapped. Make background sync opt-in.

### P1-10 — `taskCounter` increment is racy and SQLite-`RETURNING`-dependent

- **Where:** `POST /api/tasks` ~2461–2463: `UPDATE projects SET taskCounter = COALESCE(taskCounter, 0) + 1 WHERE id = ? RETURNING taskCounter`
- **Evidence:** Not in `db.transaction`. Two concurrent creates can mint the same `PROJ-N` or skip. `SqliteWrapper.get` on `UPDATE … RETURNING` depends on SQLite version; if `get` returns undefined, code uses `nextCount = 1`.
- **Impact:** Duplicate branch/task keys; broken Git branch naming.
- **Direction:** Increment inside a transaction (SQLite immediate / PG row lock). Don’t rely on RETURNING without a fallback `SELECT`.

### P1-11 — CLI JSON import interpolates table/column names; CLI export dumps live secrets

- **Where:** `scripts/db-cli.ts` `export-json` ~232 (raw `SELECT *`); `import-json` ~285–311 (`DELETE FROM ${table}`, `INSERT INTO ${table} (${columns.join(", ")})`)
- **Evidence:** Table names come from JSON keys (existence-checked against `sqlite_master`). Column names come from `Object.keys(firstRow)` with no allowlist. Export does **not** redact `passwordHash` or `repoToken`. CLI is SQLite-only (`database.sqlite`), so Docker/Postgres deploys cannot use the documented commands.
- **Impact:** Operator foot-gun: JSON with hostile keys; secret-filled backup files; docs tell Docker users to run a tool that is not in the image (`.dockerignore` excludes `scripts/`).
- **Direction:** Reuse the server allowlist; redact or encrypt; add Postgres mode; copy WAL-safe backup (`VACUUM INTO` / `.backup`).

### P1-12 — SQLite file copy backup is WAL-unsafe

- **Where:** `scripts/db-cli.ts` `backup` ~179 `fs.copyFileSync`; no `PRAGMA busy_timeout`
- **Evidence:** Journal is WAL (`PRAGMA journal_mode = WAL`). Copying `database.sqlite` without the `-wal`/`-shm` or an online backup API can yield a torn snapshot.
- **Impact:** “Successful” backup may not restore.
- **Direction:** `VACUUM INTO` or sqlite3 backup API; include wal; set `busy_timeout`.

### P1-13 — Board column PUT fires for every member; server only allows owners/admins

- **Where:** `src/pages/Board.tsx` ~131–147 (debounced PUT on every `columns` change, including initial load); `server.ts` PUT columns ~3578–3591
- **Evidence:** Non-admins get 403 (swallowed). Local `localStorage` still updates. Graph page reads **only** localStorage (`src/pages/Graph.tsx` ~33–48), not the server.
- **Impact:** Split-brain board columns across users/pages; extra 403 noise; a member who adds a column locally thinks it persisted.
- **Direction:** Persist only after admin edit; Graph must load `/api/projects/:id/columns`; don’t PUT on mount.

### P1-14 — No tests; Playwright is dead weight; what would fail first

- **Where:** `package.json` scripts (no `test`); `devDependencies.playwright`; zero spec files
- **Evidence:** Confirmed by tree search. Dockerfile builder still `npm ci`s Playwright into the build context.
- **What would fail if tests existed (highest value first):**
  1. P0-01/02 engine selection and fail-fast
  2. P0-03 export/restore secret handling
  3. OAuth: no user insert without allowlist
  4. `checkProjectAccess` vs documents DELETE
  5. Register ignores client `role`; first user is `super_admin` not `admin`
  6. GitLab path encoding (`encodeURIComponent(owner/name)`) — already fixed once in history
  7. Cookie auth: `/api/auth/me` without cookie → 401
  8. Docker Compose boot (`SECRET_KEY`)
- **Direction:** API integration tests (supertest + in-memory/file SQLite) before Playwright. Add `npm test`. Do not keep Playwright until a smoke spec exists.

### P1-15 — Docker/Node alpine + `sqlite3` native module; no app healthcheck; no data volume for SQLite

- **Where:** `Dockerfile`; `docker-compose.yaml`
- **Evidence:** `node:20-alpine` + `npm ci --omit=dev` installs `sqlite3` (native). No `apk add python3 make g++` / `sqlite-dev`. App service has no `healthcheck`. Compose Postgres has a volume; the app has none (OK only if Postgres always works — it does not, see P0-01).
- **Impact:** Image build may fail on musl prebuilds; runtime fallback DB is discarded; orchestrators cannot know the app is up.
- **Direction:** If Postgres-only in prod, omit `sqlite3` from the runtime image. Add `HEALTHCHECK` hitting a new `/api/health` that reports **actual** engine.

### P1-16 — `GET /api/tasks` does not call `checkProjectAccess` when `projectId` is passed

- **Where:** `server.ts` ~2267–2290
- **Evidence:** Filter is `(owner OR pm OR tm OR assignee OR creator) AND projectId=?`. A non-member who is assignee of one task sees **only that task** here, but the same user passing `GET /api/projects/:id` succeeds via P1-01 and then loads documents.
- **Impact:** Inconsistent; clients that trust “project page loaded” will fetch sibling APIs the task list would not have shown.
- **Direction:** One access helper; optional `include: tasks` scoped by the same rule.

### P1-17 — Logout increments `tokenVersion` globally; logout accepts Bearer *or* cookie

- **Where:** `POST /api/auth/logout` ~1064–1077
- **Evidence:** Any valid JWT (cookie or `Authorization: Bearer`) bumps `tokenVersion`, invalidating **all** sessions for that user. Frontend `AuthContext.logout` does not send credentials explicitly (same-origin cookie is enough).
- **Impact:** Multi-device sign-out is forced on every logout (maybe desired). A stolen JWT used against `/logout` still kills other sessions — good — but there is no session table, so you cannot revoke one device. Bearer path is leftover from pre-cookie auth (`cookie_authenticated` placeholder still special-cased).
- **Direction:** Session ids; logout current session only; drop Bearer except for a future MCP token.

### P1-18 — Rate limits are coarse and auth limiter includes `/api/auth/me`

- **Where:** `server.ts` ~151–170
- **Evidence:** `/api/` = 1000 / 15 min / IP. `/api/auth/` = 50 / hour / IP — this prefix includes **`/api/auth/me`** and OAuth callbacks. `validate.xForwardedForHeader: false` with `trust proxy: 1`.
- **Impact:** NAT/office IP: 50 `/me` + login + OAuth callbacks per hour can 429 legitimate users. 1000 API calls is easy for the SPA (every page loads 3–4 full collections; Layout polls `/api/integrations/status` on **every pathname change**).
- **Direction:** Exclude `/me` and OAuth callbacks from `authLimiter`. Tighten login/register/forgot. Add per-user limits.

### P1-19 — Admin backup UI vs super_admin API

- **Where:** `Profile.tsx` backup tab `user?.role === 'admin' || super_admin`; `requireAdmin` for `/api/backup/info`; `requireSuperAdmin` for export/restore
- **Impact:** Admins see Download/Restore controls and get 403. Docs say admins can restore.
- **Direction:** Hide actions the role cannot perform; don’t show restore to `admin` if policy is super_admin-only.

### P1-20 — Unbounded list APIs (DoS / memory)

- **Where:** `GET /api/tasks`, `/api/projects`, `/api/users`, `/api/search`, `/api/milestones` — no `LIMIT`/`offset`
- **Evidence:** `NotificationsDropdown` fetches **all tasks** to derive a bell feed. Dashboard/Board/Calendar/Graph each refetch all three collections.
- **Impact:** Payload and JSON parse cost grow without bound; 10mb `express.json` limit is for **inbound** restore, not outbound lists.
- **Direction:** Pagination; `/api/notifications`; shared client cache.

---

## P2 — debt that will bite

### P2-01 — Monolith `server.ts` (module boundaries)

- **Where:** `server.ts` entire file
- **Evidence:** HTTP + authn + authz + SQL dialect wrappers + Git + mail + backups + SPA hosting + timers.
- **Impact:** Cannot unit-test PAT encryption or access control without booting Express. MCP connector later would otherwise grow this file further.
- **Direction:** Extract `db/`, `auth/`, `rbac/`, `git/`, `backup/`, `routes/` without behavior change. Keep one `app.ts` composer.

### P2-02 — Schema evolution is try/catch `ALTER TABLE`, not migrations

- **Where:** `server.ts` ~556–728
- **Evidence:** Dozens of `try { ALTER TABLE … } catch {}`. `CREATE TABLE users` omits columns that later ALTERs add (`tokenVersion`, `authProvider`, `emailVerified`, …). Restore allowlist (~4456) **omits** `tokenVersion`, `authProvider`, `emailVerified`, `createdAt` for users.
- **Impact:** Restore from JSON drops auth columns (NULL `authProvider` / `emailVerified`). Dual-engine drift (SQLite `INSERT OR IGNORE` vs PG `ON CONFLICT`). No schema version.
- **Direction:** Numbered SQL migrations per engine; restore allowlist = live schema.

### P2-03 — Weak SQL dialect abstraction

- **Where:** `PgWrapper.convertSql` (`?` → `$n`); call sites still branch `if (db.isPg)` for upserts, `RETURNING`, `ON CONFLICT`
- **Evidence:** `POST /api/projects/:id/members` uses SQLite-style `ON CONFLICT(projectId, userId) DO UPDATE` (~3923) for both engines (works on PG only if PK matches). Nested `transaction()` on PG does **not** open a savepoint (`cb(txWrapper)`).
- **Impact:** Next feature will add another `isPg` fork and a silent SQL incompatibility.
- **Direction:** Small query builder or per-engine repositories.

### P2-04 — JWT / crypto nits

- **Where:** `jwt.sign/verify` without `{ algorithms: ['HS256'] }`; HMAC `timingSafeEqual(Buffer.from(parsed.sig), Buffer.from(expectedSig))` (~1211) throws if lengths differ (caught as generic OAuth failure); AES key = SHA-256 of secret (OK) but same secret as JWT if `TOKEN_ENCRYPTION_KEY` unset
- **Impact:** Defense in depth; PAT decrypt fails hard if JWT secret rotates (`decryptSecret` returns `""` and Git calls run unauthenticated or with empty token).
- **Direction:** Pin alg; separate keys; decrypt failure should 409 “re-enter PAT”, not empty string.

### P2-05 — CSRF / cookies generally

- **Where:** `getCookieOptions` — httpOnly, secure in prod, SameSite=Lax, no CSRF token, no `Origin` check on state-changing POST
- **Impact:** Same-site attacker pages on the same eTLD+1, or GET CSRF (P1-07). Fine for many SPA deploys; not fine if `APP_URL` is a shared parent domain.
- **Direction:** Double-submit or `Origin` allowlist matching `APP_URL`.

### P2-06 — Password policy and OAuth/local mixing

- **Where:** Min length 8 only; OAuth users get a random bcrypt hash; `POST /api/auth/login` does not check `authProvider`; reset-password works for OAuth users and does not flip `authProvider`
- **Impact:** OAuth account can acquire a password via forgot-password; account-linking attacks are partly blocked (`authProvider === 'local'` refuses GitLab) but reset bypasses the intended “one provider” model.
- **Direction:** Provider-bound login; optional password set in Profile only.

### P2-07 — Git integration correctness (beyond pagination)

- **Where:** Git handlers in `server.ts`; `ProjectGitModal.tsx`; `GitRepositoryPage.tsx`; `TaskModal.tsx` (triplicated flows)
- **Evidence:**
  - GitHub `repos/${owner}/${name}` vs GitLab `projects/${encodeURIComponent(owner + '/' + name)}` — GitLab subgroups OK; GitHub names with extra path segments from URL parse (`parts.slice(1).join('/')`) get `encodeURIComponent`’d as one segment.
  - Create-branch / PR confused-deputy guard (`isProjectAdminOrOwner`) is real and good; **GET branches** still decrypts PAT for admins only (`canUsePat`), members get local fallback — OK.
  - Errors from GitHub (`errText`) returned to the client (~3230–3247).
  - Docs: `/git-repository`, “commit history”, “authors and timestamps” — route is `/git`; API returns name/sha/message only, no author/history endpoint.
  - `VITE_GIT_ENABLED` / `GitFeatureContext` is **client localStorage**. Server git routes always exist.
- **Direction:** One git service module; feature flag server-side; stop duplicating UI.

### P2-08 — Frontend structure / performance

- **Where:** Pages listed in inventory; `AuthContext` placeholder `token = "cookie_authenticated"`; Layout polls integrations on every route
- **Evidence:** Duplicate fetch waterfalls; `Board` 1291 lines; `Profile` 1284; `App.tsx` imports unused `useLocation`; `Register.tsx` keeps unused `role` state and **sends** it (server ignores — good)
- **Impact:** Slow TTI; inconsistent authz UI; hard to add MCP-driven screens later
- **Direction:** Split containers vs presenters; one `api.ts` client; React Query; drop dummy token in favor of `isAuthenticated`

### P2-09 — Accessibility

- **Where:** `src/` — grep for `aria-` / `alt=` / `sr-only` finds essentially Profile carousel buttons and Login `tabIndex={-1}` on show-password
- **Evidence:** Icon-only controls in Layout/Board; custom `CustomSelect`/`SearchableSelect`; Kanban drag is mouse-centric (native drag, not `@dnd-kit` keyboard sensors — those sensors are only on Dashboard widgets)
- **Impact:** Keyboard/screen-reader users cannot operate the core board. Contrast theme exists (`ThemeContext`) but forms use 9px labels.
- **Direction:** Real `<button>`/`<select>`; dialog roles on modals; dnd-kit keyboard on the board if drag stays.

### P2-10 — Markdown XSS posture

- **Where:** `react-markdown` in Board/Graph/Documents/TaskModal/Projects/Teams; `@uiw/react-md-editor` in Documents
- **Evidence:** No `rehype-sanitize`. React-Markdown v10 does not enable raw HTML by default (good). MDEditor’s preview stack is separate and historically more HTML-friendly.
- **Impact:** Stored XSS if editor preview or a future `rehype-raw` lands. Comments are plain text in React (escaped) — better.
- **Direction:** Pin sanitization on any markdown renderer; CSP already helps in production (`scriptSrc` self+nonce).

### P2-11 — Logging / validation / types

- **Where:** `morgan("dev")` always; `tsconfig.json` has **no** `strict`; `server.ts` uses `req: any` everywhere; no Zod/Valibot
- **Evidence:** Production request logs include paths (reset tokens are POST body, OK) but OAuth error pages echo `e.message`. Task/document bodies mostly unchecked beyond a few fields (description length unbounded; 10mb JSON).
- **Impact:** Cannot trust types; over-large wiki/task payloads; noisy/insufficient logs for incident response (no request id).
- **Direction:** `strict: true` incrementally; schema validation on writes; pino/morgan combined with redaction.

### P2-12 — Foreign keys and delete semantics

- **Where:** `DELETE /api/users/:id` ~2006–2010; `DELETE /api/projects/:id` ~3762–3777; `DELETE /api/teams/:id`
- **Evidence:** User delete nulls `assigneeId` but leaves `task_comments.userId`, `task_activities.userId`, `documents.authorId`, `tasks.creatorId`. Teams delete members/projects links after deleting the team row. Documents table has FK; tasks table does **not** FK to projects (manual cascade on project delete).
- **Impact:** Orphaned rows; activity feed with missing users (`"system"` is also inserted by PR sync).
- **Direction:** FK + `ON DELETE` policy; tombstones for users.

### P2-13 — Env / Vite production config

- **Where:** `docker-compose.yaml` passes `VITE_APP_NAME` at **runtime**; Vite inlines `import.meta.env.VITE_*` at **build** (`src/config.ts`, `GitFeatureContext`)
- **Evidence:** Changing Compose env will not change the built SPA. `vite.config.ts` `allowedHosts` hardcoded `iraj.anahaitech.com`. Corrupted comment `Do not modifyâ`.
- **Impact:** Wrong app title/git flag in containers; HMR host surprises.
- **Direction:** Bake ARG at image build or expose a `/api/config` for public flags.

### P2-14 — Dual lockfiles and unused dependencies

- **Where:** `package.json`, `package-lock.json`, `bun.lock`
- **Unused or leftover (no imports):** `@google/genai`, `react-joyride`, `@types/dagre` is used via dagre. `@dnd-kit/*` unused on the Kanban (only Dashboard). Playwright unused.
- **Impact:** Supply-chain surface; Gemini key in `.env.example` is a false requirement (`GEMINI_API_KEY` in Compose too).
- **Direction:** Delete unused deps; one lockfile (npm, matching Dockerfile).

---

## P3 — cleanup / nits / docs drift

### P3-01 — Naming leftover from a template / AI Studio

- `package.json` `"name": "react-example"`, `"version": "0.0.0"`
- `metadata.json` (`MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`, `requestFramePermissions`)
- `server.ts` header `// AI Studio Editor Sync`
- Favicon path `src/assets/images/favicon_icon_1784198348441.jpg`
- Login/Register label “Authorization Key” for password
- User-facing product strings mix “DevTeam Task Manager”, “IRAJ”, “ProjectManager”, “Σ”

### P3-02 — Dead scripts

- `scripts/backup.cjs` — copies `Dashboard.tsx` to `Dashboard.tsx.backup`
- `scripts/check_indexes.cjs` — one-off Dashboard string rewrite (`activeAnalyticsChart` → `activeChart`)

### P3-03 — Dead / broken frontend bits

- `src/lib/export.ts` `document.createElement('url')` (unused; download still uses `'a'`)
- `src/App.tsx` unused `useLocation` import
- `Register.tsx` unused `role` state still posted
- `src/pages/Profile.tsx` stale comment “Initiates download of the live binary SQLite database file” above JSON download (endpoint does not exist)

### P3-04 — Docs vs code (do not trust docs during cleanup)

| Doc claim | Code |
| :--- | :--- |
| React 18 | React 19 |
| First user is **Admin** / others **Member** | First user `super_admin`; others `developer` + unverified |
| Three roles Admin/Manager/Member | 9 seeded roles including `super_admin`, `viewer`, `qa`, … |
| Team **domain** restrictions (`@company.com`) | **No domain logic** |
| `/git-repository`, commit authors/history | Route `/git`; no history API |
| Binary `.sqlite` in-app download/restore | JSON only |
| Restore creates `.rollback` | HTTP restore does not |
| `npm install --production` then `npm run build` | Build needs devDeps (`tsx`/`vite`/`esbuild`/`typescript`) |
| Playwright implied by lockfile | No tests |
| `/users-admin` | Route is `/admin/users` |

Also: `docs/README.md` title “DevTeam Task Manager”; repo is IRAJ.

### P3-05 — Miscellaneous

- `projectKey` backfill is random 3 letters, **not unique** (~583–587)
- Helmet CSP `styleSrc` includes `'unsafe-inline'`
- `morgan("dev")` in production
- `extractTaskNumber` takes the **last** digit run in a branch name (`feature/foo-2-bar-3` → 3) and may bump `taskCounter`
- ErrorBoundary shows `error.message` to end users
- `WelcomeModal` exists (onboarding); `react-joyride` does not

---

## Recommended cleanup sequence

Later “bulletproof” work should follow this order so each phase is testable. Do not start an MCP server until Phase 2 is done.

### Phase 0 — Stop the bleeding (prod safety)

1. Fail fast on Postgres when `DATABASE_URL` is set; delete `/tmp` fallback in production.
2. Add `SECRET_KEY` + `TOKEN_ENCRYPTION_KEY` to Compose; `/api/health` (engine, db ping, no auth).
3. Disable OAuth user auto-create; add `ALLOW_PUBLIC_REGISTER=false` default.
4. Fix backup export/restore (P0-03/04) or **remove the in-app restore** until it is safe.
5. Catch async errors so the process cannot die on `JSON.parse`.

**Exit:** `docker compose up` boots; killing Postgres fails the app; restore refuses redacted JSON.

### Phase 1 — Authz correctness

1. Rewrite `checkProjectAccess` / `checkTaskAccess` / project-role vs global-role.
2. Documents/milestones/columns/git-read permission matrix (table in code comments + tests).
3. `/api/auth/me` returns permissions; frontend uses only those flags.
4. Close promotion path to `admin`; CSRF on export; session model (optional but design it).

**Exit:** Tests for “assignee cannot delete wiki”; custom role UI matches API.

### Phase 2 — Split the monolith (behavior-preserving)

1. `server/db/{sqlite,pg,migrate}.ts`
2. `server/auth/{jwt,oauth,passwords}.ts`
3. `server/rbac.ts`
4. `server/git/{github,gitlab}.ts`
5. `server/routes/*`
6. Keep `server.ts` as compose + listen only.

**Exit:** Same HTTP contract; file sizes allow review; this is the attachment point for MCP (tool handlers call the same services as HTTP).

### Phase 3 — Data layer

1. Real migrations; schema version; FK policy.
2. WAL-safe backup; CLI talks to the active engine.
3. Pagination on list endpoints.
4. `taskCounter` transactional increment.

### Phase 4 — Git + product correctness

1. Pagination; status mapping for custom columns; server-side git feature flag.
2. Deduplicate `ProjectGitModal` / `GitRepositoryPage` / `TaskModal` git sections.
3. Don’t return raw provider error bodies.

### Phase 5 — Frontend hardening

1. Shared API client + cache.
2. Split Board/Profile/Git pages.
3. a11y on board/modals; sanitize markdown.
4. `strict` TypeScript, incremental.

### Phase 6 — Tests, CI, deps, docs

1. API tests for P0/P1 cases; one Playwright smoke (login + board load).
2. GitHub Actions: `lint` (`tsc --noEmit`) + tests + docker build.
3. Remove unused deps (`@google/genai`, `react-joyride`, Playwright until used), `bun.lock` or npm — pick one.
4. Rewrite docs to match code (roles, routes, backup, Docker env). Rename `react-example`.

### Phase 7 — MCP connector (explicitly out of this PR)

- Reuse Phase 2 services; do **not** add routes to a 5k-line `server.ts`.
- Auth: dedicated PAT/JWT audience, not the browser cookie.
- Tools should call the same RBAC helpers as HTTP.

---

## Out of scope / what looks actually solid

Do not rip these out during cleanup; they are the right primitives.

- **Parameterized queries** for user data (`?` placeholders almost everywhere). No string-interpolated user values in API SQL (CLI import is the exception).
- **PAT at rest:** AES-256-GCM with random 12-byte IV, auth tag, `enc:` prefix; `sanitizeProject` never returns the ciphertext to the client (mask `••••••••`).
- **Confused-deputy guard** on Git **write** (create branch, PR, sync): `isProjectAdminOrOwner` before using `repoToken`.
- **Cookie session:** httpOnly, `secure` in prod, SameSite=Lax; `tokenVersion` checked against DB on every request; password change / role bulk-update bumps it.
- **OAuth CSRF:** HMAC-signed state with nonce table + 15 min expiry + timing-safe compare; callback HTML uses CSP nonce + `escapeHtml` / `safeJsonForScriptTag`; `postMessage` target `window.location.origin`.
- **Register role spoofing is blocked:** client may send `role`; server assigns `super_admin` (first user) or `developer`.
- **Email enumeration** on forgot-password: same success message if user missing.
- **Helmet CSP in production** (script nonce + `self`); `express.json` 10mb cap; auth + API rate limits exist (policy needs tuning, not invention).
- **GitLab project path encoding** uses `encodeURIComponent(\`${owner}/${name}\`)` (commit `21ccb4c` in history).
- **Frontend cookie cleanup:** `AuthContext` removes legacy `localStorage.token`.
- **ErrorBoundary** at root; `safeFormatDate` guards invalid dates; project git token field round-trips the mask without sending it back as a new secret (`repoToken !== '••••••••'`).
- **Seeded super_admin permissions are immutable** via `PUT /api/roles/super_admin` rejection.
- **License MIT; docs folder exists** and is indexed — content is stale, structure is useful.

---

## Suggested owner reading order for the next agent

1. This file.
2. `server.ts` `initDb`, `authenticateToken`, `checkProjectAccess`, backup handlers, git handlers — in that order.
3. `src/contexts/AuthContext.tsx` + `src/App.tsx` gates.
4. `docker-compose.yaml` + `.env.example` vs actual `process.env` reads in `server.ts`.
5. Only then frontend pages.

Do not “clean up” formatting or rename the package until Phase 6. Do not add MCP in the same PR as authz changes.
