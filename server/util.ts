import { v4 as uuidv4 } from "uuid";
import type { DatabaseWrapper } from "./types.ts";

export function extractTaskNumber(branchName: string | null | undefined): number | null {
  if (!branchName || typeof branchName !== "string") return null;
  const match = branchName.match(/(\d+)(?!.*\d)/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!Number.isNaN(num)) return num;
  }
  return null;
}

export async function logActivity(db: DatabaseWrapper, taskId: string, userId: string, action: string): Promise<void> {
  const activityId = uuidv4();
  await db.run("INSERT INTO task_activities (id, taskId, userId, action, createdAt) VALUES (?, ?, ?, ?, ?)", [
    activityId,
    taskId,
    userId,
    action,
    new Date().toISOString(),
  ]);
}

export async function nextTaskCounter(db: DatabaseWrapper, projectId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.run("UPDATE projects SET taskCounter = COALESCE(taskCounter, 0) + 1 WHERE id = ?", [projectId]);
    const row = await tx.get<{ taskCounter: number }>("SELECT taskCounter FROM projects WHERE id = ?", [projectId]);
    if (!row || row.taskCounter === undefined || row.taskCounter === null) {
      throw new Error("Failed to allocate task counter");
    }
    return Number(row.taskCounter);
  });
}

export function sanitizeProject<T extends { repoToken?: string | null }>(project: T | null | undefined): T | null | undefined {
  if (!project) return project;
  const sanitized = { ...project };
  if (sanitized.repoToken && sanitized.repoToken.trim() !== "") {
    sanitized.repoToken = "••••••••";
  } else {
    sanitized.repoToken = "";
  }
  return sanitized;
}

const SENTINEL_RE = /^(•+|✕+|x+|X+|\*+|REDACTED|\[REDACTED\]|<redacted>)$/i;

export function isRedactedSecret(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes("UnusablePlaceholder")) return true;
  if (trimmed === "••••••••") return true;
  return SENTINEL_RE.test(trimmed);
}

export const BACKUP_TABLE_COLUMNS: Record<string, string[]> = {
  users: [
    "id",
    "name",
    "email",
    "passwordHash",
    "role",
    "skills",
    "rolePrefix",
    "status",
    "tokenVersion",
    "authProvider",
    "emailVerified",
    "createdAt",
  ],
  tasks: [
    "id",
    "title",
    "description",
    "status",
    "priority",
    "deadline",
    "assigneeId",
    "creatorId",
    "branchName",
    "parentId",
    "projectId",
    "milestoneId",
    "createdAt",
    "orderIndex",
    "prUrl",
    "prStatus",
  ],
  teams: ["id", "name", "description", "ownerId", "createdAt", "projectId"],
  projects: [
    "id",
    "name",
    "description",
    "ownerId",
    "projectKey",
    "taskCounter",
    "createdAt",
    "repoProvider",
    "repoOwner",
    "repoName",
    "repoUrl",
    "repoToken",
    "defaultBranch",
  ],
  project_members: ["projectId", "userId", "role", "joinedAt"],
  documents: ["id", "projectId", "title", "content", "authorId", "createdAt", "updatedAt"],
  milestones: ["id", "projectId", "name", "description", "startDate", "endDate", "status", "createdAt"],
  team_members: ["id", "teamId", "userId", "joinedAt"],
  team_projects: ["teamId", "projectId"],
  task_dependencies: ["taskId", "blockedByTaskId"],
  task_comments: ["id", "taskId", "userId", "content", "createdAt"],
  task_activities: ["id", "taskId", "userId", "action", "createdAt"],
  settings: ["key", "value"],
  roles: ["id", "name", "description", "is_custom", "permissions"],
  project_columns: ["id", "projectId", "columnsJson", "updatedAt"],
};

export function assertBackupSecretsRestoreable(backupData: Record<string, unknown>): void {
  const meta = backupData as { secretsIncluded?: boolean; format?: string };
  if (meta.secretsIncluded === false) {
    throw new Error(
      "This backup was exported without secrets (password hashes and Git PATs redacted). Restore refused. Use a CLI export that includes live secrets, or restore from a snapshot that was not redacted."
    );
  }

  const users = backupData.users;
  if (Array.isArray(users)) {
    for (const row of users) {
      if (row && typeof row === "object" && isRedactedSecret((row as { passwordHash?: unknown }).passwordHash)) {
        throw new Error("Backup contains redacted password hashes. Restore refused to avoid locking out users.");
      }
    }
  }
  const projects = backupData.projects;
  if (Array.isArray(projects)) {
    for (const row of projects) {
      if (row && typeof row === "object" && isRedactedSecret((row as { repoToken?: unknown }).repoToken)) {
        throw new Error("Backup contains redacted Git PATs. Restore refused to avoid destroying repository tokens.");
      }
    }
  }
}

export async function mapPrStatusToBoardColumn(
  db: DatabaseWrapper,
  projectId: string,
  currentStatus: string,
  remotePrStatus: string
): Promise<string> {
  let nextTaskStatus = currentStatus;
  const colRow = await db.get<{ columnsJson?: string }>("SELECT columnsJson FROM project_columns WHERE projectId = ?", projectId);
  let columnIds: string[] = [];
  if (colRow?.columnsJson) {
    try {
      const parsed = JSON.parse(colRow.columnsJson) as Array<{ id?: string; name?: string }>;
      if (Array.isArray(parsed)) {
        columnIds = parsed.map((c) => c.id || c.name).filter((id): id is string => Boolean(id));
      }
    } catch {
      columnIds = [];
    }
  }

  if (remotePrStatus === "merged" && currentStatus !== "done") {
    if (columnIds.length === 0 || columnIds.includes("done")) {
      nextTaskStatus = "done";
    } else {
      nextTaskStatus = columnIds[columnIds.length - 1];
    }
  } else if (remotePrStatus === "open" && (currentStatus === "todo" || currentStatus === "backlog")) {
    if (columnIds.length === 0 || columnIds.includes("review")) {
      nextTaskStatus = "review";
    } else {
      const reviewLike = columnIds.find((id) => /review/i.test(id));
      if (reviewLike) nextTaskStatus = reviewLike;
    }
  }
  return nextTaskStatus;
}
