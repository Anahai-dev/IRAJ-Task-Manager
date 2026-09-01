# 🚀 Getting Started & Authentication

This guide covers accounts, OAuth, roles, and navigation for IRAJ Task Manager.

---

## 1. Account Registration & Login

1. Open `/login`. Create the **first** account at `/register` — that user becomes `super_admin` and is signed in immediately.
2. After bootstrap, **public registration is off by default** (`ALLOW_PUBLIC_REGISTER=false`). Later local accounts are created by an administrator on **Admin → Users**, or you can set `ALLOW_PUBLIC_REGISTER=true`.
3. Non-first self-registered users start as `developer` with `emailVerified=0` until they complete forgot-password (when SMTP is configured) or an admin creates them already verified.

---

## 2. Social & OAuth Integrations

Google, GitHub, and GitLab buttons work when the corresponding `*_CLIENT_ID` / `*_CLIENT_SECRET` vars are set.

**OAuth does not auto-join new users.** Existing accounts with a matching email and `authProvider` can log in. New OAuth identities are rejected unless `OAUTH_AUTO_PROVISION=true` (optionally limited by `OAUTH_ALLOWED_DOMAINS`). Admins can provision an OAuth user by creating the account with `authProvider` set to `google`, `github`, or `gitlab`.

---

## 3. Role-Based Access Control (RBAC)

Seeded roles include `super_admin`, `admin`, `manager`, `developer`, `designer`, `qa`, `product_owner`, `scrum_master`, and `viewer`, plus custom roles. Permissions are JSON flags (`create_tasks`, `manage_users`, …).

`GET /api/auth/me` returns the resolved `permissions` map. The UI uses those flags (not hardcoded role names) for admin nav and “New Task”.

**Project access is not implied by a single task assignment.** Viewing wiki, members, milestones, and git branch lists requires project or team membership. Document create/edit requires a non-`viewer` project role; delete is author or project admin.

---

## 4. UI Layout & Navigation

Sidebar: Dashboard, Projects, Board, Planning, Graph, Calendar, Documents, Teams, Git, and **Admin** (`/admin/users`) when `manage_users` or `manage_roles` is granted.
