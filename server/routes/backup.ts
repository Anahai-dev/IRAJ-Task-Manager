import { Router, type NextFunction, type Request, type Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.ts";
import { R } from "../runtime.ts";
import { isAdminOrSuperAdmin, isSuperAdmin } from "../rbac.ts";
import { assertBackupSecretsRestoreable, BACKUP_TABLE_COLUMNS } from "../util.ts";
import { pingDb } from "../db/index.ts";
import fs from "fs";

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user && isAdminOrSuperAdmin(req.user)) {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Admin privileges required." });
  }
}

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user && isSuperAdmin(req.user)) {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Super Admin privileges required." });
  }
}

export function backupRouter(): Router {
  const router = Router();
  const auth = (req: any, res: any, next: any) => R().authenticateToken(req, res, next);

  router.get(
    "/info",
    auth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      const isSqlite = db.engine === "sqlite";
      let sqliteSize = 0;
      const sqlitePath = (db as { sqlitePath?: string }).sqlitePath;
      // sqlite path is tracked on runtime via ping; size from config path
      const pathGuess = R().config.db.sqlitePath;
      if (isSqlite && fs.existsSync(pathGuess)) {
        sqliteSize = fs.statSync(pathGuess).size;
      }
      await pingDb(db);
      const userCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM users");
      const taskCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM tasks");
      const projectCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM projects");
      const teamCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM teams");
      const documentCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM documents");
      res.json({
        dbType: isSqlite ? "SQLite" : "PostgreSQL",
        sqliteSize,
        stats: {
          users: Number(userCount?.count || 0),
          tasks: Number(taskCount?.count || 0),
          projects: Number(projectCount?.count || 0),
          teams: Number(teamCount?.count || 0),
          documents: Number(documentCount?.count || 0),
        },
      });
      void sqlitePath;
      void req;
    })
  );

  router.post(
    "/export-json",
    auth,
    requireSuperAdmin,
    asyncHandler(async (_req, res) => {
      if (!R().config.backup.exportEnabled) {
        res.status(403).json({ error: "JSON backup export is disabled." });
        return;
      }
      const db = await R().getDb();
      const backupData: Record<string, unknown> = {
        format: "iraj-backup-v1",
        secretsIncluded: false,
        exportedAt: new Date().toISOString(),
      };
      for (const table of Object.keys(BACKUP_TABLE_COLUMNS)) {
        try {
          let rows = await db.all(`SELECT * FROM ${table}`);
          if (table === "projects") {
            rows = rows.map((p) => ({
              ...p,
              repoToken: p.repoToken ? "••••••••" : null,
            }));
          }
          if (table === "users") {
            rows = rows.map((u) => ({
              ...u,
              passwordHash: "••••••••",
            }));
          }
          backupData[table] = rows;
        } catch (e) {
          console.error(`Failed to export table ${table}:`, e);
          throw e;
        }
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=workspace-backup.json");
      res.json(backupData);
    })
  );

  router.post(
    "/restore-json",
    auth,
    requireSuperAdmin,
    asyncHandler(async (req, res) => {
      if (!R().config.backup.restoreEnabled) {
        res.status(403).json({ error: "JSON backup restore is disabled." });
        return;
      }
      const db = await R().getDb();
      const backupData = req.body as Record<string, unknown>;
      if (!backupData || typeof backupData !== "object") {
        res.status(400).json({ error: "Invalid backup data format." });
        return;
      }
      if (R().config.backup.requireConfirm && backupData.confirm !== true) {
        res.status(400).json({
          error: "Restore requires confirm: true. This operation wipes existing tables.",
        });
        return;
      }
      if (!backupData.users || !Array.isArray(backupData.users)) {
        res.status(400).json({ error: "Invalid backup: 'users' table data is missing." });
        return;
      }
      try {
        assertBackupSecretsRestoreable(backupData);
      } catch (e: unknown) {
        res.status(400).json({ error: (e as Error).message });
        return;
      }

      await db.transaction(async (tx) => {
        try {
          await tx.exec("DELETE FROM password_resets;");
        } catch (delPrErr: unknown) {
          const msg = String((delPrErr as Error).message || "").toLowerCase();
          if (!msg.includes("no such table") && !msg.includes("does not exist")) {
            throw delPrErr;
          }
        }

        for (const table of Object.keys(BACKUP_TABLE_COLUMNS)) {
          try {
            await tx.exec(`DELETE FROM ${table}`);
          } catch (delErr: unknown) {
            const msg = String((delErr as Error).message || "").toLowerCase();
            if (!msg.includes("no such table") && !msg.includes("does not exist")) {
              throw delErr;
            }
            console.warn(`Skipping missing table ${table} during restore`);
          }
        }

        for (const table of Object.keys(BACKUP_TABLE_COLUMNS)) {
          const rows = backupData[table];
          if (!Array.isArray(rows) || rows.length === 0) continue;
          const allowedCols = BACKUP_TABLE_COLUMNS[table];
          for (const row of rows) {
            if (!row || typeof row !== "object") continue;
            const presentCols = Object.keys(row as object).filter((c) => allowedCols.includes(c));
            if (presentCols.length === 0) continue;
            const placeholders = presentCols.map(() => "?").join(", ");
            const insertSql = `INSERT INTO ${table} (${presentCols.join(", ")}) VALUES (${placeholders})`;
            const params = presentCols.map((col) => (row as Record<string, unknown>)[col]);
            await tx.run(insertSql, params);
          }
        }
      });

      res.json({ success: true, message: "Workspace restored successfully from JSON backup!" });
    })
  );

  return router;
}
