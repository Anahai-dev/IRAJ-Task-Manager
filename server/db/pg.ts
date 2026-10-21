import { Pool, type PoolClient } from "pg";
import type { DatabaseWrapper } from "../types.ts";

function convertSql(sql: string): string {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

function mapParams(params: unknown[]): unknown[] {
  return params.map((p) => (typeof p === "undefined" ? null : p));
}

function asArray(params?: unknown | unknown[]): unknown[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

function createClientWrapper(poolOrClient: Pool | PoolClient, convert: typeof convertSql): DatabaseWrapper {
  const query = async (sql: string, params: unknown[] = []) => {
    const converted = convert(sql);
    return poolOrClient.query(converted, mapParams(params));
  };

  const wrapper: DatabaseWrapper = {
    isPg: true,
    engine: "postgres",
    exec: async (sql: string) => {
      await poolOrClient.query(sql);
    },
    run: async (sql: string, params?: unknown | unknown[]) => {
      await query(sql, asArray(params));
    },
    get: async <T = Record<string, unknown>>(sql: string, params?: unknown | unknown[]) => {
      const result = await query(sql, asArray(params));
      return result.rows[0] as T | undefined;
    },
    all: async <T = Record<string, unknown>>(sql: string, params?: unknown | unknown[]) => {
      const result = await query(sql, asArray(params));
      return result.rows as T[];
    },
    transaction: async <T>(callback: (tx: DatabaseWrapper) => Promise<T>): Promise<T> => {
      // Nested transactions reuse the same client (no savepoint) — documented limitation.
      return callback(wrapper);
    },
  };
  return wrapper;
}

export class PgWrapper implements DatabaseWrapper {
  public readonly isPg = true;
  public readonly engine = "postgres" as const;
  private pool: Pool;

  constructor(connectionString: string, connectionTimeoutMs = 5000) {
    this.pool = new Pool({ connectionString, connectionTimeoutMillis: connectionTimeoutMs });
  }

  async testConnection(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.testConnection();
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async run(sql: string, params?: unknown | unknown[]): Promise<void> {
    const converted = convertSql(sql);
    await this.pool.query(converted, mapParams(asArray(params)));
  }

  async get<T = Record<string, unknown>>(sql: string, params?: unknown | unknown[]): Promise<T | undefined> {
    const converted = convertSql(sql);
    const result = await this.pool.query(converted, mapParams(asArray(params)));
    return result.rows[0] as T | undefined;
  }

  async all<T = Record<string, unknown>>(sql: string, params?: unknown | unknown[]): Promise<T[]> {
    const converted = convertSql(sql);
    const result = await this.pool.query(converted, mapParams(asArray(params)));
    return result.rows as T[];
  }

  async transaction<T>(callback: (tx: DatabaseWrapper) => Promise<T>): Promise<T> {
    const maxRetries = 3;
    let attempt = 0;
    while (attempt < maxRetries) {
      const client = await this.pool.connect();
      const txWrapper = createClientWrapper(client, convertSql);
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const result = await callback(txWrapper);
        await client.query("COMMIT");
        return result;
      } catch (e: unknown) {
        try {
          await client.query("ROLLBACK");
        } catch (rbErr) {
          console.warn("Rollback failed:", rbErr);
        }
        const code = (e as { code?: string }).code;
        if (code === "40001" && attempt < maxRetries - 1) {
          attempt++;
          await new Promise((res) => setTimeout(res, Math.floor(Math.random() * 50) + 10));
          continue;
        }
        throw e;
      } finally {
        client.release();
      }
    }
    throw new Error("Transaction failed after maximum retries");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
