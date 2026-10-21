import crypto from "crypto";
import dns from "dns";
import net from "net";
import { Agent, fetch } from "undici";
import { v4 as uuidv4 } from "uuid";
import { R } from "../runtime.ts";
import type { DatabaseWrapper } from "../types.ts";
import { eventsService } from "./events.service.js";

export interface OutboundWebhookRecord {
  id: string;
  projectId: string;
  url: string;
  secret?: string;
  events: string;
  active: number;
  createdAt: string;
}

export function isSafeIp(ip: string): boolean {
  if (!ip) return false;

  // IPv4 check
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return false;
    const [p1, p2, p3, p4] = parts;

    // 0.0.0.0/8 (Current network)
    if (p1 === 0) return false;
    // 10.0.0.0/8 (Private)
    if (p1 === 10) return false;
    // 127.0.0.0/8 (Loopback)
    if (p1 === 127) return false;
    // 100.64.0.0/10 (Shared Address Space / CGNAT)
    if (p1 === 100 && p2 >= 64 && p2 <= 127) return false;
    // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (p1 === 169 && p2 === 254) return false;
    // 172.16.0.0/12 (Private)
    if (p1 === 172 && p2 >= 16 && p2 <= 31) return false;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (p1 === 192 && p2 === 0 && p3 === 0) return false;
    // 192.0.2.0/24 (TEST-NET-1)
    if (p1 === 192 && p2 === 0 && p3 === 2) return false;
    // 192.168.0.0/16 (Private)
    if (p1 === 192 && p2 === 168) return false;
    // 198.18.0.0/15 (Network benchmark tests)
    if (p1 === 198 && (p2 === 18 || p2 === 19)) return false;
    // 198.51.100.0/24 (TEST-NET-2)
    if (p1 === 198 && p2 === 51 && p3 === 100) return false;
    // 203.0.113.0/24 (TEST-NET-3)
    if (p1 === 203 && p2 === 0 && p3 === 113) return false;
    // 224.0.0.0/4 (Multicast)
    if (p1 >= 224 && p1 <= 239) return false;
    // 240.0.0.0/4 (Reserved)
    if (p1 >= 240) return false;
    // 255.255.255.255 (Broadcast)
    if (p1 === 255 && p2 === 255 && p3 === 255 && p4 === 255) return false;

    return true;
  }

  // IPv6 check
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Loopback / Unspecified
    if (lower === "::1" || lower === "::" || lower === "0:0:0:0:0:0:0:1" || lower === "0:0:0:0:0:0:0:0") return false;
    // Unique Local Addresses (fc00::/7)
    if (lower.startsWith("fc") || lower.startsWith("fd")) return false;
    // Link-local Unicast (fe80::/10)
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return false;
    // Multicast (ff00::/8)
    if (lower.startsWith("ff")) return false;
    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    if (lower.startsWith("::ffff:") || lower.includes(":ffff:")) {
      const match = lower.match(/:ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (match) {
        return isSafeIp(match[1]);
      }
      return false;
    }
    return true;
  }

  return false;
}

