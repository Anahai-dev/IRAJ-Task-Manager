# 💾 Database Operations & Backups

IRAJ Task Manager supports local **SQLite** development and **PostgreSQL** production. Engine selection is explicit: there is no silent fallback.

---

## 1. Dual Engine Architecture (SQLite & PostgreSQL)

- **SQLite**: used when `DATABASE_URL` is omitted (or left as the placeholder). File path defaults to `./database.sqlite` or `SQLITE_PATH`. The process **exits** if the file is not writable (no `/tmp` fallback).
- **PostgreSQL**: used when `DATABASE_URL` is a real `postgres://` / `postgresql://` URL. If Postgres is down, the process **fails fast** instead of writing to a local SQLite file.

`GET /api/health` reports `{ ok, engine: "sqlite"|"postgres", db: "up"|"down" }` and returns HTTP 503 when the configured engine cannot be pinged.

---

## 2. In-App Backup UI

Super Admins can open **Profile → Backup & Restore**:

### Export (POST `/api/backup/export-json`)
- Cookie-authenticated **POST** (not GET — GET was CSRF-able with SameSite=Lax).
- Writes a **metadata-only** JSON file (`secretsIncluded: false`). Password hashes and Git PATs are redacted as `••••••••`.
- This file is **not restoreable**. Use it for a human-readable workspace snapshot, not disaster recovery.

### Restore (POST `/api/backup/restore-json`)
- Super Admin only. Body must include `confirm: true`.
- **Refuses** redacted/sentinel secrets and any dump with `secretsIncluded: false`.
- Wipes allowlisted tables inside a transaction, then inserts. There is no automatic `.rollback` file on the HTTP API.
- For a secrets-preserving restore, use a CLI export that contains live `passwordHash` / `repoToken` values (keep that file encrypted at rest).

Admins without `reset_database` can view engine stats (`GET /api/backup/info`) but cannot export or restore.

---

## 3. Command Line Interface (`scripts/db-cli.ts`)

SQLite-oriented local tool (not copied into the Docker image):

```bash
npm run db-cli stats
npm run db-cli backup
npm run db-cli export-json ./backups/export.json
npm run db-cli import-json ./backups/export.json
```

CLI `export-json` currently dumps live secrets. Treat those files as credentials.

---

## 4. Production VPS & Docker Deployment

Required in production (Compose reads them from `.env` / `env_file`, never hardcodes them):

- `SECRET_KEY` — JWT signing
- `TOKEN_ENCRYPTION_KEY` — PAT encryption (must be **distinct** from `SECRET_KEY`)
- `APP_URL` — public origin
- `DATABASE_URL` — Postgres (Compose always sets this)

```bash
cp .env.example .env   # fill SECRET_KEY, TOKEN_ENCRYPTION_KEY, APP_URL
docker compose up -d --build
docker compose logs -f app
```

If Postgres is unreachable, the app container will not silently switch to SQLite; `/api/health` fails and the Compose healthcheck is unhealthy.
