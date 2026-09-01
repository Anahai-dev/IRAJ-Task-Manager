import fs from "fs";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { type AppConfig } from "../config.ts";
import type { DatabaseWrapper } from "../types.ts";
import { PgWrapper } from "./pg.ts";
import { SqliteWrapper } from "./sqlite.ts";
import { migrateSchema } from "./migrate.ts";

export class DatabaseInitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "DatabaseInitError";
    if (options?.cause) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

export interface InitDbResult {
  db: DatabaseWrapper;
  engine: "sqlite" | "postgres";
  sqlitePath: string | null;
}

export async function purgeStaleUnverifiedUsers(db: DatabaseWrapper, afterMs: number): Promise<void> {
  const cutoffDate = new Date(Date.now() - afterMs).toISOString();
  await db.run(
    "DELETE FROM users WHERE authProvider = 'local' AND (emailVerified = 0 OR emailVerified IS NULL) AND createdAt IS NOT NULL AND createdAt < ?",
    [cutoffDate]
  );
}

async function openSqlite(sqlitePath: string, config: AppConfig): Promise<SqliteWrapper> {
  const dir = path.dirname(sqlitePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqliteDb = await open({
    filename: sqlitePath,
    driver: sqlite3.Database,
  });

  try {
    await sqliteDb.exec("CREATE TABLE IF NOT EXISTS _sqlite_write_test (id INTEGER PRIMARY KEY);");
    await sqliteDb.run("INSERT INTO _sqlite_write_test (id) VALUES (NULL);");
    await sqliteDb.run("DELETE FROM _sqlite_write_test;");
  } catch (e: unknown) {
    const message = String((e as { message?: string })?.message || "");
    await sqliteDb.close().catch(() => undefined);
    if (message.toUpperCase().includes("READONLY") || message.toLowerCase().includes("readonly")) {
      throw new DatabaseInitError(
        `SQLite database is not writable at ${sqlitePath}. ${
          config.isProduction
            ? "Refusing /tmp fallback in production. Mount a writable volume or set SQLITE_PATH."
            : "Set SQLITE_PATH to a writable location. /tmp fallback is disabled."
        }`,
        { cause: e }
      );
    }
    throw new DatabaseInitError(`Failed to open SQLite database at ${sqlitePath}: ${message}`, { cause: e });
  }

  const db = new SqliteWrapper(sqliteDb);
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA synchronous = NORMAL;");
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.exec(`PRAGMA busy_timeout = ${config.db.busyTimeoutMs};`);
  return db;
}

export async function initDb(config: AppConfig): Promise<InitDbResult> {
  const databaseUrl = config.db.databaseUrl;
  const usePostgres = config.db.usePostgres;

  let db: DatabaseWrapper;
  let engine: "sqlite" | "postgres";
  let sqlitePath: string | null = null;

  if (usePostgres) {
    const pg = new PgWrapper(databaseUrl as string, config.db.pgConnectionTimeoutMs);
    try {
      await pg.testConnection();
    } catch (e: unknown) {
      const message = String((e as { message?: string })?.message || e);
      throw new DatabaseInitError(
        `PostgreSQL is configured via DATABASE_URL but the connection failed. Refusing to fall back to SQLite. ${message}`,
        { cause: e }
      );
    }
    db = pg;
    engine = "postgres";
    console.log("Connected to PostgreSQL successfully");
  } else {
    sqlitePath = config.db.sqlitePath;
    db = await openSqlite(sqlitePath, config);
    engine = "sqlite";
    console.log(`Using SQLite database engine at ${sqlitePath}`);
  }

  await migrateSchema(db);

  try {
    await purgeStaleUnverifiedUsers(db, config.db.purgeUnverifiedUsersAfterMs);
  } catch (e) {
    console.error("Failed to purge stale unverified users:", e);
  }

  return { db, engine, sqlitePath };
}

export async function pingDb(db: DatabaseWrapper): Promise<void> {
  await db.get("SELECT 1 as ok");
}
