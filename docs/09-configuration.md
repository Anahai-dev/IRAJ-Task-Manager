# Configuration reference

All server runtime knobs are defined in `server/config.ts` (`CONFIG_DEFAULTS` + `buildConfig()`). **Only** `server/config.ts` reads `process.env`; application code uses the frozen `AppConfig` object.

Copy `.env.example` to `.env` for local development. In production / Docker Compose you must set at least `SECRET_KEY`, `TOKEN_ENCRYPTION_KEY`, and `APP_URL`.

---

## Quick index (by section)

| Section | Env prefix / keys | Purpose |
| :--- | :--- | :--- |
| **http** | `APP_URL`, `HOST`, `PORT`, `HOST_NAME`, `HTTP_*`, `JSON_BODY_LIMIT` | Bind address, public URL, body limits, shutdown |
| **db** | `DATABASE_URL`, `SQLITE_PATH`, `SQLITE_BUSY_TIMEOUT_MS`, `PG_*`, `DB_PURGE_*` | Engine selection, paths, purge jobs |
| **security** | `SECRET_KEY`, `TOKEN_ENCRYPTION_KEY`, `SECURITY_CSP_*`, `SECURITY_COEP_*` | JWT, PAT encryption, helmet |
| **auth** | `AUTH_COOKIE_*`, `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`, `PASSWORD_*` | Sessions, password policy |
| **registration** | `ALLOW_PUBLIC_REGISTER` | Public sign-up after bootstrap |
| **oauth** | `OAUTH_*`, `GOOGLE_*`, `GITHUB_*`, `GITLAB_*` | OAuth providers, auto-provision, CSRF state |
| **rateLimit** | `RATE_LIMIT_API_*`, `RATE_LIMIT_AUTH_*` | Express rate limiters |
| **backup** | `BACKUP_EXPORT_ENABLED`, `BACKUP_RESTORE_ENABLED`, `BACKUP_REQUIRE_CONFIRM` | In-app backup API gates |
| **git** | `GIT_ENABLED`, `GIT_PR_SYNC_*`, `GIT_API_*`, `GIT_PROJECT_ACTIVITY_LIMIT` | Server git routes + background PR sync |
| **pagination** | `PAGINATION_DEFAULT_PAGE_SIZE`, `PAGINATION_MAX_PAGE_SIZE`, `PAGINATION_SEARCH_LIMIT` | List API defaults and caps |
| **mail** | `SMTP_*` | Password-reset email |
| **logging** | `LOG_LEVEL`, `MORGAN_FORMAT` | Server logs |

Client-only (Vite build time, **not** in `AppConfig`):

| Key | Purpose |
| :--- | :--- |
| `VITE_APP_NAME`, `VITE_APP_VERSION` | Branding in the SPA |
| `VITE_GIT_ENABLED` | Hide git nav when `false` |
| `VITE_API_URL` | API base path (default `/api`) |

---

## Defaults that affect product behavior

| Setting | Default | Notes |
| :--- | :--- | :--- |
| `ALLOW_PUBLIC_REGISTER` | `false` | First `/register` user is `super_admin`; later signups need admin or this flag |
| `OAUTH_AUTO_PROVISION` | `false` | OAuth login only for existing accounts unless enabled |
| `GIT_ENABLED` | `true` | Set `false` to disable git routes and background PR sync |
| `PAGINATION_DEFAULT_PAGE_SIZE` | `500` | List APIs return `{ items, pageInfo }` |
| `PAGINATION_MAX_PAGE_SIZE` | `5000` | Requests above max are clamped |

---

## Inspecting config in code

```typescript
import { loadConfig, CONFIG_DEFAULTS } from "./server/config.ts";

const config = loadConfig(); // reads process.env
console.log(config.pagination.maxPageSize);
```

Unit tests pass a custom env object: `loadConfig({ NODE_ENV: "test", ... })`.

See also: [Database & backups](./08-database-and-backups.md), [Getting started](./01-getting-started.md).
