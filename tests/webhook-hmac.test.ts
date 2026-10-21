import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { webhookService } from "../server/services/webhook.service.ts";
import { SqliteWrapper } from "../server/db/sqlite.ts";
import { createSecretCipher } from "../server/auth/crypto.ts";
import { setRuntime } from "../server/runtime.ts";
import { loadConfig } from "../server/config.ts";

const cipher = createSecretCipher("test-pat-encryption-key-distinct");
const { encryptSecret, decryptSecretOrEmpty } = cipher;

describe("Webhook Cryptographic HMAC and Token Verification Tests", () => {
  const secret = "super-secret-hmac-key-98765";
  const encryptedSecret = encryptSecret(secret);
  const projectId = "proj-webhook-test-101";

  const rawPayload = JSON.stringify({
    action: "opened",
    repository: { full_name: "testorg/testrepo" },
    pull_request: {
      number: 42,
      html_url: "https://github.com/testorg/testrepo/pull/42",
      state: "open",
      head: { ref: "feature/auth-hardening" }
    }
  });

  const rawPingPayload = JSON.stringify({
    zen: "Non-blocking is better than blocking.",
    hook_id: 1234567,
    repository: { full_name: "testorg/testrepo" }
  });

  const gitlabPayload = {
    object_kind: "merge_request",
    project: { path_with_namespace: "testorg/testrepo" },
    object_attributes: {
      id: 99,
      iid: 12,
      source_branch: "feature/auth-hardening",
      target_branch: "main",
      state: "opened",
      url: "https://gitlab.com/testorg/testrepo/-/merge_requests/12"
    }
  };

  after(() => {
    webhookService.setDb(undefined);
  });

  test("Setup in-memory test database with encrypted webhook secret", async () => {
    const sqliteDb = await open({
      filename: ":memory:",
      driver: sqlite3.Database
    });
    const db = new SqliteWrapper(sqliteDb);

    await db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT,
        ownerId TEXT,
        repoOwner TEXT,
        repoName TEXT,
        repoUrl TEXT,
        webhookSecret TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        projectId TEXT,
        title TEXT,
        status TEXT,
        branchName TEXT,
        prUrl TEXT,
        prStatus TEXT,
        assigneeId TEXT,
        creatorId TEXT
      );
      CREATE TABLE task_activities (
        id TEXT PRIMARY KEY,
        taskId TEXT,
        userId TEXT,
        action TEXT,
        createdAt TEXT
      );
    `);

    await db.run(
      "INSERT INTO projects (id, name, ownerId, repoOwner, repoName, webhookSecret, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [projectId, "Webhook Test Proj", "user-test-owner", "testorg", "testrepo", encryptedSecret, new Date().toISOString(), new Date().toISOString()]
    );

    webhookService.setDb(db);
    const config = loadConfig({
      NODE_ENV: "test",
      SECRET_KEY: "test-secret-key-for-unit-tests-only",
      TOKEN_ENCRYPTION_KEY: "test-pat-encryption-key-distinct",
    });
    setRuntime({
      getDb: async () => db,
      config,
      encryptSecret: cipher.encryptSecret,
      decryptSecret: decryptSecretOrEmpty,
      authenticateToken: (_req, _res, next) => next(),
    });
  });

  test("GitHub sha256 HMAC calculates matching signature", () => {
    const signature = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(Buffer.from(rawPayload, "utf8"))
      .digest("hex")}`;

    assert.ok(signature.startsWith("sha256="));
    assert.equal(signature.length, 7 + 64);
  });

  test("handleGitHubWebhook verifies and accepts signed ping event", async () => {
    const validPingSig = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(Buffer.from(rawPingPayload, "utf8"))
      .digest("hex")}`;

    const res = await webhookService.handleGitHubWebhook(
      "ping",
      JSON.parse(rawPingPayload),
      rawPingPayload,
      validPingSig
    );

    assert.equal(res.success, true);
    assert.equal(res.message, "PONG");
  });

  test("handleGitHubWebhook rejects unsigned or invalid signature on ping event", async () => {
    const invalidPingSig = `sha256=${crypto
      .createHmac("sha256", "wrong-secret-key")
      .update(Buffer.from(rawPingPayload, "utf8"))
      .digest("hex")}`;

    await assert.rejects(
      () =>
        webhookService.handleGitHubWebhook(
          "ping",
          JSON.parse(rawPingPayload),
          rawPingPayload,
          invalidPingSig
        ),
      (err: any) => err.message === "Invalid GitHub webhook signature"
    );

    await assert.rejects(
      () =>
        webhookService.handleGitHubWebhook(
          "ping",
          JSON.parse(rawPingPayload),
          rawPingPayload,
          undefined
        ),
      (err: any) => err.message === "Missing X-Hub-Signature-256 header"
    );
  });

  test("handleGitHubWebhook verifies valid signature and rejects forged signature on PR event", async () => {
    const validSignature = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(Buffer.from(rawPayload, "utf8"))
      .digest("hex")}`;

    const forgedSignature = `sha256=${crypto
      .createHmac("sha256", "wrong-secret-key")
      .update(Buffer.from(rawPayload, "utf8"))
      .digest("hex")}`;

    const parsedPayload = JSON.parse(rawPayload);

    const result = await webhookService.handleGitHubWebhook(
      "pull_request",
      parsedPayload,
      rawPayload,
      validSignature
    );
    assert.equal(result.success, true);

    await assert.rejects(
      () =>
        webhookService.handleGitHubWebhook(
          "pull_request",
          parsedPayload,
          rawPayload,
          forgedSignature
        ),
      (err: any) => err.message === "Invalid GitHub webhook signature"
    );
  });

  test("handleGitLabWebhook verifies valid secret token and rejects invalid token", async () => {
    const res = await webhookService.handleGitLabWebhook(
      "Merge Request Hook",
      gitlabPayload,
      secret
    );
    assert.equal(res.success, true);

    await assert.rejects(
      () =>
        webhookService.handleGitLabWebhook(
          "Merge Request Hook",
          gitlabPayload,
          "wrong-gitlab-token"
        ),
      (err: any) => err.message === "Invalid GitLab webhook token"
    );

    await assert.rejects(
      () =>
        webhookService.handleGitLabWebhook(
          "Merge Request Hook",
          gitlabPayload,
          undefined
        ),
      (err: any) => err.message === "Missing X-Gitlab-Token header"
    );
  });
});
