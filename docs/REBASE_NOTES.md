# Rebase notes: `cleanup/bulletproof` → `main` (`b249af3`)

Branch: `cleanup/bulletproof-rebased`  
Base: `origin/main` @ `b249af3`  
Source: `origin/cleanup/bulletproof` @ `6a814d3` (6 commits on old `main` `cd2d50c`)

## Strategy

Upstream `main` gained a parallel modularization (`server/routes/*.routes.ts`, `server/db.ts`, `server/services/*`) while cleanup used a deeper split (`server/app.ts`, `server/rbac.ts`, `server/db/*`, pagination, typed config). A straight cherry-pick of cleanup commits onto `main` duplicated routers and DB entrypoints.

Resolution: merge `main` into the cleanup tree, keep **cleanup’s module layout**, and **port upstream behavior** into those modules. Removed duplicate `*.routes.ts`, `server/db.ts`, and `server/middleware/auth.ts` after porting.

## Conflicts resolved (merge `main` into cleanup tip)

| Area | Resolution |
|------|------------|
| `.env.example`, `Dockerfile`, `README.md`, `docker-compose.yaml` | Kept cleanup ops/docs; merged new env vars and upstream deployment hints from `main`. |
| `package.json` / lockfile | Cleanup scripts (`test`, `iraj-task-manager` name, `supertest`); added `undici` for outbound webhooks; test glob runs `test/**` and `tests/**`. |
| `server.ts` | Cleanup bootstrap (`loadConfig`, `initDb`, `createApp`, background jobs). Added notification/webhook delivery retention from upstream sync jobs. |
| `server/config.ts`, `server/types.ts` | Cleanup typed config + types; preserved upstream env keys where `main` added them. |
| `src/lib/api.ts` | Cleanup client (`apiFetch`, pagination helpers) + upstream `onUnauthorized` / `apiFetchRaw` 401 fan-out. |
| `src/lib/permissions.ts` | Cleanup flag helpers + upstream `can()` role fallbacks. |
| Frontend pages/components (Board, Graph, Profile, UsersAdmin, modals, Layout, etc.) | Cleanup API client usage; absorbed upstream UI splits from `main` (board/profile/git components, `RealtimeContext`, `taskService`). |
| `src/contexts/AuthContext.tsx` | Cookie auth + `isAuthenticated` + `can()` for board permissions. |

## Upstream features ported into cleanup modules

| Upstream (`main`) | Ported to |
|-------------------|-----------|
| SSE `/api/events`, notifications CRUD | `server/routes/events.ts`, `server/services/events.service.ts`, mounted in `server/app.ts` |
| Inbound GitHub/GitLab webhooks + outbound project webhooks | `server/routes/webhooks.ts`, `server/services/webhook.service.ts`, raw body middleware in `server/app.ts` |
| Project inbound webhook secret routes | `server/routes/projects.ts` |
| Email verify GET/POST | `server/routes/auth.ts` |
| DB migrations 006–008 (notifications, webhooks, email_verifications) | `server/db/migrations/steps.ts` v4–v6 |
| `checkProjectWriteAccess` / task list `projectId` gate | `server/rbac.ts`, `server/routes/tasks.ts` |
| Git mutation write gate (not viewer) | `canContributeToProject` on git POST routes in `server/routes/projects.ts` |
| Bearer + cookie auth | `server/auth/middleware.ts` |
| Background PR sync + purge/retention | `server/services/sync.service.ts` (shared logic), `server.ts` job scheduler |
| Client realtime + task save helper | `src/contexts/RealtimeContext.tsx`, `src/lib/taskService.ts` |
| API 404 catch-all for `/api/*` | `server/app.ts` |

## Stricter checks kept

- **Upstream**: `GET /api/tasks?projectId=` requires project access; git POST requires write/contribute (not viewer-only).
- **Cleanup**: RBAC project model (assignee alone does not grant project wiki/members); document delete rules; backup export/restore flags.

## Route / permission audit

- Cleanup route surface preserved; added upstream-only routes (events, notifications, webhooks, verify-email, webhook-secret).
- Removed duplicate `*.routes.ts` mounts to avoid double registration.
- Permission helpers centralized in `server/rbac.ts` (`checkProjectWriteAccess`, `getAuthorizedProjectUserIds`).

## Verification (this branch)

| Command | Result |
|---------|--------|
| `npm ci` | pass |
| `npm run lint` (`tsc --noEmit`) | pass |
| `npm test` | **52/52** pass |
| `npm run build` | pass |
| Server smoke | `/api/health` 200, `/api/auth/me` 401 without cookie, register + tasks OK |

## Protected branches

`cleanup/bulletproof`, `main`, and `audit/codebase-problem-map` were **not** modified or force-pushed.

## Human review

- Confirm outbound webhook SSRF rules and `undici` agent behavior in your deployment network.
- Email verification on register still uses admin-contact flow on cleanup; token routes exist for upstream-compatible links.
- Dual auth rate limiting: cleanup uses configurable single-tier limiter on `/api/auth/`; upstream had per-IP + per-account limiters — consider porting if you need exact parity.
