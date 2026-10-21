import type { DatabaseWrapper } from "../../types.ts";

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/i;

function assertSafeIdentifier(name: string, kind: string): void {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(`Unsafe ${kind} identifier: ${name}`);
  }
}

export async function tableExists(db: DatabaseWrapper, table: string): Promise<boolean> {
  assertSafeIdentifier(table, "table");
  if (db.isPg) {
    const row = await db.get<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?) AS exists",
      table
    );
    return Boolean(row?.exists);
  }
  const row = await db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    table
  );
  return Boolean(row?.name);
}

export async function columnExists(db: DatabaseWrapper, table: string, column: string): Promise<boolean> {
  assertSafeIdentifier(table, "table");
  assertSafeIdentifier(column, "column");
  if (db.isPg) {
    const row = await db.get<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = ?) AS exists",
      [table, column]
    );
    return Boolean(row?.exists);
  }
  const cols = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

export async function addColumnIfMissing(
  db: DatabaseWrapper,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  if (await columnExists(db, table, column)) return;
  assertSafeIdentifier(table, "table");
  assertSafeIdentifier(column, "column");
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
