import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { asyncHandler } from "../middleware/asyncHandler.ts";
import { R } from "../runtime.ts";
import { canContributeToProject, canManageProject, checkProjectAccess, isAdminOrSuperAdmin } from "../rbac.ts";

function auth(req: any, res: any, next: any) {
  return R().authenticateToken(req, res, next);
}

export function documentsRouter(): Router {
  const router = Router();

  router.get(
    "/projects/:projectId/documents",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      if (!(await checkProjectAccess(db, req.params.projectId, req.user!))) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const docs = await db.all("SELECT * FROM documents WHERE projectId = ? ORDER BY updatedAt DESC", req.params.projectId);
      res.json(docs);
    })
  );

  router.post(
    "/projects/:projectId/documents",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      if (!(await canContributeToProject(db, req.params.projectId, req.user!))) {
        res.status(403).json({ error: "Access denied. Project viewers and non-members cannot create documents." });
        return;
      }
      const { title, content } = req.body as { title?: string; content?: string };
      if (!title || typeof title !== "string" || title.trim() === "") {
        res.status(400).json({ error: "Document title is required." });
        return;
      }
      const id = uuidv4();
      const now = new Date().toISOString();
      await db.run(
        "INSERT INTO documents (id, projectId, title, content, authorId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, req.params.projectId, title, content || "", req.user!.id, now, now]
      );
      const doc = await db.get("SELECT * FROM documents WHERE id = ?", id);
      res.json(doc);
    })
  );

  router.get(
    "/documents/:id",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      const doc = await db.get<{ projectId: string }>("SELECT * FROM documents WHERE id = ?", req.params.id);
      if (!doc) {
        res.sendStatus(404);
        return;
      }
      if (!(await checkProjectAccess(db, doc.projectId, req.user!))) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      res.json(doc);
    })
  );

  router.put(
    "/documents/:id",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      const docCheck = await db.get<{ projectId: string; authorId: string }>(
        "SELECT projectId, authorId FROM documents WHERE id = ?",
        req.params.id
      );
      if (!docCheck) {
        res.sendStatus(404);
        return;
      }
      if (!(await canContributeToProject(db, docCheck.projectId, req.user!))) {
        res.status(403).json({ error: "Access denied. Project viewers cannot edit documents." });
        return;
      }
      const { title, content } = req.body as { title?: string; content?: string };
      const now = new Date().toISOString();
      await db.run("UPDATE documents SET title = COALESCE(?, title), content = COALESCE(?, content), updatedAt = ? WHERE id = ?", [
        title,
        content,
        now,
        req.params.id,
      ]);
      const doc = await db.get("SELECT * FROM documents WHERE id = ?", req.params.id);
      res.json(doc);
    })
  );

  router.delete(
    "/documents/:id",
    auth,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      const docCheck = await db.get<{ projectId: string; authorId: string }>(
        "SELECT projectId, authorId FROM documents WHERE id = ?",
        req.params.id
      );
      if (!docCheck) {
        res.sendStatus(404);
        return;
      }
      const isAuthor = docCheck.authorId === req.user!.id;
      const canManage = await canManageProject(db, docCheck.projectId, req.user!);
      if (!isAuthor && !canManage && !isAdminOrSuperAdmin(req.user)) {
        res.status(403).json({ error: "Only the author or a project admin can delete this document." });
        return;
      }
      await db.run("DELETE FROM documents WHERE id = ?", req.params.id);
      res.json({ success: true });
    })
  );

  return router;
}
