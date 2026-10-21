import { test, describe } from "node:test";
import assert from "node:assert/strict";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { emailDomainAllowed, resolveOAuthUser, OAuthSignupDisabledError } from "../server/auth/oauth.ts";
import { SqliteWrapper } from "../server/db/sqlite.ts";
import type { DatabaseWrapper } from "../server/types.ts";

describe("OAuth Security and Auto-Registration Tests", () => {
  let db: DatabaseWrapper;

  test("Initialize in-memory database with auth schema", async () => {
    const sqliteDb = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });
    db = new SqliteWrapper(sqliteDb);

    await db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        passwordHash TEXT,
        role TEXT,
        skills TEXT,
        rolePrefix TEXT,
        status TEXT,
        tokenVersion INTEGER DEFAULT 1,
        authProvider TEXT DEFAULT 'local',
        emailVerified INTEGER DEFAULT 1,
        createdAt TEXT
      );
      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT,
        permissions TEXT
      );
      INSERT INTO roles (id, name, permissions) VALUES 
        ('super_admin', 'Super Admin', '{"create_tasks":true,"manage_roles":true,"reset_database":true}'),
        ('developer', 'Developer', '{"create_tasks":false,"manage_roles":false}');
    `);
  });

  test("resolveOAuthUser creates developer when auto-provision enabled", async () => {
    const user = await resolveOAuthUser(
      db,
      { email: "developer@company.com", name: "Dev", provider: "gitlab" },
      { autoProvision: true, allowedDomains: [], bcryptRounds: 4 }
    );
    assert.equal(user.role, "developer");
  });

  test("OAuth domain whitelist via emailDomainAllowed", () => {
    assert.equal(emailDomainAllowed("alice@acme.com", ["acme.com", "partner.org"]), true);
    assert.equal(emailDomainAllowed("attacker@evil.com", ["acme.com", "partner.org"]), false);
  });

  test("Auto-provision disabled rejects new OAuth users", async () => {
    await assert.rejects(
      () =>
        resolveOAuthUser(
          db,
          { email: "newuser@example.com", name: "New", provider: "github" },
          { autoProvision: false, allowedDomains: [], bcryptRounds: 4 }
        ),
      OAuthSignupDisabledError
    );
  });
});