export function isSafeWebhookUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    // Block loopback, internal domains, cloud metadata
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".localhost") ||
      hostname.includes("metadata.google.internal")
    ) {
      return false;
    }

    if (net.isIP(hostname)) {
      return isSafeIp(hostname);
    }

    // Disallow hex or octal formatted IP strings
    if (/^(0x[0-9a-f]+|\d+)$/i.test(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export interface SafeDestinationResult {
  safe: boolean;
  pinnedIp?: string;
  family?: 4 | 6;
  error?: string;
}

export async function validateAndResolveSafeDestination(urlStr: string): Promise<SafeDestinationResult> {
  if (!isSafeWebhookUrl(urlStr)) {
    return { safe: false, error: "Invalid or blocked URL scheme/format" };
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (net.isIP(host)) {
      if (!isSafeIp(host)) {
        return { safe: false, error: `Forbidden IP address: ${host}` };
      }
      return { safe: true, pinnedIp: host, family: net.isIPv6(host) ? 6 : 4 };
    }
    // Resolve DNS records to verify actual connected IPs
    const records = await dns.promises.lookup(host, { all: true });
    if (!records || records.length === 0) {
      return { safe: false, error: "DNS lookup returned no records" };
    }
    for (const record of records) {
      if (!isSafeIp(record.address)) {
        return { safe: false, error: `Host resolves to non-public IP: ${record.address}` };
      }
    }
    const chosen = records[0];
    return {
      safe: true,
      pinnedIp: chosen.address,
      family: chosen.family === 6 ? 6 : 4
    };
  } catch (err: any) {
    return { safe: false, error: err.message || "Failed to resolve destination" };
  }
}

export class WebhookService {
  private customDb?: DatabaseWrapper;

  public setDb(db: DatabaseWrapper | undefined) {
    this.customDb = db;
  }

  private async getDb(): Promise<DatabaseWrapper> {
    if (this.customDb) return this.customDb;
    return await R().getDb();
  }

  /**
   * Dispatch an event to all configured outbound webhooks for a project
   */
  public async dispatchProjectEvent(
    projectId: string,
    event: string,
    payload: any
  ): Promise<void> {
    try {
      const db = await this.getDb();
      const webhooks = await db.all(
        "SELECT * FROM webhooks WHERE projectId = ? AND active = 1",
        [projectId]
      );

      if (!webhooks || webhooks.length === 0) return;

      const eventPayload = {
        id: uuidv4(),
        event,
        projectId,
        timestamp: new Date().toISOString(),
        data: payload
      };

      const payloadString = JSON.stringify(eventPayload);

      for (const webhook of webhooks) {
        let subscribedEvents: string[] = [];
        try {
          subscribedEvents = JSON.parse(webhook.events);
        } catch {
          subscribedEvents = [webhook.events];
        }

        // Check if webhook is subscribed to this event or wildcard
        const isSubscribed =
          subscribedEvents.includes("*") ||
          subscribedEvents.includes(event) ||
          subscribedEvents.some((e: string) => e.endsWith(".*") && event.startsWith(e.slice(0, -2)));

        if (!isSubscribed) continue;

        // Dispatch in background with retry logic
        this.deliverWebhook(webhook, event, payloadString, 1).catch((err) => {
          console.error(`[Webhook] Delivery error for ${webhook.id}:`, err.message);
        });
      }
    } catch (err: any) {
      console.error("[Webhook] Failed dispatching project event:", err.message);
    }
  }

  private async deliverWebhook(
    webhook: OutboundWebhookRecord,
    event: string,
    payloadString: string,
    attempt: number = 1
  ): Promise<void> {
    const db = await this.getDb();
    const deliveryId = uuidv4();

    let currentUrl = webhook.url;
    let redirectHops = 0;
    const maxRedirects = 2;
    let statusCode = 0;
    let responseBody = "";
    let success = false;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "DevTeam-TaskManager-Webhook/1.0",
      "X-Event-Type": event,
      "X-Delivery-Id": deliveryId,
      "X-Delivery-Attempt": String(attempt)
    };

    if (webhook.secret) {
      const rawSecret = R().decryptSecret(String(webhook.secret)) || webhook.secret;
      const signature = crypto
        .createHmac("sha256", rawSecret)
        .update(payloadString)
        .digest("hex");
      headers["X-Signature-SHA256"] = `sha256=${signature}`;
    }

    try {
      while (redirectHops <= maxRedirects) {
        // Validate hostname and resolve IP records
        const destResult = await validateAndResolveSafeDestination(currentUrl);
        if (!destResult.safe || !destResult.pinnedIp) {
          statusCode = 400;
          responseBody = `Error: Blocked SSRF destination or redirect target: ${currentUrl} (${destResult.error || "Forbidden destination"})`;
          console.warn(`[Webhook] Blocked outbound dispatch to forbidden address: ${currentUrl}`);
          break;
        }

        const pinnedIp = destResult.pinnedIp;
        const pinnedFamily = destResult.family || (net.isIPv6(pinnedIp) ? 6 : 4);

        // Pin the resolved IP address to eliminate DNS rebinding TOCTOU window
        const pinnedDispatcher = new Agent({
          connect: {
            lookup: (_hostname, _options, callback) => {
              callback(null, [{ address: pinnedIp, family: pinnedFamily }]);
            }
          }
        });

        try {
          const response = await fetch(currentUrl, {
            method: "POST",
            headers,
            body: payloadString,
            redirect: "manual",
            signal: AbortSignal.timeout(8000),
            dispatcher: pinnedDispatcher
          });

          statusCode = response.status;

          // Check for redirects
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const loc = response.headers.get("location");
            if (!loc) {
              responseBody = `Redirect ${response.status} missing Location header`;
              break;
            }
            currentUrl = new URL(loc, currentUrl).toString();
            redirectHops++;
            continue;
          }

          const text = await response.text();
          responseBody = text.slice(0, 1000); // cap response size
          success = response.ok;
          break;
        } finally {
          try {
            await pinnedDispatcher.close();
          } catch {
            // ignore agent close errors
          }
        }
      }
    } catch (err: any) {
      if (statusCode === 0) statusCode = 500;
      if (!responseBody) responseBody = `Error: ${err.message}`;
    }

    try {
      await db.run(
        "INSERT INTO webhook_deliveries (id, webhookId, event, statusCode, responseBody, payload, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          deliveryId,
          webhook.id,
          event,
          statusCode,
          responseBody,
          payloadString.slice(0, 2000),
          new Date().toISOString()
        ]
      );
    } catch (logErr: any) {
      console.error("[Webhook] Failed to log webhook delivery:", logErr.message);
    }

    // Retry with backoff if failed and attempts < 3
    if (!success && attempt < 3) {
      const backoffMs = attempt === 1 ? 2000 : 5000;
      setTimeout(() => {
        this.deliverWebhook(webhook, event, payloadString, attempt + 1).catch(() => {});
      }, backoffMs);
    }
  }

  /**
   * Process inbound GitHub webhooks with cryptographic HMAC signature verification
   */
  public async handleGitHubWebhook(
    event: string,
    payload: any,
    rawBody: Buffer | string | undefined,
    signatureHeader?: string,
    projectIdParam?: string
  ): Promise<{ success: boolean; message: string }> {
    if (!signatureHeader) {
      throw new Error("Missing X-Hub-Signature-256 header");
    }

    const db = await this.getDb();
    const repoFullName = payload.repository?.full_name; // e.g. owner/repo
    let project: any = null;

    if (projectIdParam) {
      project = await db.get("SELECT * FROM projects WHERE id = ?", [projectIdParam]);
    } else if (repoFullName) {
      const [owner, name] = repoFullName.split("/");
      if (owner && name) {
        project = await db.get(
          "SELECT * FROM projects WHERE repoOwner = ? AND repoName = ?",
          [owner, name]
        );
      }
      if (!project) {
        project = await db.get(
          "SELECT * FROM projects WHERE repoUrl = ? OR repoUrl = ?",
          [repoFullName, `https://github.com/${repoFullName}`]
        );
      }
    }

    if (!project) {
      throw new Error("Target project not found for repository payload");
    }

    if (!project.webhookSecret) {
      throw new Error("Project webhook secret is not configured");
    }

    const secret = R().decryptSecret(String(project.webhookSecret));
    if (!secret) {
      throw new Error("Unable to decrypt project webhook secret");
    }

    const bodyBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : typeof rawBody === "string"
      ? Buffer.from(rawBody, "utf8")
      : Buffer.from(JSON.stringify(payload), "utf8");

    const expectedSignature = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(bodyBuffer)
      .digest("hex")}`;

    const sigBuf = Buffer.from(signatureHeader);
    const expectedBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new Error("Invalid GitHub webhook signature");
    }

    if (event === "ping") {
      return { success: true, message: "PONG" };
    }

    if (event === "pull_request") {
      const action = payload.action;
      const pr = payload.pull_request;
      if (!pr) return { success: false, message: "Missing pull_request in payload" };

      const prUrl = pr.html_url;
      const prNumber = pr.number;
      const branchName = pr.head?.ref;
      const merged = pr.merged || false;
      const state = pr.state;
      let prStatus = state;
      if (merged) prStatus = "merged";

      // Find tasks scoped strictly to this validated project
      let tasksToUpdate: any[] = [];
      if (prUrl) {
        tasksToUpdate = await db.all(
          "SELECT * FROM tasks WHERE projectId = ? AND (prUrl = ? OR prUrl LIKE ?)",
          [project.id, prUrl, `%/pull/${prNumber}`]
        );
      }

      if (tasksToUpdate.length === 0 && branchName) {
        tasksToUpdate = await db.all(
          "SELECT * FROM tasks WHERE projectId = ? AND branchName = ?",
          [project.id, branchName]
        );
      }

      for (const task of tasksToUpdate) {
        let newStatus = task.status;
        if (prStatus === "merged" && task.status !== "done") {
          newStatus = "done";
        } else if (prStatus === "open" && (task.status === "todo" || task.status === "backlog")) {
          newStatus = "review";
        }

        await db.run(
          "UPDATE tasks SET prUrl = ?, prStatus = ?, status = ? WHERE id = ? AND projectId = ?",
          [prUrl, prStatus, newStatus, task.id, project.id]
        );

        // Record activity
        const activityId = uuidv4();
        const actionDesc = `GitHub Webhook: PR #${prNumber} ${action} (${prStatus}). Board status updated to '${newStatus}'`;
        await db.run(
          "INSERT INTO task_activities (id, taskId, userId, action, createdAt) VALUES (?, ?, ?, ?, ?)",
          [activityId, task.id, "system", actionDesc, new Date().toISOString()]
        );

        // Notify assignee & creator
        const recipients = new Set<string>();
        if (task.assigneeId) recipients.add(task.assigneeId);
        if (task.creatorId) recipients.add(task.creatorId);

        for (const recipientId of recipients) {
          await eventsService.notifyUser(recipientId, {
            type: "webhook",
            title: `PR #${prNumber} ${action}`,
            message: `Task "${task.title}" status updated to ${newStatus}`,
            link: `/board?taskId=${task.id}`
          });
        }

        // Broadcast minimal scoped notification envelope
        eventsService.broadcast({
          type: "task:updated",
          data: {
            taskId: task.id,
            projectId: task.projectId,
            action: "updated"
          },
          projectId: task.projectId
        });
      }

      return {
        success: true,
        message: `Processed GitHub PR #${prNumber} for project ${project.name}, updated ${tasksToUpdate.length} linked tasks.`
      };
    }

    return { success: true, message: `Event ${event} ignored` };
  }

  /**
   * Process inbound GitLab webhooks with token verification
   */
  public async handleGitLabWebhook(
    event: string,
    payload: any,
    tokenHeader?: string,
    projectIdParam?: string
  ): Promise<{ success: boolean; message: string }> {
    if (!tokenHeader) {
      throw new Error("Missing X-Gitlab-Token header");
    }

    const db = await this.getDb();
    const projectPath = payload.project?.path_with_namespace;
    let project: any = null;

    if (projectIdParam) {
      project = await db.get("SELECT * FROM projects WHERE id = ?", [projectIdParam]);
    } else if (projectPath) {
      const parts = projectPath.split("/");
      const name = parts.pop();
      const owner = parts.join("/");
      if (owner && name) {
        project = await db.get(
          "SELECT * FROM projects WHERE repoOwner = ? AND repoName = ?",
          [owner, name]
        );
      }
      if (!project) {
        project = await db.get(
          "SELECT * FROM projects WHERE repoUrl = ? OR repoUrl = ?",
          [projectPath, `https://gitlab.com/${projectPath}`]
        );
      }
    }

    if (!project) {
      throw new Error("Target project not found for GitLab repository");
    }

    if (!project.webhookSecret) {
      throw new Error("Project webhook secret is not configured");
    }

    const secret = R().decryptSecret(String(project.webhookSecret));
    if (!secret) {
      throw new Error("Unable to decrypt project webhook secret");
    }

    if (!tokenHeader) {
      throw new Error("Missing X-Gitlab-Token header");
    }

    const tokenBuf = Buffer.from(tokenHeader);
    const expectedBuf = Buffer.from(secret);

    if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
      throw new Error("Invalid GitLab webhook token");
    }

    if (event === "Merge Request Hook") {
      const objAttrs = payload.object_attributes;
      if (!objAttrs) return { success: false, message: "Missing object_attributes" };

      const mrUrl = objAttrs.url;
      const mrIid = objAttrs.iid;
      const branchName = objAttrs.source_branch;
      const state = objAttrs.state;
      let prStatus = state === "opened" ? "open" : state;

      let tasksToUpdate: any[] = [];
      if (mrUrl) {
        tasksToUpdate = await db.all(
          "SELECT * FROM tasks WHERE projectId = ? AND (prUrl = ? OR prUrl LIKE ?)",
          [project.id, mrUrl, `%/merge_requests/${mrIid}`]
        );
      }

      if (tasksToUpdate.length === 0 && branchName) {
        tasksToUpdate = await db.all(
          "SELECT * FROM tasks WHERE projectId = ? AND branchName = ?",
          [project.id, branchName]
        );
      }

      for (const task of tasksToUpdate) {
        let newStatus = task.status;
        if (prStatus === "merged" && task.status !== "done") {
          newStatus = "done";
        } else if (prStatus === "open" && (task.status === "todo" || task.status === "backlog")) {
          newStatus = "review";
        }

        await db.run(
          "UPDATE tasks SET prUrl = ?, prStatus = ?, status = ? WHERE id = ? AND projectId = ?",
          [mrUrl, prStatus, newStatus, task.id, project.id]
        );

        const activityId = uuidv4();
        const actionDesc = `GitLab Webhook: MR !${mrIid} ${state}. Board status updated to '${newStatus}'`;
        await db.run(
          "INSERT INTO task_activities (id, taskId, userId, action, createdAt) VALUES (?, ?, ?, ?, ?)",
          [activityId, task.id, "system", actionDesc, new Date().toISOString()]
        );

        const recipients = new Set<string>();
        if (task.assigneeId) recipients.add(task.assigneeId);
        if (task.creatorId) recipients.add(task.creatorId);

        for (const recipientId of recipients) {
          await eventsService.notifyUser(recipientId, {
            type: "webhook",
            title: `GitLab MR !${mrIid} ${state}`,
            message: `Task "${task.title}" updated to ${newStatus}`,
            link: `/board?taskId=${task.id}`
          });
        }

        eventsService.broadcast({
          type: "task:updated",
          data: {
            taskId: task.id,
            projectId: task.projectId,
            action: "updated"
          },
          projectId: task.projectId
        });
      }

      return {
        success: true,
        message: `Processed GitLab MR !${mrIid} for project ${project.name}, updated ${tasksToUpdate.length} tasks.`
      };
    }

    return { success: true, message: `Event ${event} ignored` };
  }
}

export const webhookService = new WebhookService();
