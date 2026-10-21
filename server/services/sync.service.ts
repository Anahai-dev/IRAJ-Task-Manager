import { v4 as uuidv4 } from "uuid";
import { R } from "../runtime.ts";
import { purgeStaleUnverifiedUsers } from "../db/index.ts";
import { mapPrStatusToBoardColumn } from "../util.ts";
import { getGithubPullRequest } from "../git/github.ts";
import { getGitlabMergeRequest } from "../git/gitlab.ts";

export async function runBackgroundPrSync() {
  console.log("[Background Sync] Starting automatic pull request sync...");
  try {
    const db = await R().getDb();
    const projects = await db.all<Record<string, unknown>>(
      "SELECT * FROM projects WHERE repoOwner IS NOT NULL AND repoName IS NOT NULL AND repoToken IS NOT NULL"
    );
    if (!projects || projects.length === 0) {
      console.log("[Background Sync] No projects configured with Git. Skipping.");
      return;
    }

    const decryptSecret = R().decryptSecret;

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
            if (nextTaskStatus !== null) {
              await db.run("UPDATE tasks SET prStatus = ?, status = ? WHERE id = ?", [
                remotePrStatus,
                nextTaskStatus,
                task.id,
              ]);
            } else {
              await db.run("UPDATE tasks SET prStatus = ? WHERE id = ?", [remotePrStatus, task.id]);
            }
            const statusNote =
              nextTaskStatus !== null
                ? `updated PR to '${remotePrStatus}' and Board Status to '${nextTaskStatus}'`
                : `updated PR to '${remotePrStatus}' (board status unchanged — no mapped column)`;
            await db.run(
              "INSERT INTO task_activities (id, taskId, userId, action, createdAt) VALUES (?, ?, ?, ?, ?)",
              [
                uuidv4(),
                task.id,
                "system",
                `automatically synchronized PR status: ${statusNote}`,
                new Date().toISOString(),
              ]
            );
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

export function startBackgroundJobs() {
  const syncInterval = setInterval(() => void runBackgroundPrSync(), 5 * 60 * 1000);
  const initialTimeout = setTimeout(() => void runBackgroundPrSync(), 5000);

  const purgeInterval = setInterval(() => {
    void (async () => {
      try {
        const db = await R().getDb();
        await purgeStaleUnverifiedUsers(db, R().config.db.purgeUnverifiedUsersAfterMs);

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        await db.run("DELETE FROM notifications WHERE createdAt < ?", [thirtyDaysAgo]);

        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        await db.run("DELETE FROM webhook_deliveries WHERE createdAt < ?", [fourteenDaysAgo]);
      } catch (e: unknown) {
        console.error("[Background Jobs] Retention cleanup error:", (e as Error).message);
      }
    })();
  }, 60 * 60 * 1000);

  const noncePurgeInterval = setInterval(() => {
    void (async () => {
      try {
        const db = await R().getDb();
        await db.run("DELETE FROM oauth_nonces WHERE timestamp < ?", Date.now() - 20 * 60 * 1000);
      } catch {
        // ignore
      }
    })();
  }, 10 * 60 * 1000);

  return function stopBackgroundJobs() {
    clearInterval(syncInterval);
    clearTimeout(initialTimeout);
    clearInterval(purgeInterval);
    clearInterval(noncePurgeInterval);
  };
}
