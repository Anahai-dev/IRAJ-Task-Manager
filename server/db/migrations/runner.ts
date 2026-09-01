import type { DatabaseWrapper } from "../../types.ts";
import { MIGRATION_STEPS, SCHEMA_VERSION } from "./steps.ts";

async function ensureMigrationsTable(db: DatabaseWrapper): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      appliedAt TEXT NOT NULL
    );
  `);
}

export async function getAppliedMigrationVersions(db: DatabaseWrapper): Promise<Set<number>> {
  await ensureMigrationsTable(db);
  const rows = await db.all<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version ASC");
  return new Set(rows.map((r) => Number(r.version)));
}

export async function runMigrations(db: DatabaseWrapper): Promise<number> {
  await ensureMigrationsTable(db);
  const applied = await getAppliedMigrationVersions(db);

  for (const step of MIGRATION_STEPS) {
    if (applied.has(step.version)) continue;
    console.log(`[db] Applying migration v${step.version}: ${step.name}`);
    await step.up(db);
    await db.run("INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)", [
      step.version,
      step.name,
      new Date().toISOString(),
    ]);
  }

  const latest = await db.get<{ version: number }>("SELECT MAX(version) as version FROM schema_migrations");
  const version = Number(latest?.version || 0);
  if (version !== SCHEMA_VERSION) {
    console.warn(`[db] Schema version ${version}; expected ${SCHEMA_VERSION}`);
  }
  return version;
}
