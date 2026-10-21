import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { asyncHandler } from "../middleware/asyncHandler.ts";
import { R } from "../runtime.ts";
import { canContributeToProject, canManageProject, checkProjectAccess, isAdminOrSuperAdmin } from "../rbac.ts";
import { buildPageInfo, parsePageParams, sendPaginated } from "../pagination.ts";

function auth(req: any, res: any, next: any) {
  return R().authenticateToken(req, res, next);
}

export function milestonesRouter(): Router {
  const router = Router();

  router.get(
    "/milestones",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      const { page, pageSize, offset } = parsePageParams(req.query, R().config.pagination);
      let milestones;
      let total = 0;
      if (isAdminOrSuperAdmin(req.user)) {
        const countRow = await db.get<{ count: number | string }>("SELECT COUNT(*) as count FROM milestones");
        total = Number(countRow?.count || 0);
        milestones = await db.all("SELECT * FROM milestones ORDER BY createdAt DESC LIMIT ? OFFSET ?", [pageSize, offset]);
      } else {
        const countRow = await db.get<{ count: number | string }>(
          `
      SELECT COUNT(DISTINCT m.id) as count
      FROM milestones m
      LEFT JOIN projects p ON m.projectId = p.id
      LEFT JOIN project_members pm ON p.id = pm.projectId
      LEFT JOIN team_projects tp ON p.id = tp.projectId
      LEFT JOIN team_members tm ON tp.teamId = tm.teamId
      WHERE p.ownerId = ? OR pm.userId = ? OR tm.userId = ?
    `,
          [req.user!.id, req.user!.id, req.user!.id]
        );
        total = Number(countRow?.count || 0);
        milestones = await db.all(
          `
      SELECT DISTINCT m.*
      FROM milestones m
      LEFT JOIN projects p ON m.projectId = p.id
      LEFT JOIN project_members pm ON p.id = pm.projectId
      LEFT JOIN team_projects tp ON p.id = tp.projectId
      LEFT JOIN team_members tm ON tp.teamId = tm.teamId
      WHERE p.ownerId = ? OR pm.userId = ? OR tm.userId = ?
      ORDER BY m.createdAt DESC
      LIMIT ? OFFSET ?
    `,
          [req.user!.id, req.user!.id, req.user!.id, pageSize, offset]
        );
      }
      sendPaginated(res, milestones, buildPageInfo(total, page, pageSize));
    })
  );

  router.get(
    "/projects/:projectId/milestones",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      if (!(await checkProjectAccess(db, req.params.projectId, req.user!))) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const milestones = await db.all(
        "SELECT * FROM milestones WHERE projectId = ? ORDER BY startDate ASC",
        req.params.projectId
      );
      res.json(milestones);
    })
  );

  router.post(
    "/projects/:projectId/milestones",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      if (!(await canContributeToProject(db, req.params.projectId, req.user!))) {
        res.status(403).json({ error: "Access denied. Project viewers and non-members cannot create milestones." });
        return;
      }
      const { name, description, startDate, endDate, status } = req.body as Record<string, unknown>;
      if (!name || typeof name !== "string" || name.trim() === "") {
        res.status(400).json({ error: "Milestone name is required." });
        return;
      }
      const id = uuidv4();
      const now = new Date().toISOString();
      await db.run(
        "INSERT INTO milestones (id, projectId, name, description, startDate, endDate, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id, req.params.projectId, name, description, startDate, endDate, status || "pending", now]
      );
      const milestone = await db.get("SELECT * FROM milestones WHERE id = ?", id);
      res.json(milestone);
    })
  );

  router.put(
    "/milestones/:id",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      const msCheck = await db.get<{ projectId: string }>("SELECT projectId FROM milestones WHERE id = ?", req.params.id);
      if (!msCheck) {
        res.sendStatus(404);
        return;
      }
      if (!(await canContributeToProject(db, msCheck.projectId, req.user!))) {
        res.status(403).json({ error: "Access denied. Project viewers cannot edit milestones." });
        return;
      }
      const { name, description, startDate, endDate, status } = req.body as Record<string, unknown>;
      await db.run(
        "UPDATE milestones SET name = COALESCE(?, name), description = COALESCE(?, description), startDate = COALESCE(?, startDate), endDate = COALESCE(?, endDate), status = COALESCE(?, status) WHERE id = ?",
        [name, description, startDate, endDate, status, req.params.id]
      );
      const milestone = await db.get("SELECT * FROM milestones WHERE id = ?", req.params.id);
      res.json(milestone);
    })
  );

  router.delete(
    "/milestones/:id",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      const msCheck = await db.get<{ projectId: string }>("SELECT projectId FROM milestones WHERE id = ?", req.params.id);
      if (!msCheck) {
        res.sendStatus(404);
        return;
      }
      if (!(await canManageProject(db, msCheck.projectId, req.user!))) {
        res.status(403).json({ error: "Only project admins or owners can delete milestones." });
        return;
      }
      await db.run("DELETE FROM milestones WHERE id = ?", req.params.id);
      res.json({ success: true });
    })
  );

  return router;
}
