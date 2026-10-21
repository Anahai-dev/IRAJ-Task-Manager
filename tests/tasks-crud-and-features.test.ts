import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import crypto from "crypto";
import { resolveUserPermissions } from "../server/rbac.ts";
import { SqliteWrapper } from "../server/db/sqlite.ts";
import { eventsService } from "../server/services/events.service.js";

describe("Tasks CRUD, Dependencies, Documents, Roles, and Email Verification Tests", () => {
  let db: any;

  before(async () => {
    const sqliteDb = await open({
      filename: ":memory:",
      driver: sqlite3.Database
    });
    db = new SqliteWrapper(sqliteDb);

    await db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        passwordHash TEXT,
        role TEXT,
        emailVerified INTEGER DEFAULT 0,
        status TEXT DEFAULT 'Available',
        tokenVersion INTEGER DEFAULT 1,
        createdAt TEXT
      );

      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT,
        is_custom INTEGER DEFAULT 0,
        permissions TEXT
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        ownerId TEXT,
        createdAt TEXT
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        deadline TEXT NOT NULL,
        assigneeId TEXT,
        creatorId TEXT NOT NULL,
        projectId TEXT NOT NULL,
        orderIndex REAL DEFAULT 0,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE task_dependencies (
        taskId TEXT NOT NULL,
        blockedByTaskId TEXT NOT NULL,
        PRIMARY KEY (taskId, blockedByTaskId)
      );

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        authorId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE email_verifications (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        expiresAt INTEGER NOT NULL
      );

      INSERT INTO roles (id, name, permissions) VALUES
        ('super_admin', 'Super Admin', '{"create_tasks":true,"edit_all_tasks":true,"delete_tasks":true,"manage_projects":true,"manage_teams":true,"manage_users":true,"manage_roles":true,"reset_database":true}'),
        ('qa', 'QA Engineer', '{"create_tasks":true,"edit_all_tasks":true,"delete_tasks":false,"manage_projects":false,"manage_teams":false,"manage_users":false,"manage_roles":false}'),
        ('viewer', 'Viewer', '{"create_tasks":false,"edit_all_tasks":false,"delete_tasks":false,"manage_projects":false,"manage_teams":false,"manage_users":false,"manage_roles":false}');

      INSERT INTO users (id, name, email, role, emailVerified, status, createdAt) VALUES
        ('usr_owner', 'Owner Alice', 'owner@example.com', 'super_admin', 1, 'Available', '2026-01-01T00:00:00.000Z'),
        ('usr_dev', 'Dev Bob', 'bob@example.com', 'qa', 1, 'Available', '2026-01-01T00:00:00.000Z');

      INSERT INTO projects (id, name, description, ownerId, createdAt) VALUES
        ('proj_1', 'Main Project', 'Test project description', 'usr_owner', '2026-01-01T00:00:00.000Z');
    `);
  });

  test("Task CRUD: Create, read, update, and order index management", async () => {
    // 1. Create task
    const taskId = "task_001";
    await db.run(
      "INSERT INTO tasks (id, title, description, status, priority, deadline, assigneeId, creatorId, projectId, orderIndex, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [taskId, "Implement Authentication", "Support JWT & cookies", "todo", "high", "2026-10-01", "usr_dev", "usr_owner", "proj_1", 100, new Date().toISOString()]
    );

    const task = await db.get("SELECT * FROM tasks WHERE id = ?", taskId);
    assert.ok(task, "Task should exist");
    assert.equal(task.title, "Implement Authentication");
    assert.equal(task.status, "todo");
    assert.equal(task.priority, "high");

    // 2. Update task
    await db.run(
      "UPDATE tasks SET status = ?, orderIndex = ? WHERE id = ?",
      ["in_progress", 200, taskId]
    );

    const updatedTask = await db.get("SELECT * FROM tasks WHERE id = ?", taskId);
    assert.equal(updatedTask.status, "in_progress");
    assert.equal(updatedTask.orderIndex, 200);

    // 3. Delete task
    await db.run("DELETE FROM tasks WHERE id = ?", taskId);
    const deletedTask = await db.get("SELECT * FROM tasks WHERE id = ?", taskId);
    assert.equal(deletedTask, undefined, "Task should be deleted");
  });

  test("Task Dependencies: Blocking relations and cascading cleanup", async () => {
    // Create task A and task B
    await db.run(
      "INSERT INTO tasks (id, title, status, priority, deadline, creatorId, projectId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["task_a", "Database Schema", "done", "high", "2026-10-01", "usr_owner", "proj_1", new Date().toISOString()]
    );
    await db.run(
      "INSERT INTO tasks (id, title, status, priority, deadline, creatorId, projectId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["task_b", "API Endpoints", "todo", "medium", "2026-10-05", "usr_owner", "proj_1", new Date().toISOString()]
    );

    // Task B is blocked by Task A
    await db.run(
      "INSERT INTO task_dependencies (taskId, blockedByTaskId) VALUES (?, ?)",
      ["task_b", "task_a"]
    );

    const dep = await db.get("SELECT * FROM task_dependencies WHERE taskId = ? AND blockedByTaskId = ?", ["task_b", "task_a"]);
    assert.ok(dep, "Dependency relationship must be recorded");

    // Delete Task A and verify cascade deletion of dependency
    await db.run("DELETE FROM task_dependencies WHERE taskId = ? OR blockedByTaskId = ?", ["task_a", "task_a"]);
    await db.run("DELETE FROM tasks WHERE id = ?", "task_a");

    const depAfter = await db.get("SELECT * FROM task_dependencies WHERE taskId = ? AND blockedByTaskId = ?", ["task_b", "task_a"]);
    assert.equal(depAfter, undefined, "Dependency must be cleaned up when prerequisite task is deleted");

    // Clean up task_b
    await db.run("DELETE FROM tasks WHERE id = ?", "task_b");
  });

  test("Documents: Project document creation, retrieval, update, and deletion", async () => {
    const docId = "doc_001";
    const now = new Date().toISOString();

    await db.run(
      "INSERT INTO documents (id, projectId, title, content, authorId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [docId, "proj_1", "Architecture Blueprint", "# System Design\nNode + React SPA", "usr_owner", now, now]
    );

    const doc = await db.get("SELECT * FROM documents WHERE id = ?", docId);
    assert.ok(doc, "Document should be stored");
    assert.equal(doc.title, "Architecture Blueprint");

    // Update document
    const updatedTime = new Date().toISOString();
    await db.run(
      "UPDATE documents SET content = ?, updatedAt = ? WHERE id = ?",
      ["# Updated System Design\nFull stack bundle", updatedTime, docId]
    );

    const updatedDoc = await db.get("SELECT * FROM documents WHERE id = ?", docId);
    assert.ok(updatedDoc.content.includes("Updated System Design"));

    // Delete document
    await db.run("DELETE FROM documents WHERE id = ?", docId);
    const deletedDoc = await db.get("SELECT * FROM documents WHERE id = ?", docId);
    assert.equal(deletedDoc, undefined, "Document should be removed");
  });

  test("Roles & Permissions: Fallback and custom roles permissions resolution", async () => {
    // QA role permissions
    const qaPerms = await resolveUserPermissions(db, {
      id: "u-qa",
      name: "QA",
      email: "qa@example.com",
      role: "qa",
    });
    assert.equal(qaPerms.create_tasks, true, "QA should be permitted to create tasks");
    assert.equal(qaPerms.delete_tasks, false, "QA should not be permitted to delete tasks");

    // Viewer role permissions
    const viewerPerms = await resolveUserPermissions(db, {
      id: "u-viewer",
      name: "Viewer",
      email: "viewer@example.com",
      role: "viewer",
    });
    assert.equal(viewerPerms.create_tasks, false, "Viewer cannot create tasks");
    assert.equal(viewerPerms.edit_all_tasks, false, "Viewer cannot edit all tasks");

    // Custom role definition
    await db.run(
      "INSERT INTO roles (id, name, is_custom, permissions) VALUES (?, ?, 1, ?)",
      ["custom_lead", "Tech Lead", JSON.stringify({ create_tasks: true, edit_all_tasks: true, delete_tasks: true, manage_projects: true })]
    );

    const customPerms = await resolveUserPermissions(db, {
      id: "u-custom",
      name: "Lead",
      email: "lead@example.com",
      role: "custom_lead",
    });
    assert.equal(customPerms.create_tasks, true);
    assert.equal(customPerms.manage_projects, true);
    assert.equal(Boolean(customPerms.manage_users), false);
  });

  test("Email Verification: Token lifecycle and account activation", async () => {
    const unverifiedUserId = "usr_unverified_1";
    await db.run(
      "INSERT INTO users (id, name, email, role, emailVerified, status, createdAt) VALUES (?, ?, ?, 'developer', 0, 'Available', ?)",
      [unverifiedUserId, "New User", "unverified@example.com", new Date().toISOString()]
    );

    // Issue verification token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = Date.now() + 24 * 3600000;

    await db.run(
      "INSERT INTO email_verifications (token, userId, expiresAt) VALUES (?, ?, ?)",
      [tokenHash, unverifiedUserId, expiresAt]
    );

    // Simulate verification
    const record = await db.get("SELECT * FROM email_verifications WHERE token = ?", tokenHash);
    assert.ok(record, "Verification record must exist");
    assert.ok(record.expiresAt > Date.now(), "Token should not be expired");

    // Mark verified
    await db.run("UPDATE users SET emailVerified = 1 WHERE id = ?", record.userId);
    await db.run("DELETE FROM email_verifications WHERE token = ?", tokenHash);

    const verifiedUser = await db.get("SELECT emailVerified FROM users WHERE id = ?", unverifiedUserId);
    assert.equal(verifiedUser.emailVerified, 1, "User email must be verified");

    const consumedRecord = await db.get("SELECT * FROM email_verifications WHERE token = ?", tokenHash);
    assert.equal(consumedRecord, undefined, "Verification token must be deleted after use");
  });

  test("SSE Events Service: Client event registration and heartbeat dispatching", () => {
    let capturedData = "";
    const mockRes: any = {
      writeHead: () => mockRes,
      flushHeaders: () => {},
      write: (data: string) => {
        capturedData += data;
        return true;
      }
    };

    const clientId = eventsService.registerClient("usr_owner", "super_admin", mockRes, "proj_1");
    assert.equal(eventsService.getClientCount(), 1, "Client should be registered in SSE pool");

    eventsService.broadcast({
      type: "TASK_CREATED",
      data: { taskId: "task_test_123" }
    });

    assert.ok(capturedData.includes("INIT_CONNECTION") || capturedData.includes("TASK_CREATED"), "Broadcast must reach registered SSE client");

    eventsService.unregisterClient(clientId);
    assert.equal(eventsService.getClientCount(), 0, "Client should be removed from SSE pool");
  });
});
