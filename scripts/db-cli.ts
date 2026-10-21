#!/usr/bin/env npx tsx
import "dotenv/config";
import fs from "fs";
import path from "path";
import { loadConfig } from "../server/config.ts";
import { initDb } from "../server/db/index.ts";
import { backupSqliteDatabase, resolveActiveSqlitePath } from "../server/db/backup.ts";
import { BACKUP_TABLE_COLUMNS, assertBackupSecretsRestoreable } from "../server/util.ts";
import type { DatabaseWrapper } from "../server/types.ts";

const ALLOWED_TABLES = new Set(Object.keys(BACKUP_TABLE_COLUMNS));

function printHelp() {
  console.log(`Database CLI (engine-aware)
Usage: npm run db-cli <command> [args]

Commands:
  status                 Show engine, path, and table counts
  backup [file]          WAL-safe SQLite backup (VACUUM INTO) or pg_dump hint
  export-json [file]     Export allowlisted tables (includes live secrets)
  import-json <file>     Restore from JSON using column allowlist
`);
}

async function openDb(): Promise<{ db: DatabaseWrapper; config: ReturnType<typeof loadConfig> }> {
  const config = loadConfig();
  const init = await initDb(config);
  return { db: init.db, config };
}

async function cmdStatus() {
  const { db, config } = await openDb();
  console.log(`Engine: ${db.engine}`);
  if (db.engine === "sqlite") {
    const sqlitePath = resolveActiveSqlitePath(config);
    const size = fs.existsSync(sqlitePath) ? fs.statSync(sqlitePath).size : 0;
    console.log(`SQLite path: ${sqlitePath}`);
    console.log(`Size: ${size} bytes`);
  } else {
    console.log(`Postgres URL: ${config.db.databaseUrl?.replace(/:[^:@/]+@/, ":***@")}`);
  }
  for (const table of ALLOWED_TABLES) {
    try {
      const row = await db.get<{ count: number | string }>(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`  ${table}: ${row?.count ?? 0}`);
    } catch {
      console.log(`  ${table}: (missing)`);
    }
  }
  await db.close?.();
}

async function cmdBackup(targetArg?: string) {
  const { db, config } = await openDb();
  if (db.engine === "postgres") {
    console.log("Postgres backup: use pg_dump with DATABASE_URL from your environment.");
    console.log(`Example: pg_dump \"$DATABASE_URL\" -Fc -f backup.dump`);
    await db.close?.();
    return;
  }
  const sqlitePath = resolveActiveSqlitePath(config);
  const target = targetArg
    ? path.resolve(targetArg)
    : path.join(process.cwd(), "backups", `backup-${Date.now()}.sqlite`);
  await backupSqliteDatabase(sqlitePath, target, config.db.busyTimeoutMs);
  console.log(`SQLite backup written to ${target}`);
  await db.close?.();
}

async function cmdExportJson(targetArg?: string) {
  const { db } = await openDb();
  const payload: Record<string, unknown> = {
    format: "iraj-cli-backup-v1",
    secretsIncluded: true,
    exportedAt: new Date().toISOString(),
  };
  for (const table of ALLOWED_TABLES) {
    payload[table] = await db.all(`SELECT * FROM ${table}`);
  }
  const target = targetArg
    ? path.resolve(targetArg)
    : path.join(process.cwd(), "backups", `backup-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  console.log(`Exported to ${target}`);
  await db.close?.();
}

async function cmdImportJson(sourceArg?: string) {
  if (!sourceArg) throw new Error("import-json requires a source file");
  const source = path.resolve(sourceArg);
  const raw = JSON.parse(fs.readFileSync(source, "utf8")) as Record<string, unknown>;
  assertBackupSecretsRestoreable(raw);
  const { db } = await openDb();
  await db.transaction(async (tx) => {
    for (const table of ALLOWED_TABLES) {
      try {
        await tx.exec(`DELETE FROM ${table}`);
      } catch {
        // table may not exist on older schemas
      }
    }
    for (const table of ALLOWED_TABLES) {
      const rows = raw[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const allowedCols = BACKUP_TABLE_COLUMNS[table];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const presentCols = Object.keys(row as object).filter((c) => allowedCols.includes(c));
        if (presentCols.length === 0) continue;
        const placeholders = presentCols.map(() => "?").join(", ");
        await tx.run(
          `INSERT INTO ${table} (${presentCols.join(", ")}) VALUES (${placeholders})`,
          presentCols.map((c) => (row as Record<string, unknown>)[c])
        );
      }
    }
  });
  console.log(`Imported from ${source}`);
  await db.close?.();
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!command || command === "help" || command === "-h") {
    printHelp();
    return;
  }
  switch (command) {
    case "status":
    case "stats":
      await cmdStatus();
      break;
    case "backup":
      await cmdBackup(arg);
      break;
    case "export-json":
      await cmdExportJson(arg);
      break;
    case "import-json":
      await cmdImportJson(arg);
      break;
    default:
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
