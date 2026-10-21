import { Router, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { R } from "../runtime.ts";
import { isProjectAdminOrOwner } from "../rbac.ts";
import { webhookService, isSafeWebhookUrl } from "../services/webhook.service.ts";
import type { AuthUser } from "../types.ts";

function auth(req: any, res: any, next: any) {
  return R().authenticateToken(req, res, next);
}

export function webhooksRouter(): Router {
  const router = Router();

  router.post("/webhooks/github", async (req: any, res: Response) => {
    const event = req.headers["x-github-event"] as string;
    const signature = req.headers["x-hub-signature-256"] as string;
    const projectId = req.query.projectId as string | undefined;

    if (!event) {
      return res.status(400).json({ error: "Missing X-GitHub-Event header" });
    }

    try {
      const result = await webhookService.handleGitHubWebhook(
        event,
        req.body,
        req.rawBody,
        signature,
        projectId
      );
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to process webhook";
      console.error("[Webhook GitHub] Verification/processing error:", message);
      const statusCode =
        message.includes("signature") || message.includes("secret") || message.includes("Header")
          ? 401
          : message.includes("not found")
            ? 404
            : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  router.post("/webhooks/gitlab", async (req: any, res: Response) => {
    const event = req.headers["x-gitlab-event"] as string;
    const token = req.headers["x-gitlab-token"] as string;
    const projectId = req.query.projectId as string | undefined;

    if (!event) {
      return res.status(400).json({ error: "Missing X-Gitlab-Event header" });
    }

    try {
      const result = await webhookService.handleGitLabWebhook(event, req.body, token, projectId);
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to process webhook";
      console.error("[Webhook GitLab] Verification/processing error:", message);
      const statusCode =
        message.includes("token") || message.includes("secret") || message.includes("Header")
          ? 401
          : message.includes("not found")
            ? 404
            : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  router.get("/projects/:projectId/webhooks", auth, async (req: any, res) => {
    try {
      const db = await R().getDb();
      const { projectId } = req.params;
      const user = req.user as AuthUser;

      if (!(await isProjectAdminOrOwner(db, projectId, user))) {
        return res.status(403).json({ error: "Only project administrators can view webhooks" });
      }

      const webhooks = await db.all(
        "SELECT id, projectId, url, secret, events, active, createdAt FROM webhooks WHERE projectId = ? ORDER BY createdAt DESC",
        [projectId]
      );

      res.json(
        webhooks.map((w: Record<string, unknown>) => ({
          id: w.id,
          projectId: w.projectId,
          url: w.url,
          hasSecret: Boolean(w.secret),
          events: (() => {
            try {
              return JSON.parse(String(w.events));
            } catch {
              return [w.events];
            }
          })(),
          active: Boolean(w.active),
          createdAt: w.createdAt,
        }))
      );
    } catch (err: unknown) {
      console.error("Error fetching webhooks:", err);
      res.status(500).json({ error: "Failed to fetch webhooks" });
    }
  });

  router.post("/projects/:projectId/webhooks", auth, async (req: any, res) => {
    try {
      const db = await R().getDb();
      const { projectId } = req.params;
      const { url, secret, events } = req.body;
      const user = req.user as AuthUser;

      if (!(await isProjectAdminOrOwner(db, projectId, user))) {
        return res.status(403).json({ error: "Only project administrators can manage webhooks" });
      }

      if (!url || typeof url !== "string" || !url.startsWith("http")) {
        return res.status(400).json({ error: "Valid HTTP/HTTPS webhook URL is required" });
      }

      if (!isSafeWebhookUrl(url)) {
        return res.status(400).json({
          error: "Webhook URL points to a forbidden local or internal private network target.",
        });
      }

      const webhookId = uuidv4();
      const eventsJson = JSON.stringify(Array.isArray(events) && events.length > 0 ? events : ["*"]);
      const createdAt = new Date().toISOString();
      const encryptedSecret =
        secret && typeof secret === "string" && secret.trim() ? R().encryptSecret(secret.trim()) : null;

      await db.run(
        "INSERT INTO webhooks (id, projectId, url, secret, events, active, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?)",
        [webhookId, projectId, url, encryptedSecret, eventsJson, createdAt]
      );

      res.status(201).json({
        id: webhookId,
        projectId,
        url,
        hasSecret: Boolean(encryptedSecret),
        events: JSON.parse(eventsJson),
        active: true,
        createdAt,
      });
    } catch (err: unknown) {
      console.error("Error creating webhook:", err);
      res.status(500).json({ error: "Failed to create webhook" });
    }
  });

  router.delete("/projects/:projectId/webhooks/:webhookId", auth, async (req: any, res) => {
    try {
      const db = await R().getDb();
      const { projectId, webhookId } = req.params;
      const user = req.user as AuthUser;

      if (!(await isProjectAdminOrOwner(db, projectId, user))) {
        return res.status(403).json({ error: "Only project administrators can delete webhooks" });
      }

      await db.run("DELETE FROM webhooks WHERE id = ? AND projectId = ?", [webhookId, projectId]);
      await db.run("DELETE FROM webhook_deliveries WHERE webhookId = ?", [webhookId]);

      res.json({ success: true });
    } catch (err: unknown) {
      console.error("Error deleting webhook:", err);
      res.status(500).json({ error: "Failed to delete webhook" });
    }
  });

  router.post("/projects/:projectId/webhooks/:webhookId/test", auth, async (req: any, res) => {
    try {
      const db = await R().getDb();
      const { projectId, webhookId } = req.params;
      const user = req.user as AuthUser;

      if (!(await isProjectAdminOrOwner(db, projectId, user))) {
        return res.status(403).json({ error: "Only project administrators can test webhooks" });
      }

      const webhook = await db.get("SELECT * FROM webhooks WHERE id = ? AND projectId = ?", [
        webhookId,
        projectId,
      ]);

      if (!webhook) {
        return res.status(404).json({ error: "Webhook not found" });
      }

      await webhookService.dispatchProjectEvent(projectId, "webhook.test", {
        test: true,
        message: "This is a test delivery from DevTeam Task Manager",
        triggeredBy: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      });

      res.json({ success: true, message: "Test delivery dispatched" });
    } catch (err: unknown) {
      console.error("Error testing webhook:", err);
      res.status(500).json({ error: "Failed to test webhook" });
    }
  });

  router.get("/projects/:projectId/webhooks/:webhookId/deliveries", auth, async (req: any, res) => {
    try {
      const db = await R().getDb();
      const { projectId, webhookId } = req.params;
      const user = req.user as AuthUser;

      if (!(await isProjectAdminOrOwner(db, projectId, user))) {
        return res.status(403).json({ error: "Only project administrators can view webhook deliveries" });
      }

      const deliveries = await db.all(
        "SELECT id, webhookId, event, statusCode, responseBody, createdAt FROM webhook_deliveries WHERE webhookId = ? ORDER BY createdAt DESC LIMIT 20",
        [webhookId]
      );

      res.json(deliveries);
    } catch (err: unknown) {
      console.error("Error fetching deliveries:", err);
      res.status(500).json({ error: "Failed to fetch webhook deliveries" });
    }
  });

  return router;
}
