import type { User } from "../types";

/**
 * Granular permission check with legacy role fallbacks (matches server RBAC migrations).
 */
export function can(user: User | null | undefined, permission: string): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;

  if (user.permissions && typeof user.permissions[permission] === "boolean") {
    return user.permissions[permission];
  }

  switch (permission) {
    case "manage_users":
    case "manage_roles":
    case "reset_database":
      return user.role === "super_admin";
    case "manage_teams":
    case "manage_projects":
    case "edit_all_tasks":
    case "delete_tasks":
      return user.role === "admin" || user.role === "manager";
    case "create_tasks":
      return user.role !== "viewer" && user.role !== "designer";
    default:
      return false;
  }
}

export function hasFlag(user: User | null | undefined, flag: string): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  if (user.permissions && typeof user.permissions[flag] === "boolean") {
    return user.permissions[flag];
  }
  return can(user, flag);
}

export function canCreateTasks(user: User | null | undefined): boolean {
  return hasFlag(user, "create_tasks");
}

export function canEditAllTasks(user: User | null | undefined): boolean {
  return hasFlag(user, "edit_all_tasks");
}

export function canDeleteTasks(user: User | null | undefined): boolean {
  return hasFlag(user, "delete_tasks");
}

export function canManageUsers(user: User | null | undefined): boolean {
  return hasFlag(user, "manage_users") || hasFlag(user, "manage_roles");
}

export function canResetDatabase(user: User | null | undefined): boolean {
  return hasFlag(user, "reset_database") || user?.role === "super_admin";
}
