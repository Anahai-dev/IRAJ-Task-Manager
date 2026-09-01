import "dotenv/config";
import { loadConfig } from "./server/config.ts";
import { initDb, purgeStaleUnverifiedUsers } from "./server/db/index.ts";
import { createApp } from "./server/app.ts";
import { v4 as uuidv4 } from "uuid";
import { mapPrStatusToBoardColumn } from "./server/util.ts";
import { getGithubPullRequest } from "./server/git/github.ts";
import { getGitlabMergeRequest } from "./server/git/gitlab.ts";
import { setGitApiConfig, gitApiConfigFromApp } from "./server/git/runtime-config.ts";
import type { DatabaseWrapper } from "./server/types.ts";
import type { AppConfig } from "./server/config.ts";

async function runBackgroundPrSync(getDb: () => Promise<DatabaseWrapper>, decryptSecret: (t: string) => string) {
  console.log("[Background Sync] Starting automatic pull request sync...");
  try {
    const db = await getDb();
    const projects = await db.all<Record<string, unknown>>(
      "SELECT * FROM projects WHERE repoOwner IS NOT NULL AND repoName IS NOT NULL AND repoToken IS NOT NULL"
    );
    if (!projects || projects.length === 0) {
      console.log("[Background Sync] No projects configured with Git. Skipping.");
      return;
    }

    for (const project of projects) {
      const provider = String(project.repoProvider || "github");
      const owner = String(project.repoOwner);
      const name = String(project.repoName);
      const token = decryptSecret(String(project.repoToken || ""));

      const tasks = await db.all<Record<string, unknown>>(
        "SELECT id, title, prUrl, prStatus, status FROM tasks WHERE projectId = ? AND prUrl IS NOT NULL AND prUrl != '' AND prStatus != 'merged' AND prStatus != 'closed'",
        [project.id]
      );
      if (!tasks || tasks.length === 0) continue;

      for (const task of tasks) {
        try {
          let prNumber: string | null = null;
          const prUrl = String(task.prUrl || "");
          if (provider === "github") {
            const match = prUrl.match(/\/pull\/(\d+)/);
            if (match) prNumber = match[1];
          } else if (provider === "gitlab") {
            const match = prUrl.match(/\/merge_requests\/(\d+)/);
            if (match) prNumber = match[1];
          }
          if (!prNumber) continue;

          let remotePrStatus = String(task.prStatus || "open");
          if (provider === "github") {
            const gh = await getGithubPullRequest({ owner, name, token, prNumber });
            if (gh) remotePrStatus = gh.status;
          } else if (provider === "gitlab") {
            const gl = await getGitlabMergeRequest({ owner, name, token, mrNumber: prNumber });
            if (gl) remotePrStatus = gl.status;
          }

          if (remotePrStatus !== task.prStatus) {
            const nextTaskStatus = await mapPrStatusToBoardColumn(
              db,
              String(project.id),
              String(task.status),
              remotePrStatus
            );
            await db.run("UPDATE tasks SET prStatus = ?, status = ? WHERE id = ?", [
              remotePrStatus,
              nextTaskStatus,
              task.id,
            ]);
            await db.run(
              "INSERT INTO task_activities (id, taskId, userId, action, createdAt) VALUES (?, ?, ?, ?, ?)",
              [
                uuidv4(),
                task.id,
                "system",
                `automatically synchronized PR status: updated PR to '${remotePrStatus}' and Board Status to '${nextTaskStatus}'`,
                new Date().toISOString(),
              ]
            );
            console.log(`[Background Sync] Updated task "${task.title}" to ${nextTaskStatus} (PR ${remotePrStatus})`);
          }
        } catch (taskErr: unknown) {
          console.error(`[Background Sync] Error syncing task ${task.id}:`, (taskErr as Error).message);
        }
      }
    }
  } catch (err: unknown) {
    console.error("[Background Sync] Error running background PR sync:", (err as Error).message);
  }
}

function scheduleBackgroundJobs(config: AppConfig, getDb: () => Promise<DatabaseWrapper>, decryptSecret: (t: string) => string) {
  const intervals: NodeJS.Timeout[] = [];

  if (config.git.enabled) {
    intervals.push(
      setInterval(() => {
        void runBackgroundPrSync(getDb, decryptSecret);
      }, config.git.prSyncIntervalMs)
    );
    setTimeout(() => {
      void runBackgroundPrSync(getDb, decryptSecret);
    }, config.git.prSyncInitialDelayMs);
  }

  intervals.push(
    setInterval(() => {
      void (async () => {
        try {
          const db = await getDb();
          await purgeStaleUnverifiedUsers(db, config.db.purgeUnverifiedUsersAfterMs);
        } catch (e) {
          console.error("Failed to purge unverified users:", e);
        }
      })();
    }, config.db.purgeUnverifiedUsersIntervalMs)
  );

  intervals.push(
    setInterval(() => {
      void (async () => {
        try {
          const db = await getDb();
          await db.run("DELETE FROM oauth_nonces WHERE timestamp < ?", Date.now() - config.oauth.nonceRetentionMs);
        } catch (e) {
          console.error("Failed to purge OAuth nonces:", e);
        }
      })();
    }, config.oauth.noncePurgeIntervalMs)
  );

  return intervals;
}

async function startServer() {
  const config = loadConfig();
  setGitApiConfig(gitApiConfigFromApp(config));
  const init = await initDb(config);
  const dbPromise = Promise.resolve(init.db);
  const getDb = () => dbPromise;

  const app = await createApp({ config, getDb, serveFrontend: true });

  const { decryptSecretOrEmpty } = (await import("./server/auth/crypto.ts")).createSecretCipher(
    config.security.tokenEncryptionKey
  );

  const server = app.listen(config.http.port, config.http.host, () => {
    console.log(`Server running on http://${config.http.host}:${config.http.port}`);
  });

  const intervals = scheduleBackgroundJobs(config, getDb, decryptSecretOrEmpty);

  const shutdown = () => {
    console.log("Shutting down gracefully...");
    for (const interval of intervals) {
      clearInterval(interval);
    }
    server.close(() => {
      console.log("Closed out remaining connections.");
      void init.db.close?.();
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Could not close connections in time, forcefully shutting down");
      process.exit(1);
    }, config.http.shutdownTimeoutMs);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer().catch((err) => {
  console.error("FATAL: failed to start server:", err);
  process.exit(1);
});
