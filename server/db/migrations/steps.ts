import type { DatabaseWrapper } from "../../types.ts";
import { addColumnIfMissing } from "./columns.ts";

export const SCHEMA_VERSION = 3;

export interface MigrationStep {
  version: number;
  name: string;
  up: (db: DatabaseWrapper) => Promise<void>;
}

const DEFAULT_ROLES: Array<{
  id: string;
  name: string;
  description: string;
  is_custom: number;
  permissions: string;
}> = [
  {
    id: "super_admin",
    name: "Super Admin",
    description: "Full uninhibited system control",
    is_custom: 0,
    permissions:
      '{"create_tasks":true,"edit_all_tasks":true,"delete_tasks":true,"manage_projects":true,"manage_teams":true,"manage_users":true,"manage_roles":true,"reset_database":true}',
  },
  {
    id: "admin",
    name: "Admin",
    description: "Standard administrator managed by Super Admin",
    is_custom: 0,
    permissions:
      '{"create_tasks":true,"edit_all_tasks":true,"delete_tasks":true,"manage_projects":true,"manage_teams":true,"manage_users":true,"manage_roles":false,"reset_database":false}',
  },
  {
    id: "manager",
    name: "Manager",
    description: "Can manage projects, teams, and tasks",
    is_custom: 0,
    permissions:
      '{"create_tasks":true,"edit_all_tasks":true,"delete_tasks":true,"manage_projects":true,"manage_teams":true,"manage_users":false,"manage_roles":false}',
  },
  {
    id: "developer",
    name: "Developer",
    description: "Core developer role to build and claim tasks",
    is_custom: 0,
    permissions:
      '{"create_tasks":false,"edit_all_tasks":false,"delete_tasks":false,"manage_projects":false,"manage_teams":false,"manage_users":false,"manage_roles":false}',
  },
  {
    id: "designer",
    name: "Designer",
    description: "Can design user interfaces and experiences",
    is_custom: 0,
    permissions:
      '{"create_tasks":false,"edit_all_tasks":false,"delete_tasks":false,"manage_projects":false,"manage_teams":false,"manage_users":false,"manage_roles":false}',
  },
  {
    id: "qa",
    name: "QA Engineer",
    description: "Can test and verify task completions",
    is_custom: 0,
    permissions:
      '{"create_tasks":true,"edit_all_tasks":true,"delete_tasks":false,"manage_projects":false,"manage_teams":false,"manage_users":false,"manage_roles":false}',
  },
  {
    id: "product_owner",
    name: "Product Owner",
    description: "Can manage roadmap and verify milestones",
    is_custom: 0,
    permissions:
      '{"create_tasks":true,"edit_all_tasks":true,"delete_tasks":true,"manage_projects":true,"manage_teams":false,"manage_users":false,"manage_roles":false}',
  },
  {
    id: "scrum_master",
    name: "Scrum Master",
    description: "Facilitates agile processes and unblocks team",
    is_custom: 0,
    permissions:
      '{"create_tasks":true,"edit_all_tasks":true,"delete_tasks":false,"manage_projects":false,"manage_teams":true,"manage_users":false,"manage_roles":false}',
  },
  {
    id: "viewer",
    name: "Viewer",
    description: "Read-only access to view projects and boards",
    is_custom: 0,
    permissions:
      '{"create_tasks":false,"edit_all_tasks":false,"delete_tasks":false,"manage_projects":false,"manage_teams":false,"manage_users":false,"manage_roles":false}',
  },
];

