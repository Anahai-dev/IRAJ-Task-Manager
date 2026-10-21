import fs from "fs";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import type { AppConfig } from "../config.ts";

export async function backupSqliteDatabase(sqlitePath: string, targetFile: string, busyTimeoutMs: number): Promise<void> {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = await open({ filename: sqlitePath, driver: sqlite3.Database });
  try {
    await db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
    await db.exec(`VACUUM INTO '${targetFile.replace(/'/g, "''")}'`);
  } finally {
    await db.close();
  }
}

export function resolveActiveSqlitePath(config: AppConfig): string {
  return config.db.sqlitePath;
}
