import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import request from "supertest";
import { loadConfig } from "../server/config.ts";
import { initDb } from "../server/db/index.ts";
import { createApp } from "../server/app.ts";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "iraj-phase5-"));
}

async function makeApp(dir: string) {
  const env = {
    NODE_ENV: "test",
    SECRET_KEY: "test-secret-key-for-unit-tests-only",
    TOKEN_ENCRYPTION_KEY: "test-pat-encryption-key-distinct",
    ALLOW_PUBLIC_REGISTER: "true",
    SQLITE_PATH: path.join(dir, "database.sqlite"),
    PAGINATION_MAX_PAGE_SIZE: "100",
  };
  const config = loadConfig(env);
  const init = await initDb(config);
  const app = await createApp({ config, getDb: async () => init.db, serveFrontend: false });
  return { app, db: init.db };
}

describe("Phase 5/6 API hardening", { concurrency: 1 }, () => {
  test("pagination clamps pageSize to configured max", async () => {
    const { app, db } = await makeApp(tempDir());
    const reg = await request(app).post("/api/auth/register").send({
      name: "Pager",
      email: "pager@example.com",
      password: "password123",
    });
    const cookie = reg.headers["set-cookie"];
    const res = await request(app)
      .get("/api/tasks?page=1&pageSize=9999")
      .set("Cookie", cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.pageInfo.pageSize <= 100);
    await db.close?.();
  });

  test("GET /api/backup/export-json remains disabled (POST-only)", async () => {
    const { app, db } = await makeApp(tempDir());
    const reg = await request(app).post("/api/auth/register").send({
      name: "Backup",
      email: "backup-get@example.com",
      password: "password123",
    });
    const cookie = reg.headers["set-cookie"];
    const res = await request(app).get("/api/backup/export-json").set("Cookie", cookie);
    assert.equal(res.status, 404);
    await db.close?.();
  });
});
