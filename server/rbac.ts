/**
 * Access model
 * ------------
 * Global roles (users.role) resolve to a permission JSON map (see /api/auth/me).
 *
 * Project access is independent of being assigned a single task:
 *   view    — owner, project_members (any role including viewer), or team_projects membership
 *   contribute — view AND project role is not `viewer` (team-only members count as members)
 *   manage  — owner, project_members.role in {admin, lead}, or global admin/super_admin
 *
 * Task access:
 *   assignee/creator of a task OR project.view
 *   Task assignment does NOT grant wiki, members, columns, git-read, or milestones.
 */
import { R } from "./runtime.ts";
import type { AuthUser, DatabaseWrapper, PermissionKey, PermissionMap } from "./types.ts";
import { VALID_PERMISSION_KEYS as PERM_KEYS } from "./types.ts";

const EMPTY_PERMS: PermissionMap = {
  manage_users: false,
  manage_roles: false,
  manage_projects: false,
  manage_teams: false,
  reset_database: false,
  create_tasks: false,
  edit_all_tasks: false,
  delete_tasks: false,
};

export function isSuperAdmin(user: AuthUser | null | undefined): boolean {
  return user?.role === "super_admin";
}

export function isAdminOrSuperAdmin(user: AuthUser | null | undefined): boolean {
  return user?.role === "super_admin" || user?.role === "admin";
}

export function parsePermissionsJson(raw: string | null | undefined): PermissionMap {
  const perms: PermissionMap = { ...EMPTY_PERMS };
  if (!raw) return perms;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of PERM_KEYS) {
      if (parsed[key] === true) perms[key] = true;
    }
  } catch {
    return perms;
  }
  return perms;
}

export async function resolveUserPermissions(db: DatabaseWrapper, user: AuthUser): Promise<PermissionMap> {
  if (user.role === "super_admin") {
    return {
      manage_users: true,
      manage_roles: true,
      manage_projects: true,
      manage_teams: true,
      reset_database: true,
      create_tasks: true,
      edit_all_tasks: true,
      delete_tasks: true,
    };
  }
  const roleRow = await db.get<{ permissions?: string }>("SELECT permissions FROM roles WHERE id = ?", user.role);
  return parsePermissionsJson(roleRow?.permissions);
}

export async function hasPermission(user: AuthUser | null | undefined, permission: PermissionKey): Promise<boolean> {
  if (!user) return false;
  const db = await R().getDb();
  const perms = await resolveUserPermissions(db, user);
  return !!perms[permission];
}

export async function canManageUsers(user: AuthUser): Promise<boolean> {
  return hasPermission(user, "manage_users");
}

export async function canManageRoles(user: AuthUser): Promise<boolean> {
  return hasPermission(user, "manage_roles");
}

export type ProjectAccessLevel = "none" | "view" | "contribute" | "manage";

interface ProjectMembership {
  ownerId: string;
  memberRole: string | null;
  viaTeam: boolean;
}

async function loadProjectMembership(
  db: DatabaseWrapper,
  projectId: string,
  user: AuthUser
): Promise<ProjectMembership | null> {
  const project = await db.get<{ ownerId: string }>("SELECT ownerId FROM projects WHERE id = ?", projectId);
  if (!project) return null;
  const pm = await db.get<{ role: string }>(
    "SELECT role FROM project_members WHERE projectId = ? AND userId = ?",
    [projectId, user.id]
  );
  const tm = await db.get(
    "SELECT 1 FROM team_projects tp JOIN team_members tm ON tp.teamId = tm.teamId WHERE tp.projectId = ? AND tm.userId = ?",
    [projectId, user.id]
  );
  return {
    ownerId: project.ownerId,
    memberRole: pm?.role ?? null,
    viaTeam: !!tm,
  };
}

export function membershipToLevel(user: AuthUser, membership: ProjectMembership): ProjectAccessLevel {
  if (isAdminOrSuperAdmin(user)) return "manage";
  if (membership.ownerId === user.id) return "manage";
  if (membership.memberRole === "admin" || membership.memberRole === "lead") return "manage";
  if (membership.memberRole === "viewer") return "view";
  if (membership.memberRole) return "contribute";
  if (membership.viaTeam) return "contribute";
  return "none";
}

