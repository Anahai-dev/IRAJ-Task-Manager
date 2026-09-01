import type { Database } from "sqlite";
import type { DatabaseWrapper } from "../types.ts";

function asArray(params?: unknown | unknown[]): unknown[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

export class SqliteWrapper implements DatabaseWrapper {
  public readonly isPg = false;
  public readonly engine = "sqlite" as const;
  public db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async ping(): Promise<void> {
    await this.db.get("SELECT 1");
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async run(sql: string, params?: unknown | unknown[]): Promise<void> {
    await this.db.run(sql, ...asArray(params));
  }

  async get<T = Record<string, unknown>>(sql: string, params?: unknown | unknown[]): Promise<T | undefined> {
    return (await this.db.get(sql, ...asArray(params))) as T | undefined;
  }

  async all<T = Record<string, unknown>>(sql: string, params?: unknown | unknown[]): Promise<T[]> {
    return (await this.db.all(sql, ...asArray(params))) as T[];
  }

  async transaction<T>(callback: (tx: DatabaseWrapper) => Promise<T>): Promise<T> {
    await this.run("BEGIN IMMEDIATE");
    try {
      const result = await callback(this);
      await this.run("COMMIT");
      return result;
    } catch (e) {
      try {
        await this.run("ROLLBACK");
      } catch (rbErr) {
        console.warn("SQLite rollback failed:", rbErr);
      }
      throw e;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
    }
  }
}
