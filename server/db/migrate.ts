import type { DatabaseWrapper } from "../types.ts";
import { runMigrations } from "./migrations/runner.ts";

export async function migrateSchema(db: DatabaseWrapper): Promise<void> {
  await runMigrations(db);
}
