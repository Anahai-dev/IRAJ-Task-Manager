import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import request from "supertest";
import { loadConfig } from "../server/config.ts";
import { initDb } from "../server/db/index.ts";
import { createApp } from "../server/app.ts";
import { createSecretCipher } from "../server/auth/crypto.ts";
import { assertBackupSecretsRestoreable, isRedactedSecret } from "../server/util.ts";

function testEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    SECRET_KEY: "test-secret-key-for-unit-tests-only",
    TOKEN_ENCRYPTION_KEY: "test-pat-encryption-key-distinct",
    ALLOW_PUBLIC_REGISTER: "true",
    ...overrides,
  };
}

describe("Backup Export and Restore Security Tests", () => {
  test("Encrypted secrets round-trip via createSecretCipher", () => {
    const { encryptSecret, decryptSecretOrEmpty } = createSecretCipher("test-pat-encryption-key-distinct");
    const rawSecret = "glpat-super-secret-gitlab-token-12345";
    const encrypted = encryptSecret(rawSecret);
    assert.notEqual(encrypted, rawSecret);
    assert.equal(decryptSecretOrEmpty(encrypted), rawSecret);
  });

  test("isRedactedSecret detects masked placeholders", () => {
    assert.equal(isRedactedSecret("••••••••"), true);
    const { encryptSecret } = createSecretCipher("test-pat-encryption-key-distinct");
    assert.equal(isRedactedSecret(encryptSecret("valid-token")), false);
  });

  test("assertBackupSecretsRestoreable rejects masked repo tokens", () => {
    assert.throws(() =>
      assertBackupSecretsRestoreable({
        projects: [{ id: "p1", repoToken: "••••••••" }],
      })
    );
  });

  test("HTTP restore route rejects payloads containing masked placeholders", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
    const config = loadConfig(testEnv({ SQLITE_PATH: path.join(dir, "database.sqlite") }));
    const init = await initDb(config);
    await init.db.run(
      "INSERT INTO users (id, name, email, passwordHash, role, tokenVersion, emailVerified, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["backup-test-superadmin-999", "Backup Test Admin", "admin-test@example.com", "hash", "super_admin", 1, 1, "Available"]
    );
    const app = await createApp({ config, getDb: async () => init.db, serveFrontend: false });
    const token = jwt.sign(
      { id: "backup-test-superadmin-999", role: "super_admin", tokenVersion: 1 },
      config.security.secretKey,
      { expiresIn: "1h" }
    );

    const res = await request(app)
      .post("/api/backup/restore-json")
      .set("Cookie", `${config.auth.cookie.name}=${token}`)
      .send({
        users: [{ id: "u-1", email: "admin@test.com", passwordHash: "hash" }],
        projects: [{ id: "p-1", repoToken: "••••••••" }],
      });

    assert.equal(res.status, 400);
    await init.db.close?.();
  });
});
