import { Router, type Response } from "express";
import { R } from "../runtime.ts";
import { eventsService } from "../services/events.service.ts";
import type { AuthUser } from "../types.ts";

function auth(req: any, res: any, next: any) {
  return R().authenticateToken(req, res, next);
}

export function eventsRouter(): Router {
  const router = Router();

  router.get("/events", auth, (req: any, res: Response) => {
    try {
      const user = req.user as AuthUser;
      const userId = user.id;
      const userRole = user.role;
      const projectId = req.query.projectId as string | undefined;

      const clientId = eventsService.registerClient(userId, userRole, res, projectId);

      req.on("close", () => {
        eventsService.unregisterClient(clientId);
      });
    } catch (err: unknown) {
      console.error("Error registering SSE client:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to establish events stream" });
      }
    }
  });

  router.get("/notifications", auth, async (req: any, res) => {
    try {
      const db = await R().getDb();
      const userId = (req.user as AuthUser).id;

      const notifications = await db.all(
        "SELECT id, userId, type, title, message, link, read, createdAt FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50",
        [userId]
      );

      const unreadResult = await db.get<{ count: number | string }>(
        "SELECT COUNT(*) as count FROM notifications WHERE userId = ? AND read = 0",
        [userId]
      );

      const unreadCount = Number(unreadResult?.count || 0);

      res.json({
        notifications: notifications.map((n: Record<string, unknown>) => ({
          ...n,
          isRead: Boolean(n.read),
        })),
        unreadCount,
      });
    } catch (err: unknown) {
      console.error("Error fetching notifications:", err);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  router.patch("/notifications/:id/read", auth, async (req: any, res) => {
    try {
      const db = await R().getDb();
      const { id } = req.params;
      const userId = (req.user as AuthUser).id;

      await db.run("UPDATE notifications SET read = 1 WHERE id = ? AND userId = ?", [id, userId]);

      res.json({ success: true });
    } catch (err: unknown) {
      console.error("Error marking notification as read:", err);
      res.status(500).json({ error: "Failed to update notification" });
    }
  });

  router.post("/notifications/read-all", auth, async (req: any, res) => {
    try {
      const db = await R().getDb();
      const userId = (req.user as AuthUser).id;

      await db.run("UPDATE notifications SET read = 1 WHERE userId = ?", [userId]);

      res.json({ success: true });
    } catch (err: unknown) {
      console.error("Error marking all notifications as read:", err);
      res.status(500).json({ error: "Failed to mark all as read" });
    }
  });

  router.delete("/notifications/:id", auth, async (req: any, res) => {
    try {
      const db = await R().getDb();
      const { id } = req.params;
      const userId = (req.user as AuthUser).id;

      await db.run("DELETE FROM notifications WHERE id = ? AND userId = ?", [id, userId]);

      res.json({ success: true });
    } catch (err: unknown) {
      console.error("Error deleting notification:", err);
      res.status(500).json({ error: "Failed to delete notification" });
    }
  });

  return router;
}
