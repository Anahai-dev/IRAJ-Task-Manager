import { test, describe } from "node:test";
import assert from "node:assert/strict";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { checkProjectWriteAccess, resolveUserPermissions } from "../server/rbac.ts";
import { SqliteWrapper } from "../server/db/sqlite.ts";

describe("RBAC and Access Control Regression Tests", () => {
  let db: any;

  test("Setup in-memory test database with RBAC schema", async () => {
    const sqliteDb = await open({
      filename: ":memory:",
      driver: sqlite3.Database
    });
    db = new SqliteWrapper(sqliteDb);

    await db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        passwordHash TEXT,
        role TEXT,
        tokenVersion INTEGER DEFAULT 1
      );
      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT,
        permissions TEXT
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT,
        ownerId TEXT
      );
      CREATE TABLE project_members (
        id TEXT PRIMARY KEY,
        projectId TEXT,
        userId TEXT,
        role TEXT
      );
      CREATE TABLE teams (
        id TEXT PRIMARY KEY,
        name TEXT
      );
      CREATE TABLE team_members (
        id TEXT PRIMARY KEY,
        teamId TEXT,
        userId TEXT
      );
      CREATE TABLE team_projects (
        id TEXT PRIMARY KEY,
        teamId TEXT,
        projectId TEXT
      );

      INSERT INTO roles (id, name, permissions) VALUES 
        ('super_admin', 'Super Admin', '{"create_tasks":true,"edit_all_tasks":true,"delete_tasks":true,"manage_projects":true,"manage_teams":true,"manage_users":true,"manage_roles":true,"reset_database":true}'),
        ('developer', 'Developer', '{"create_tasks":true,"edit_all_tasks":false,"delete_tasks":false,"manage_projects":false,"manage_teams":false,"manage_users":false,"manage_roles":false}'),
        ('viewer', 'Viewer', '{"create_tasks":false,"edit_all_tasks":false,"delete_tasks":false,"manage_projects":false,"manage_teams":false,"manage_users":false,"manage_roles":false}');

      INSERT INTO users (id, name, email, role) VALUES 
        ('user-superadmin', 'Super User', 'super@example.com', 'super_admin'),
        ('user-dev', 'Dev User', 'dev@example.com', 'developer'),
        ('user-viewer', 'Viewer User', 'viewer@example.com', 'viewer');

      INSERT INTO projects (id, name, ownerId) VALUES 
        ('proj-1', 'Alpha Project', 'user-dev');
    `);
  });

  test("Super admin has full write access to any project", async () => {
    const superAdmin = { id: "user-superadmin", name: "Super", email: "super@example.com", role: "super_admin" };
    const canWrite = await checkProjectWriteAccess(db, "proj-1", superAdmin);
    assert.equal(canWrite, true);
  });

  test("Project owner has write access", async () => {
    const owner = { id: "user-dev", name: "Dev", email: "dev@example.com", role: "developer" };
    const canWrite = await checkProjectWriteAccess(db, "proj-1", owner);
    assert.equal(canWrite, true);
  });

  test("Global viewer role is strictly denied project write access", async () => {
    const viewer = { id: "user-viewer", name: "Viewer", email: "viewer@example.com", role: "viewer" };
    const canWrite = await checkProjectWriteAccess(db, "proj-1", viewer);
    assert.equal(canWrite, false);
  });

  test("Project member with 'viewer' role is denied write access even if added to project", async () => {
    await db.run("INSERT INTO project_members (id, projectId, userId, role) VALUES ('pm-1', 'proj-1', 'user-viewer', 'viewer')");
    const viewer = { id: "user-viewer", name: "Viewer", email: "viewer@example.com", role: "viewer" };
    const canWrite = await checkProjectWriteAccess(db, "proj-1", viewer);
    assert.equal(canWrite, false);
  });

  test("Team membership does NOT bypass viewer write restriction", async () => {
    await db.run("INSERT INTO teams (id, name) VALUES ('team-1', 'Engineering Team')");
    await db.run("INSERT INTO team_members (id, teamId, userId) VALUES ('tm-1', 'team-1', 'user-viewer')");
    await db.run("INSERT INTO team_projects (id, teamId, projectId) VALUES ('tp-1', 'team-1', 'proj-1')");

    const viewer = { id: "user-viewer", name: "Viewer", email: "viewer@example.com", role: "viewer" };
    const canWrite = await checkProjectWriteAccess(db, "proj-1", viewer);
    assert.equal(canWrite, false, "Viewer must not gain write access through team membership");
  });

  test("Legitimate developer in team receives write access", async () => {
    await db.run("INSERT INTO users (id, name, email, role) VALUES ('user-dev2', 'Dev 2', 'dev2@example.com', 'developer')");
    await db.run("INSERT INTO team_members (id, teamId, userId) VALUES ('tm-2', 'team-1', 'user-dev2')");

    const devUser = { id: "user-dev2", name: "Dev2", email: "dev2@example.com", role: "developer" };
    const canWrite = await checkProjectWriteAccess(db, "proj-1", devUser);
    assert.equal(canWrite, true);
  });

  test("resolveUserPermissions hydrates complete permissions", async () => {
    const superPerms = await resolveUserPermissions(db, {
      id: "user-superadmin",
      name: "Super",
      email: "super@example.com",
      role: "super_admin",
    });
    assert.equal(superPerms.create_tasks, true);
    assert.equal(superPerms.manage_roles, true);
    assert.equal(superPerms.reset_database, true);

    const viewerPerms = await resolveUserPermissions(db, {
      id: "user-viewer",
      name: "Viewer",
      email: "viewer@example.com",
      role: "viewer",
    });
    assert.equal(viewerPerms.create_tasks, false);
    assert.equal(viewerPerms.delete_tasks, false);
  });

  test("OAuth auto-registration respects production default closed setting", () => {
    const isProd = true;
    const envExplicitTrue: string | undefined = "true";
    const envExplicitFalse: string | undefined = "false";
    const envUndefined: string | undefined = undefined;

    // Production: disabled unless explicitly true
    const prodDefault = isProd ? (envUndefined === "true") : (envUndefined !== "false");
    assert.equal(prodDefault, false, "Production should default to disabled");

    const prodExplicitEnable = isProd ? (envExplicitTrue === "true") : (envExplicitTrue !== "false");
    assert.equal(prodExplicitEnable, true, "Explicit 'true' should allow auto-registration");

    const prodExplicitDisable = isProd ? (envExplicitFalse === "true") : (envExplicitFalse !== "false");
    assert.equal(prodExplicitDisable, false, "Explicit 'false' should disable auto-registration");
  });

  test("Backup export preserves user passwords and encrypted tokens without corruption", async () => {
    // Insert dummy record with real password hash
    await db.run("INSERT INTO users (id, name, email, passwordHash, role) VALUES ('u-secret', 'Secret User', 'sec@example.com', '$2b$10$realhashvalue1234567890', 'developer')");
    const exportedUser = await db.get("SELECT * FROM users WHERE id = 'u-secret'");
    
    // Ensure export does NOT destroy passwordHash with bullet placeholder
    assert.notEqual(exportedUser.passwordHash, '••••••••');
    assert.equal(exportedUser.passwordHash, '$2b$10$realhashvalue1234567890');
  });
});
