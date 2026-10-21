import { Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { R } from "../runtime.ts";
import { getAuthorizedProjectUserIds, isAdminOrSuperAdmin } from "../rbac.ts";

export interface SseClient {
  id: string;
  userId: string;
  userRole: string;
  projectId?: string;
  res: Response;
  connectedAt: Date;
}

export interface RealtimeEventPayload {
  type: string;
  data: any;
  targetUserId?: string;
  projectId?: string;
  excludeClientId?: string;
}

class EventsService {
  private clients: Map<string, SseClient> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  public registerClient(
    userId: string,
    userRole: string,
    res: Response,
    projectId?: string
  ): string {
    const clientId = uuidv4();

    // Configure headers for Server-Sent Events
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no" // Disable buffering for NGINX/proxies
    });

    res.flushHeaders?.();

    const client: SseClient = {
      id: clientId,
      userId,
      userRole,
      projectId,
      res,
      connectedAt: new Date()
    };

    this.clients.set(clientId, client);

    // Initial handshake event
    this.sendToClient(client, "connected", {
      clientId,
      userId,
      timestamp: new Date().toISOString()
    });

    console.log(
      `[SSE] Client connected: ${clientId} (User: ${userId}, Role: ${userRole}, Total: ${this.clients.size})`
    );

    return clientId;
  }

  public unregisterClient(clientId: string) {
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId);
      console.log(`[SSE] Client disconnected: ${clientId} (Total remaining: ${this.clients.size})`);
    }
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public updateClientProject(clientId: string, projectId?: string) {
    const client = this.clients.get(clientId);
    if (client) {
      client.projectId = projectId;
    }
  }

  private sendToClient(client: SseClient, type: string, data: any) {
    try {
      client.res.write(`event: ${type}\n`);
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err: any) {
      console.warn(`[SSE] Failed writing to client ${client.id}:`, err.message);
      this.unregisterClient(client.id);
    }
  }

  /**
   * Broadcast an event strictly scoped to authorized users
   */
  public async broadcast(event: RealtimeEventPayload) {
    const { type, data, targetUserId, projectId, excludeClientId } = event;

    let authorizedUserIds: Set<string> | null = null;

    if (projectId) {
      try {
        const db = await R().getDb();
        authorizedUserIds = await getAuthorizedProjectUserIds(db, projectId);
      } catch (err: any) {
        console.error("[SSE] Database error during broadcast authorization:", err.message);
      }
    }

    for (const [clientId, client] of this.clients.entries()) {
      if (excludeClientId && clientId === excludeClientId) {
        continue;
      }

      // If targeted to a specific user, skip others
      if (targetUserId && client.userId !== targetUserId) {
        continue;
      }

      // If client is explicitly filtering by another project, skip
      if (projectId && client.projectId && client.projectId !== projectId) {
        continue;
      }

      // If targeted to a project, verify client has access to this project
      if (projectId) {
        const isGlobalAdmin =
          client.userRole === "super_admin" || client.userRole === "admin";
        if (!isGlobalAdmin) {
          if (!authorizedUserIds || !authorizedUserIds.has(client.userId)) {
            continue; // Drop broadcast for unauthorized user
          }
        }
      }

      this.sendToClient(client, type, data);
    }
  }

  public async notifyUser(
    userId: string,
    notificationData: {
      type: "mention" | "assignment" | "status_change" | "system" | "webhook";
      title: string;
      message: string;
      link?: string;
    }
  ) {
    try {
      const db = await R().getDb();
      const notifId = uuidv4();
      const createdAt = new Date().toISOString();

      await db.run(
        "INSERT INTO notifications (id, userId, type, title, message, link, read, createdAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
        [
          notifId,
          userId,
          notificationData.type,
          notificationData.title,
          notificationData.message,
          notificationData.link || null,
          createdAt
        ]
      );

      const notificationRecord = {
        id: notifId,
        userId,
        type: notificationData.type,
        title: notificationData.title,
        message: notificationData.message,
        link: notificationData.link || null,
        read: 0,
        createdAt
      };

      // Realtime push directly to user
      this.broadcast({
        type: "notification:new",
        data: notificationRecord,
        targetUserId: userId
      });

      return notificationRecord;
    } catch (err: any) {
      console.error("[SSE] Failed creating notification:", err);
      return null;
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    // Ping every 25 seconds
    this.heartbeatTimer = setInterval(() => {
      for (const [clientId, client] of this.clients.entries()) {
        try {
          client.res.write(": heartbeat\n\n");
        } catch {
          this.unregisterClient(clientId);
        }
      }
    }, 25000);
    if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === "function") {
      this.heartbeatTimer.unref();
    }
  }

  public getConnectedCount(): number {
    return this.clients.size;
  }
}

export const eventsService = new EventsService();
