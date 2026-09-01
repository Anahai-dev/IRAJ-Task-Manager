# DevTeam Task Manager

A full-stack task management, roadmap planning, and progress tracking application built for software development teams. Features Git branch generation, Kanban board workflows, D3.js timeline charts, task dependency graphing, product documentation wiki, and flexible database backup tools.

---

## 📖 Comprehensive Documentation

Full operational guides and feature documentation are available in the [`/docs`](./docs/README.md) folder:

- **[🚀 Getting Started & Auth](./docs/01-getting-started.md)**: Accounts, OAuth (Google, GitHub, GitLab), RBAC roles, sidebar navigation.
- **[📋 Project & Board Management](./docs/02-project-and-board-management.md)**: Projects, Kanban workflow, Task modal, subtasks, global search (`Cmd/Ctrl+K`).
- **[🗺️ Planning, Timeline & Task Graph](./docs/03-planning-and-visualizations.md)**: Milestones, sprints, D3 Gantt timeline chart, Dagre/React Flow task graph.
- **[🌿 Git & Branch Management](./docs/04-git-and-branch-management.md)**: Linking GitHub/GitLab, remote branch creation, PR/MR links, terminal checkout commands.
- **[📝 Product Documentation & PRDs](./docs/05-documents-and-wiki.md)**: Markdown editor, live side-by-side preview, wiki categories.
- **[📅 Calendar & Workload Analytics](./docs/06-calendar-and-workload.md)**: Calendar view, member capacity tracking, workload balancing.
- **[👥 Team & User Administration](./docs/07-team-and-user-administration.md)**: Team domains, admin user management, grabbable profile settings carousel.
- **[💾 Database Operations & Backups](./docs/08-database-and-backups.md)**: SQLite vs PostgreSQL, in-app backup UI, terminal CLI utility (`db-cli.ts`), Docker deployment.

---

## Key Features

- **Dynamic Kanban Board**: Drag-and-drop task status transitions across Backlog, To Do, In Progress, In Review, and Done.
- **Git Branch Automation**: Connect GitHub or GitLab repositories to create remote feature/fix branches directly from task cards with automated naming conventions, terminal checkout helpers, detailed API error diagnostics, and secure role-based authorization (restricting repository configurations to Admins, Managers, and Project Owners).
- **Interactive Dependency Task Graph**: Visualize upstream blockers and sub-task node trees using `@xyflow/react` and Dagre.
- **D3.js Timeline Chart**: Interactive Gantt chart view for sprint roadmap tracking and date ranges.
- **Documentation Hub**: Write and preview PRDs, architecture guides, and meeting notes with full Markdown syntax highlighting.
- **Grabbable Profile Carousel**: Smooth swipeable/grabbable settings carousel for user profiles, skills, and admin tools without scrollbar noise.
- **Multi-Engine Database Support**: Seamless zero-config SQLite for development/VPS hosting, with optional PostgreSQL support and full JSON/SQLite backup & restore CLI utilities.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide React, Motion
- **Data Visualizations**: `@xyflow/react`, Dagre, Recharts, D3.js
- **Backend Application**: Node.js + Express.js API (bundle output via `esbuild`)
- **Database Architecture**: SQLite (`sqlite3`) when `DATABASE_URL` is unset; PostgreSQL (`pg`) when it is set (fail-fast, no silent fallback)

---

## Quick Start Guide

### 1. Installation
```bash
npm install
```

### 2. Environment Setup
Copy `.env.example` to `.env`. In production you **must** set `SECRET_KEY`, `TOKEN_ENCRYPTION_KEY` (distinct from `SECRET_KEY`), and `APP_URL`.

```env
SECRET_KEY="generate-a-long-random-string"
TOKEN_ENCRYPTION_KEY="a-different-long-random-string"
APP_URL="http://localhost:3000"
# Optional Postgres. If set, the process fails when Postgres is down (no SQLite fallback).
# DATABASE_URL="postgres://user:password@localhost:5432/dbname"
ALLOW_PUBLIC_REGISTER="false"
OAUTH_AUTO_PROVISION="false"
```

### 3. Start Development Server
```bash
npm run dev
```

### 4. Tests
```bash
npm test
```

### 5. Build & Run Production
```bash
npm run build
npm start
```

---

## Database CLI Quick Reference

Manage database snapshots and JSON data portability via terminal:

```bash
# View database stats and table row counts
npm run db-cli stats

# Backup database to ./backups/
npm run db-cli backup

# Export all database records to portable JSON
npm run db-cli export-json ./backups/export.json

# Restore database from JSON backup file
npm run db-cli import-json ./backups/export.json
```

---

## License

This project is licensed under the MIT License.