export const MIGRATION_STEPS: MigrationStep[] = [
  {
    version: 1,
    name: "baseline_tables",
    async up(db) {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          passwordHash TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT DEFAULT 'Available',
          skills TEXT DEFAULT '[]',
          rolePrefix TEXT,
          tokenVersion INTEGER DEFAULT 1,
          authProvider TEXT DEFAULT 'local',
          emailVerified INTEGER DEFAULT 0,
          createdAt TEXT
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          priority TEXT NOT NULL,
          deadline TEXT NOT NULL,
          assigneeId TEXT,
          creatorId TEXT NOT NULL,
          branchName TEXT,
          parentId TEXT,
          projectId TEXT,
          milestoneId TEXT,
          createdAt TEXT NOT NULL,
          orderIndex REAL DEFAULT 0,
          prUrl TEXT,
          prStatus TEXT
        );

        CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          ownerId TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          projectId TEXT
        );

        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          ownerId TEXT NOT NULL,
          projectKey TEXT,
          taskCounter INTEGER DEFAULT 0,
          createdAt TEXT NOT NULL,
          repoProvider TEXT,
          repoOwner TEXT,
          repoName TEXT,
          repoUrl TEXT,
          repoToken TEXT,
          defaultBranch TEXT DEFAULT 'main'
        );

        CREATE TABLE IF NOT EXISTS project_members (
          projectId TEXT NOT NULL,
          userId TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          joinedAt TEXT NOT NULL,
          PRIMARY KEY (projectId, userId)
        );

        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT,
          authorId TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS milestones (
          id TEXT PRIMARY KEY,
          projectId TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          startDate TEXT,
          endDate TEXT,
          status TEXT NOT NULL,
          createdAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS team_members (
          id TEXT PRIMARY KEY,
          teamId TEXT NOT NULL,
          userId TEXT NOT NULL,
          joinedAt TEXT NOT NULL,
          UNIQUE(teamId, userId)
        );

        CREATE TABLE IF NOT EXISTS team_projects (
          teamId TEXT NOT NULL,
          projectId TEXT NOT NULL,
          PRIMARY KEY (teamId, projectId)
        );

        CREATE TABLE IF NOT EXISTS task_dependencies (
          taskId TEXT NOT NULL,
          blockedByTaskId TEXT NOT NULL,
          PRIMARY KEY (taskId, blockedByTaskId)
        );

        CREATE TABLE IF NOT EXISTS task_comments (
          id TEXT PRIMARY KEY,
          taskId TEXT NOT NULL,
          userId TEXT NOT NULL,
          content TEXT NOT NULL,
          createdAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS password_resets (
          token TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          expiresAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS oauth_nonces (
          nonce TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS task_activities (
          id TEXT PRIMARY KEY,
          taskId TEXT NOT NULL,
          userId TEXT NOT NULL,
          action TEXT NOT NULL,
          createdAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_columns (
          id TEXT PRIMARY KEY,
          projectId TEXT UNIQUE NOT NULL,
          columnsJson TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );

        CREATE TABLE IF NOT EXISTS roles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          is_custom INTEGER DEFAULT 0,
          permissions TEXT
        );
      `);
    },
  },
  {
    version: 2,
    name: "legacy_column_upgrades",
    async up(db) {
      // Idempotent upgrades for databases created before the baseline included all columns.
      await addColumnIfMissing(db, "tasks", "milestoneId", "TEXT");
      await addColumnIfMissing(db, "tasks", "orderIndex", "REAL DEFAULT 0");
      await addColumnIfMissing(db, "tasks", "projectId", "TEXT");
      await addColumnIfMissing(db, "tasks", "prUrl", "TEXT");
      await addColumnIfMissing(db, "tasks", "prStatus", "TEXT");
      await addColumnIfMissing(db, "projects", "projectKey", "TEXT");
      await addColumnIfMissing(db, "projects", "taskCounter", "INTEGER DEFAULT 0");
      await addColumnIfMissing(db, "projects", "repoProvider", "TEXT");
      await addColumnIfMissing(db, "projects", "repoOwner", "TEXT");
      await addColumnIfMissing(db, "projects", "repoName", "TEXT");
      await addColumnIfMissing(db, "projects", "repoUrl", "TEXT");
      await addColumnIfMissing(db, "projects", "repoToken", "TEXT");
      await addColumnIfMissing(db, "projects", "defaultBranch", "TEXT DEFAULT 'main'");
      await addColumnIfMissing(db, "teams", "projectId", "TEXT");
      await addColumnIfMissing(db, "users", "skills", "TEXT DEFAULT '[]'");
      await addColumnIfMissing(db, "users", "rolePrefix", "TEXT");
      await addColumnIfMissing(db, "users", "status", "TEXT DEFAULT 'Available'");
      await addColumnIfMissing(db, "users", "tokenVersion", "INTEGER DEFAULT 1");
      await addColumnIfMissing(db, "users", "authProvider", "TEXT DEFAULT 'local'");
      await addColumnIfMissing(db, "users", "emailVerified", "INTEGER DEFAULT 0");
      await addColumnIfMissing(db, "users", "createdAt", "TEXT");
      await addColumnIfMissing(db, "roles", "permissions", "TEXT");

      await db.exec("UPDATE users SET tokenVersion = 1 WHERE tokenVersion IS NULL;");
      await db.exec("UPDATE users SET authProvider = 'local' WHERE authProvider IS NULL;");
      await db.exec("UPDATE users SET emailVerified = 1 WHERE emailVerified IS NULL;");
    },
  },
  {
    version: 3,
    name: "indexes_seeds_and_backfills",
    async up(db) {
      const projectsWithoutKey = await db.all<{ id: string }>(
        "SELECT id FROM projects WHERE projectKey IS NULL OR projectKey = ''"
      );
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      for (const p of projectsWithoutKey) {
        const randomLetters = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
        await db.run("UPDATE projects SET projectKey = ? WHERE id = ?", [randomLetters, p.id]);
      }

      if (db.isPg) {
        await db.run(
          "INSERT INTO settings (key, value) VALUES ('manager_prefix', 'Engineering') ON CONFLICT (key) DO NOTHING"
        );
        await db.run(
          "INSERT INTO settings (key, value) VALUES ('developer_prefix', 'Lead') ON CONFLICT (key) DO NOTHING"
        );
      } else {
        await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('manager_prefix', 'Engineering')");
        await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('developer_prefix', 'Lead')");
      }

      for (const role of DEFAULT_ROLES) {
        if (db.isPg) {
          await db.run(
            "INSERT INTO roles (id, name, description, is_custom, permissions) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
            [role.id, role.name, role.description, role.is_custom, role.permissions]
          );
        } else {
          await db.run(
            "INSERT OR IGNORE INTO roles (id, name, description, is_custom, permissions) VALUES (?, ?, ?, ?, ?)",
            [role.id, role.name, role.description, role.is_custom, role.permissions]
          );
        }
        await db.run("UPDATE roles SET permissions = ? WHERE id = ? AND (permissions IS NULL OR permissions = '')", [
          role.permissions,
          role.id,
        ]);
      }

      const existingProjects = await db.all<{ id: string; ownerId: string; createdAt: string }>(
        "SELECT id, ownerId, createdAt FROM projects"
      );
      for (const p of existingProjects) {
        if (db.isPg) {
          await db.run(
            "INSERT INTO project_members (projectId, userId, role, joinedAt) VALUES (?, ?, 'admin', ?) ON CONFLICT (projectId, userId) DO NOTHING",
            [p.id, p.ownerId, p.createdAt]
          );
        } else {
          await db.run("INSERT OR IGNORE INTO project_members (projectId, userId, role, joinedAt) VALUES (?, ?, 'admin', ?)", [
            p.id,
            p.ownerId,
            p.createdAt,
          ]);
        }
      }

      await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_projectId ON tasks(projectId);
        CREATE INDEX IF NOT EXISTS idx_tasks_assigneeId ON tasks(assigneeId);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_task_activities_taskId ON task_activities(taskId);
        CREATE INDEX IF NOT EXISTS idx_task_comments_taskId ON task_comments(taskId);
        CREATE INDEX IF NOT EXISTS idx_project_members_userId ON project_members(userId);
        CREATE INDEX IF NOT EXISTS idx_team_members_userId ON team_members(userId);
        CREATE INDEX IF NOT EXISTS idx_task_dependencies_blocked ON task_dependencies(blockedByTaskId);
        CREATE INDEX IF NOT EXISTS idx_documents_projectId ON documents(projectId);
        CREATE INDEX IF NOT EXISTS idx_milestones_projectId ON milestones(projectId);
      `);
    },
  },
];
