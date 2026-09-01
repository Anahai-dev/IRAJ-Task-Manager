import type { DatabaseWrapper } from "../types.ts";

function isAlreadyExistsError(err: unknown): boolean {
  const message = String((err as { message?: string })?.message || "").toLowerCase();
  return (
    message.includes("duplicate column") ||
    message.includes("already exists") ||
    message.includes("duplicate key")
  );
}

async function addColumn(db: DatabaseWrapper, ddl: string): Promise<void> {
  try {
    await db.exec(ddl);
  } catch (err) {
    if (isAlreadyExistsError(err)) return;
    throw err;
  }
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

export async function migrateSchema(db: DatabaseWrapper): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'Available'
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
      orderIndex REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      ownerId TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      ownerId TEXT NOT NULL,
      projectKey TEXT,
      taskCounter INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL
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
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      startDate TEXT,
      endDate TEXT,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
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
  `);

  await addColumn(db, "ALTER TABLE tasks ADD COLUMN milestoneId TEXT;");
  await addColumn(db, "ALTER TABLE tasks ADD COLUMN orderIndex REAL DEFAULT 0;");
  await addColumn(db, "ALTER TABLE tasks ADD COLUMN projectId TEXT;");
  await addColumn(db, "ALTER TABLE projects ADD COLUMN projectKey TEXT;");
  await addColumn(db, "ALTER TABLE projects ADD COLUMN taskCounter INTEGER DEFAULT 0;");
  await addColumn(db, "ALTER TABLE teams ADD COLUMN projectId TEXT;");
  await addColumn(db, "ALTER TABLE users ADD COLUMN skills TEXT DEFAULT '[]';");
  await addColumn(db, "ALTER TABLE users ADD COLUMN rolePrefix TEXT;");
  await addColumn(db, "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'Available';");
  await addColumn(db, "ALTER TABLE users ADD COLUMN tokenVersion INTEGER DEFAULT 1;");
  await addColumn(db, "ALTER TABLE users ADD COLUMN authProvider TEXT DEFAULT 'local';");
  await addColumn(db, "ALTER TABLE users ADD COLUMN emailVerified INTEGER DEFAULT 0;");
  await addColumn(db, "ALTER TABLE users ADD COLUMN createdAt TEXT;");
  await addColumn(db, "ALTER TABLE projects ADD COLUMN repoProvider TEXT;");
  await addColumn(db, "ALTER TABLE projects ADD COLUMN repoOwner TEXT;");
  await addColumn(db, "ALTER TABLE projects ADD COLUMN repoName TEXT;");
  await addColumn(db, "ALTER TABLE projects ADD COLUMN repoUrl TEXT;");
  await addColumn(db, "ALTER TABLE projects ADD COLUMN repoToken TEXT;");
  await addColumn(db, "ALTER TABLE projects ADD COLUMN defaultBranch TEXT DEFAULT 'main';");
  await addColumn(db, "ALTER TABLE tasks ADD COLUMN prUrl TEXT;");
  await addColumn(db, "ALTER TABLE tasks ADD COLUMN prStatus TEXT;");

  await db.exec("UPDATE users SET tokenVersion = 1 WHERE tokenVersion IS NULL;");
  await db.exec("UPDATE users SET authProvider = 'local' WHERE authProvider IS NULL;");
  await db.exec("UPDATE users SET emailVerified = 1 WHERE emailVerified IS NULL;");

  const projectsWithoutKey = await db.all<{ id: string }>(
    "SELECT id FROM projects WHERE projectKey IS NULL OR projectKey = ''"
  );
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const p of projectsWithoutKey) {
    const randomLetters = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    await db.run("UPDATE projects SET projectKey = ? WHERE id = ?", [randomLetters, p.id]);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_columns (
      id TEXT PRIMARY KEY,
      projectId TEXT UNIQUE NOT NULL,
      columnsJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  if (db.isPg) {
    await db.run("INSERT INTO settings (key, value) VALUES ('manager_prefix', 'Engineering') ON CONFLICT (key) DO NOTHING");
    await db.run("INSERT INTO settings (key, value) VALUES ('developer_prefix', 'Lead') ON CONFLICT (key) DO NOTHING");
  } else {
    await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('manager_prefix', 'Engineering')");
    await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('developer_prefix', 'Lead')");
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_custom INTEGER DEFAULT 0,
      permissions TEXT
    );
  `);
  await addColumn(db, "ALTER TABLE roles ADD COLUMN permissions TEXT;");

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
}
