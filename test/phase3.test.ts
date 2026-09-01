import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import request from "supertest";
import { loadConfig } from "../server/config.ts";
import { initDb } from "../server/db/index.ts";
import { runMigrations, getAppliedMigrationVersions } from "../server/db/migrations/runner.ts";
import { SCHEMA_VERSION } from "../server/db/migrations/steps.ts";
import { createApp } from "../server/app.ts";
import { BACKUP_TABLE_COLUMNS, mapPrStatusToBoardColumn, nextTaskCounter } from "../server/util.ts";
import { v4 as uuidv4 } from "uuid";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "iraj-phase3-"));
}

async function makeApp(dir: string) {
  const env = {
    NODE_ENV: "test",
    SECRET_KEY: "test-secret-key-for-unit-tests-only",
    TOKEN_ENCRYPTION_KEY: "test-pat-encryption-key-distinct",
    ALLOW_PUBLIC_REGISTER: "true",
    SQLITE_PATH: path.join(dir, "database.sqlite"),
  };
  const config = loadConfig(env);
  const init = await initDb(config);
  const app = await createApp({ config, getDb: async () => init.db, serveFrontend: false });
  return { app, db: init.db, config };
}

describe("Phase 3 data layer", { concurrency: 1 }, () => {
  test("numbered migrations record schema version", async () => {
    const dir = tempDir();
    const { db } = await makeApp(dir);
    const applied = await getAppliedMigrationVersions(db);
    assert.ok(applied.has(SCHEMA_VERSION), `expected migration ${SCHEMA_VERSION} applied`);
    const row = await db.get<{ version: number }>("SELECT MAX(version) as version FROM schema_migrations");
    assert.equal(Number(row?.version), SCHEMA_VERSION);
    await db.close?.();
  });

  test("backup allowlist includes auth columns on users", () => {
    const cols = BACKUP_TABLE_COLUMNS.users;
    for (const required of ["tokenVersion", "authProvider", "emailVerified", "createdAt"]) {
      assert.ok(cols.includes(required), `users allowlist missing ${required}`);
    }
  });

  test("list APIs return items and pageInfo", async () => {
    const { app, db } = await makeApp(tempDir());
    const reg = await request(app).post("/api/auth/register").send({
      name: "Ada",
      email: "ada-phase3@example.com",
      password: "password123",
    });
    const cookie = reg.headers["set-cookie"];
    const res = await request(app).get("/api/tasks?page=1&pageSize=10").set("Cookie", cookie);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.equal(typeof res.body.pageInfo.page, "number");
    assert.equal(typeof res.body.pageInfo.hasMore, "boolean");
    await db.close?.();
  });

  test("sequential taskCounter allocations are unique", async () => {
    const { db } = await makeApp(tempDir());
    const projectId = uuidv4();
    await db.run(
      "INSERT INTO projects (id, name, description, ownerId, projectKey, taskCounter, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [projectId, "Counter", "", "u1", "CTR", 0, new Date().toISOString()]
    );
    const values: number[] = [];
    for (let i = 0; i < 5; i++) {
      values.push(await nextTaskCounter(db, projectId));
    }
    assert.equal(new Set(values).size, values.length);
    await db.close?.();
  });

  test("mapPrStatusToBoardColumn skips when review column is unmapped", async () => {
    const { db } = await makeApp(tempDir());
    const projectId = uuidv4();
    await db.run(
      "INSERT INTO projects (id, name, description, ownerId, projectKey, taskCounter, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [projectId, "Cols", "", "u1", "COL", 0, new Date().toISOString()]
    );
    await db.run(
      "INSERT INTO project_columns (id, projectId, columnsJson, updatedAt) VALUES (?, ?, ?, ?)",
      [uuidv4(), projectId, JSON.stringify([{ id: "todo", title: "Todo" }, { id: "shipped", title: "Shipped" }]), new Date().toISOString()]
    );
    const merged = await mapPrStatusToBoardColumn(db, projectId, "todo", "merged");
    assert.equal(merged, "shipped");
    const open = await mapPrStatusToBoardColumn(db, projectId, "todo", "open");
    assert.equal(open, null);
    await db.close?.();
  });
});
