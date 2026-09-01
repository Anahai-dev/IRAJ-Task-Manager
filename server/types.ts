export interface DatabaseWrapper {
  readonly isPg: boolean;
  readonly engine: "sqlite" | "postgres";
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown | unknown[]): Promise<void>;
  get<T = any>(sql: string, params?: unknown | unknown[]): Promise<T | undefined>;
  all<T = any>(sql: string, params?: unknown | unknown[]): Promise<T[]>;
  transaction<T>(callback: (tx: DatabaseWrapper) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  rolePrefix?: string | null;
  status?: string | null;
  tokenVersion?: number;
  emailVerified?: number | boolean;
  skills?: string | null;
  authProvider?: string | null;
}

export interface JwtPayload {
  id: string;
  role: string;
  tokenVersion: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  projectKey: string | null;
  taskCounter: number | null;
  createdAt: string;
  repoProvider?: string | null;
  repoOwner?: string | null;
  repoName?: string | null;
  repoUrl?: string | null;
  repoToken?: string | null;
  defaultBranch?: string | null;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string;
  assigneeId: string | null;
  creatorId: string;
  branchName: string | null;
  parentId?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  createdAt: string;
  orderIndex?: number;
  prUrl?: string | null;
  prStatus?: string | null;
}

export const VALID_PERMISSION_KEYS = [
  "manage_users",
  "manage_roles",
  "manage_projects",
  "manage_teams",
  "reset_database",
  "create_tasks",
  "edit_all_tasks",
  "delete_tasks",
] as const;

export type PermissionKey = (typeof VALID_PERMISSION_KEYS)[number];
export type PermissionMap = Record<PermissionKey, boolean>;
