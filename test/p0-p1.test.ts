import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import request from "supertest";
import { loadConfig, isConfiguredPostgresUrl } from "../server/config.ts";
import { DatabaseInitError, initDb } from "../server/db/index.ts";
import { createApp } from "../server/app.ts";
import { resolveOAuthUser, OAuthSignupDisabledError } from "../server/auth/oauth.ts";
import { assertBackupSecretsRestoreable, isRedactedSecret } from "../server/util.ts";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "iraj-test-"));
}

async function makeApp(dir: string) {
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = "test-secret-key-for-unit-tests-only";
  process.env.TOKEN_ENCRYPTION_KEY = "test-pat-encryption-key-distinct";
  process.env.ALLOW_PUBLIC_REGISTER = "true";
  process.env.OAUTH_AUTO_PROVISION = "false";
  delete process.env.DATABASE_URL;
  process.env.SQLITE_PATH = path.join(dir, "database.sqlite");
  const config = loadConfig();
  const init = await initDb(config);
  const app = await createApp({ config, getDb: async () => init.db, serveFrontend: false });
  return { app, db: init.db, config };
}

describe("P0/P1 API", { concurrency: 1 }, () => {
test("isConfiguredPostgresUrl treats placeholder and empty as unset", () => {
  assert.equal(isConfiguredPostgresUrl(undefined), false);
  assert.equal(isConfiguredPostgresUrl(""), false);
  assert.equal(isConfiguredPostgresUrl("postgres://user:password@localhost:5432/dbname"), false);
  assert.equal(isConfiguredPostgresUrl("postgres://real:pw@db.example:5432/app"), true);
});

test("P0-01: DATABASE_URL postgres fails fast instead of falling back to SQLite", async () => {
  const dir = tempDir();
  process.env.NODE_ENV = "test";
  process.env.SECRET_KEY = "test-secret-key-for-unit-tests-only";
  process.env.TOKEN_ENCRYPTION_KEY = "test-pat-encryption-key-distinct";
  process.env.DATABASE_URL = "postgres://iraj:iraj@127.0.0.1:1/iraj_missing";
  process.env.SQLITE_PATH = path.join(dir, "database.sqlite");
  const config = loadConfig();
  await assert.rejects(() => initDb(config), (err: unknown) => {
    assert.ok(err instanceof DatabaseInitError);
    assert.match((err as Error).message, /PostgreSQL is configured/);
    assert.match((err as Error).message, /Refusing to fall back to SQLite/);
    return true;
  });
  assert.equal(fs.existsSync(path.join(dir, "database.sqlite")), false);
});

test("health reports sqlite engine and ok", async () => {
  const { app, db } = await makeApp(tempDir());
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.engine, "sqlite");
  assert.equal(res.body.db, "up");
  await db.close?.();
});

test("first-user bootstrap still creates super_admin; subsequent register allowed when flag on", async () => {
  const { app, db } = await makeApp(tempDir());
  const first = await request(app).post("/api/auth/register").send({
    name: "Ada",
    email: "ada@example.com",
    password: "password123",
    role: "viewer",
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.user.role, "super_admin");
  const me = await request(app).get("/api/auth/me").set("Cookie", first.headers["set-cookie"]);
  assert.equal(me.status, 200);
  assert.equal(me.body.permissions.manage_users, true);
  assert.equal(me.body.permissions.reset_database, true);

  const second = await request(app).post("/api/auth/register").send({
    name: "Bob",
    email: "bob@example.com",
    password: "password123",
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.requiresVerification, true);
  await db.close?.();
});

test("ALLOW_PUBLIC_REGISTER=false blocks non-first registration", async () => {
  const dir = tempDir();
  const { app, db } = await makeApp(dir);
  await request(app).post("/api/auth/register").send({
    name: "Ada",
    email: "ada@example.com",
    password: "password123",
  });
  await db.close?.();

  process.env.ALLOW_PUBLIC_REGISTER = "false";
  process.env.SQLITE_PATH = path.join(dir, "database.sqlite");
  delete process.env.DATABASE_URL;
  const config = loadConfig();
  const init = await initDb(config);
  const app2 = await createApp({ config, getDb: async () => init.db, serveFrontend: false });
  const third = await request(app2).post("/api/auth/register").send({
    name: "Eve",
    email: "eve@example.com",
    password: "password123",
  });
  assert.equal(third.status, 403);
  assert.match(third.body.error, /disabled/i);
  await init.db.close?.();
});

test("P0-05: OAuth does not auto-provision when OAUTH_AUTO_PROVISION is false", async () => {
  const { db } = await makeApp(tempDir());
  await assert.rejects(
    () =>
      resolveOAuthUser(
        db,
        { email: "new@oauth.test", name: "New User", provider: "google" },
        { autoProvision: false, allowedDomains: [] }
      ),
    (err: unknown) => {
      assert.ok(err instanceof OAuthSignupDisabledError);
      return true;
    }
  );
  const count = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM users WHERE email = ?", "new@oauth.test");
  assert.equal(Number(count?.count || 0), 0);
  await db.close?.();
});

test("existing OAuth user can still be resolved for login", async () => {
  const { db } = await makeApp(tempDir());
  const created = await resolveOAuthUser(
    db,
    { email: "git@oauth.test", name: "Git User", provider: "github" },
    { autoProvision: true, allowedDomains: [] }
  );
  const again = await resolveOAuthUser(
    db,
    { email: "git@oauth.test", name: "Git User", provider: "github" },
    { autoProvision: false, allowedDomains: [] }
  );
  assert.equal(again.id, created.id);
  await db.close?.();
});

test("P0-03: restore refuses redacted password hashes and PATs", () => {
  assert.equal(isRedactedSecret("••••••••"), true);
  assert.equal(isRedactedSecret("$2b$10$UnusablePlaceholderPasswordHash000"), true);
  assert.equal(isRedactedSecret("$2b$10$abcdefghijklmnopqrstuv"), false);
  assert.throws(
    () =>
      assertBackupSecretsRestoreable({
        secretsIncluded: false,
        users: [{ id: "1", passwordHash: "••••••••" }],
      }),
    /without secrets/
  );
  assert.throws(
    () =>
      assertBackupSecretsRestoreable({
        users: [{ id: "1", passwordHash: "••••••••" }],
      }),
    /redacted password hashes/
  );
  assert.throws(
    () =>
      assertBackupSecretsRestoreable({
        users: [{ id: "1", passwordHash: "$2b$10$realhashvaluegoeshereok" }],
        projects: [{ id: "p", repoToken: "••••••••" }],
      }),
    /redacted Git PATs/
  );
});

test("in-app JSON export is POST-only metadata dump; restore refuses it", async () => {
  const { app, db } = await makeApp(tempDir());
  const first = await request(app).post("/api/auth/register").send({
    name: "Ada",
    email: "ada@example.com",
    password: "password123",
  });
  const cookie = first.headers["set-cookie"];
  const getExport = await request(app).get("/api/backup/export-json").set("Cookie", cookie);
  assert.equal(getExport.status, 404);

  const exportRes = await request(app).post("/api/backup/export-json").set("Cookie", cookie);
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.body.secretsIncluded, false);
  assert.equal(exportRes.body.users[0].passwordHash, "••••••••");

  const restore = await request(app)
    .post("/api/backup/restore-json")
    .set("Cookie", cookie)
    .send({ ...exportRes.body, confirm: true });
  assert.equal(restore.status, 400);
  assert.match(restore.body.error, /without secrets|redacted/i);
  await db.close?.();
});

test("P1-01/02: task assignee cannot delete project wiki", async () => {
  const { app, db } = await makeApp(tempDir());
  const adminRes = await request(app).post("/api/auth/register").send({
    name: "Ada",
    email: "ada@example.com",
    password: "password123",
  });
  const adminCookie = adminRes.headers["set-cookie"];

  const projectRes = await request(app)
    .post("/api/projects")
    .set("Cookie", adminCookie)
    .send({ name: "Alpha", description: "proj" });
  assert.equal(projectRes.status, 200);
  const projectId = projectRes.body.id;

  const createUser = await request(app)
    .post("/api/users")
    .set("Cookie", adminCookie)
    .send({ name: "Casey", email: "casey2@example.com", password: "password123", role: "developer" });
  assert.equal(createUser.status, 200);
  const caseyId = createUser.body.id;

  const loginCasey = await request(app).post("/api/auth/login").send({
    email: "casey2@example.com",
    password: "password123",
  });
  assert.equal(loginCasey.status, 200);
  const caseyCookie = loginCasey.headers["set-cookie"];

  const taskRes = await request(app)
    .post("/api/tasks")
    .set("Cookie", adminCookie)
    .send({
      title: "Assigned only",
      projectId,
      assigneeId: caseyId,
      status: "todo",
      priority: "medium",
      deadline: new Date().toISOString(),
    });
  assert.equal(taskRes.status, 200);

  const projectGet = await request(app).get(`/api/projects/${projectId}`).set("Cookie", caseyCookie);
  assert.equal(projectGet.status, 403);

  const docCreate = await request(app)
    .post(`/api/projects/${projectId}/documents`)
    .set("Cookie", adminCookie)
    .send({ title: "PRD", content: "secret wiki" });
  assert.equal(docCreate.status, 200);

  const docList = await request(app).get(`/api/projects/${projectId}/documents`).set("Cookie", caseyCookie);
  assert.equal(docList.status, 403);

  const docDelete = await request(app).delete(`/api/documents/${docCreate.body.id}`).set("Cookie", caseyCookie);
  assert.equal(docDelete.status, 403);

  const viewerMember = await request(app)
    .post(`/api/projects/${projectId}/members`)
    .set("Cookie", adminCookie)
    .send({ userId: caseyId, role: "viewer" });
  assert.equal(viewerMember.status, 200);

  const docList2 = await request(app).get(`/api/projects/${projectId}/documents`).set("Cookie", caseyCookie);
  assert.equal(docList2.status, 200);

  const docDelete2 = await request(app).delete(`/api/documents/${docCreate.body.id}`).set("Cookie", caseyCookie);
  assert.equal(docDelete2.status, 403);

  await db.close?.();
});

test("/api/auth/me without cookie is 401", async () => {
  const { app, db } = await makeApp(tempDir());
  const res = await request(app).get("/api/auth/me");
  assert.equal(res.status, 401);
  await db.close?.();
});
});