export async function getProjectAccessLevel(
  db: DatabaseWrapper,
  projectId: string,
  user: AuthUser
): Promise<ProjectAccessLevel> {
  if (isAdminOrSuperAdmin(user)) return "manage";
  const membership = await loadProjectMembership(db, projectId, user);
  if (!membership) return "none";
  return membershipToLevel(user, membership);
}

/** Project view: membership only. Task assignee/creator is NOT sufficient. */
export async function checkProjectAccess(db: DatabaseWrapper, projectId: string, user: AuthUser): Promise<boolean> {
  const level = await getProjectAccessLevel(db, projectId, user);
  return level !== "none";
}

export async function canContributeToProject(db: DatabaseWrapper, projectId: string, user: AuthUser): Promise<boolean> {
  const level = await getProjectAccessLevel(db, projectId, user);
  return level === "contribute" || level === "manage";
}

/** Stricter write gate aligned with upstream checkProjectWriteAccess (viewers denied). */
export async function checkProjectWriteAccess(
  db: DatabaseWrapper,
  projectId: string,
  user: AuthUser
): Promise<boolean> {
  return canContributeToProject(db, projectId, user);
}

export async function getAuthorizedProjectUserIds(
  db: DatabaseWrapper,
  projectId: string
): Promise<Set<string>> {
  const authorized = new Set<string>();
  const project = await db.get<{ ownerId: string }>("SELECT ownerId FROM projects WHERE id = ?", projectId);
  if (!project) return authorized;
  if (project.ownerId) authorized.add(project.ownerId);

  const members = await db.all<{ userId: string }>(
    `SELECT userId FROM project_members WHERE projectId = ?
     UNION
     SELECT tm.userId FROM team_members tm JOIN team_projects tp ON tm.teamId = tp.teamId WHERE tp.projectId = ?`,
    [projectId, projectId]
  );
  for (const m of members) {
    if (m.userId) authorized.add(m.userId);
  }
  return authorized;
}

export async function canManageProject(db: DatabaseWrapper, projectId: string, user: AuthUser): Promise<boolean> {
  const level = await getProjectAccessLevel(db, projectId, user);
  return level === "manage";
}

export async function isProjectAdminOrOwner(db: DatabaseWrapper, projectId: string, user: AuthUser): Promise<boolean> {
  return canManageProject(db, projectId, user);
}

export async function checkTaskAccess(
  db: DatabaseWrapper,
  taskId: string,
  user: AuthUser
): Promise<{ allowed: boolean; task: Record<string, unknown> | null }> {
  const task = await db.get<Record<string, unknown>>("SELECT * FROM tasks WHERE id = ?", taskId);
  if (!task) return { allowed: false, task: null };
  if (isAdminOrSuperAdmin(user)) return { allowed: true, task };
  if (task.creatorId === user.id || task.assigneeId === user.id) return { allowed: true, task };
  if (task.projectId) {
    const hasProjAccess = await checkProjectAccess(db, String(task.projectId), user);
    if (hasProjAccess) return { allowed: true, task };
  }
  return { allowed: false, task };
}

export function canAssignPrivilegedRole(actor: AuthUser, targetRole: string): boolean {
  if (actor.role === "super_admin") return true;
  if (targetRole === "super_admin" || targetRole === "admin") return false;
  return true;
}

export function sanitizeAndValidatePermissions(
  permissions: unknown,
  userRole: string
): { valid: boolean; perms: Record<string, boolean>; error?: string } {
  let inputPerms: Record<string, unknown> = {};
  if (permissions !== undefined && permissions !== null) {
    try {
      inputPerms =
        typeof permissions === "string"
          ? (JSON.parse(permissions) as Record<string, unknown>)
          : typeof permissions === "object"
            ? (permissions as Record<string, unknown>)
            : {};
    } catch {
      inputPerms = {};
    }
  }
  const parsedPerms: Record<string, boolean> = {};
  for (const key of PERM_KEYS) {
    if (inputPerms[key] === true) {
      if ((key === "manage_users" || key === "manage_roles" || key === "reset_database") && userRole !== "super_admin") {
        return { valid: false, perms: {}, error: "Only Super Admin can grant manage_users, manage_roles, or reset_database." };
      }
      parsedPerms[key] = true;
    }
  }
  return { valid: true, perms: parsedPerms };
}

export function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
