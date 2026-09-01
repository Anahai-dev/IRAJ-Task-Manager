import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import request from "supertest";
import { CONFIG_DEFAULTS, buildConfig, loadConfig, isConfiguredPostgresUrl } from "../server/config.ts";
import { DatabaseInitError, initDb } from "../server/db/index.ts";
import { createApp } from "../server/app.ts";
import { resolveOAuthUser, OAuthSignupDisabledError } from "../server/auth/oauth.ts";
import { assertBackupSecretsRestoreable, isRedactedSecret } from "../server/util.ts";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "iraj-test-"));
}

function testEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    SECRET_KEY: "test-secret-key-for-unit-tests-only",
    TOKEN_ENCRYPTION_KEY: "test-pat-encryption-key-distinct",
    ALLOW_PUBLIC_REGISTER: "true",
    OAUTH_AUTO_PROVISION: "false",
    DATABASE_URL: undefined,
    ...overrides,
  };
}

async function makeApp(dir: string, envOverrides: Record<string, string | undefined> = {}) {
  const env = testEnv({ SQLITE_PATH: path.join(dir, "database.sqlite"), ...envOverrides });
  const config = loadConfig(env);
  const init = await initDb(config);
  const app = await createApp({ config, getDb: async () => init.db, serveFrontend: false });
  return { app, db: init.db, config };
}

describe("configuration", () => {
  test("CONFIG_DEFAULTS exposes documented operator knobs", () => {
    assert.equal(CONFIG_DEFAULTS.http.port, 3000);
    assert.equal(CONFIG_DEFAULTS.rateLimit.api.max, 1000);
    assert.equal(CONFIG_DEFAULTS.rateLimit.auth.max, 50);
    assert.equal(CONFIG_DEFAULTS.git.prSyncIntervalMs, 5 * 60 * 1000);
    assert.equal(CONFIG_DEFAULTS.auth.bcryptRounds, 10);
    assert.equal(CONFIG_DEFAULTS.http.jsonBodyLimit, "10mb");
  });

  test("buildConfig applies env overrides for http and rate limits", () => {
    const config = buildConfig(
      testEnv({
        PORT: "4001",
        HOST: "127.0.0.1",
        RATE_LIMIT_API_MAX: "42",
        GIT_PR_SYNC_INTERVAL_MS: "120000",
        BCRYPT_ROUNDS: "12",
        JSON_BODY_LIMIT: "5mb",
      })
    );
    assert.equal(config.http.port, 4001);
    assert.equal(config.http.host, "127.0.0.1");
    assert.equal(config.rateLimit.api.max, 42);
    assert.equal(config.git.prSyncIntervalMs, 120000);
    assert.equal(config.auth.bcryptRounds, 12);
    assert.equal(config.http.jsonBodyLimit, "5mb");
  });

  test("production fails fast without SECRET_KEY", () => {
    assert.throws(
      () =>
        buildConfig({
          NODE_ENV: "production",
          SECRET_KEY: "",
          TOKEN_ENCRYPTION_KEY: "distinct-key",
          APP_URL: "https://tasks.example.com",
          DATABASE_URL: "postgres://user:pass@db.example:5432/app",
        }),
      /SECRET_KEY/
    );
  });

  test("production fails fast when TOKEN_ENCRYPTION_KEY matches SECRET_KEY", () => {
    assert.throws(
      () =>
        buildConfig({
          NODE_ENV: "production",
          SECRET_KEY: "same-secret-value",
          TOKEN_ENCRYPTION_KEY: "same-secret-value",
          APP_URL: "https://tasks.example.com",
          DATABASE_URL: "postgres://user:pass@db.example:5432/app",
        }),
      /TOKEN_ENCRYPTION_KEY/
    );
  });
});

describe("P0/P1 API", { concurrency: 1 }, () => {
test("isConfiguredPostgresUrl treats placeholder and empty as unset", () => {
  assert.equal(isConfiguredPostgresUrl(undefined), false);
  assert.equal(isConfiguredPostgresUrl(""), false);
  assert.equal(isConfiguredPostgresUrl("postgres://user:password@localhost:5432/dbname"), false);
  assert.equal(isConfiguredPostgresUrl("postgres://real:pw@db.example:5432/app"), true);
});

test("P0-01: DATABASE_URL postgres fails fast instead of falling back to SQLite", async () => {
  const dir = tempDir();
  const env = testEnv({
    DATABASE_URL: "postgres://iraj:iraj@127.0.0.1:1/iraj_missing",
    SQLITE_PATH: path.join(dir, "database.sqlite"),
  });
  const config = loadConfig(env);
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

  const env = testEnv({
    ALLOW_PUBLIC_REGISTER: "false",
    SQLITE_PATH: path.join(dir, "database.sqlite"),
  });
  const config = loadConfig(env);
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
  const { db, config } = await makeApp(tempDir());
  await assert.rejects(
    () =>
      resolveOAuthUser(
        db,
        { email: "new@oauth.test", name: "New User", provider: "google" },
        { autoProvision: false, allowedDomains: [], bcryptRounds: config.auth.bcryptRounds }
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
  const { db, config } = await makeApp(tempDir());
  const created = await resolveOAuthUser(
    db,
    { email: "git@oauth.test", name: "Git User", provider: "github" },
    { autoProvision: true, allowedDomains: [], bcryptRounds: config.auth.bcryptRounds }
  );
  const again = await resolveOAuthUser(
    db,
    { email: "git@oauth.test", name: "Git User", provider: "github" },
    { autoProvision: false, allowedDomains: [], bcryptRounds: config.auth.bcryptRounds }
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
