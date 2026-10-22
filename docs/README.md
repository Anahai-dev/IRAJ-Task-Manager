# DevTeam Task Manager Documentation

Welcome to the official documentation for **DevTeam Task Manager**. This guide provides complete operational instructions for developers, project managers, and system administrators.

---

## 📚 Documentation Table of Contents

1. [🚀 Getting Started & Authentication](01-getting-started.md)
   - Account Registration & Login
   - Multi-Provider OAuth Setup (Google, GitHub, GitLab)
   - Role-Based Access Control (Admin, Manager, Member)
   - UI Layout, Sidebar Navigation & Theme Options

2. [📋 Project & Board Management](02-project-and-board-management.md)
   - Creating and Configuring Projects
   - Working with the Kanban Board (Columns, Drag & Drop)
   - Task Modal (Subtasks, Blockers, Priority, Assignees, Custom Labels)
   - Global Search & Filtering Tasks

3. [🗺️ Planning, Timeline & Task Graph](03-planning-and-visualizations.md)
   - Sprint & Roadmap Planning Mode
   - Timeline D3 Chart View
   - Interactive Dependency Task Graph (Blockers, Parents, Sub-tasks)

4. [🌿 Git & Branch Management](04-git-and-branch-management.md)
   - Linking Projects to GitHub & GitLab Repositories
   - PAT (Personal Access Token) Configuration
   - Creating Feature/Fix Remote Branches from Tasks
   - Pull Request & Merge Request Automation
   - Quick Terminal Checkout Commands

5. [📝 Product Documentation & PRDs](05-documents-and-wiki.md)
   - Creating & Editing PRDs, Notes, Architecture Guides
   - Markdown Editor & Live Preview
   - Document Categorization & Search

6. [📅 Calendar & Workload Analytics](06-calendar-and-workload.md)
   - Calendar View for Task Deadlines & Milestones
   - Team Workload Distribution & Capacity Tracking

7. [👥 Team & User Administration](07-team-and-user-administration.md)
   - Managing Teams & Domain-based Visibility
   - User Admin Panel (Role Assignment, Account Deactivation)
   - User Profile & Settings Carousel (General, Activity, Security, Skills, Integrations)

8. [💾 Database Operations & Backups](08-database-and-backups.md)
   - SQLite & PostgreSQL Backend Modes
   - In-App Backup & Restore UI
   - Command Line Interface (`db-cli.ts`) for Binary & JSON Exports
   - VPS & Docker Hosting Instructions

9. [🗺️ Codebase Problem Map](CODEBASE_PROBLEM_MAP.md) *(engineering)*
   - Evidence-based audit of architecture, security, data layer, tests, and production readiness
   - Severity-ranked issues (P0–P3) and recommended cleanup sequence for a later hardening pass
   - Not an end-user operations guide — use this before refactors, MCP work, or a “bulletproof” rewrite

---

## 💡 Quick Start Reference

- **Development Server**: `npm run dev` (Runs backend API & frontend SPA on port `3000`)
- **Production Build**: `npm run build && npm start`
- **CLI Database Tools**: `npm run db-cli stats`
