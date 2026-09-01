import type { User } from "../types";

export function hasFlag(user: User | null | undefined, flag: string): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  return user.permissions?.[flag] === true;
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
