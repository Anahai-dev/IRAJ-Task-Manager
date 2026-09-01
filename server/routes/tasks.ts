import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { R } from "../runtime.ts";
import {
  checkProjectAccess,
  checkTaskAccess,
  hasPermission,
  isAdminOrSuperAdmin,
  isProjectAdminOrOwner,
} from "../rbac.ts";
import { extractTaskNumber, logActivity, nextTaskCounter } from "../util.ts";
import { buildPageInfo, parsePageParams, sendPaginated } from "../pagination.ts";
import type { TaskRow } from "../types.ts";
type Task = TaskRow;

function auth(req: any, res: any, next: any) {
  return R().authenticateToken(req, res, next);
}

export function tasksRouter(): Router {
  const router = Router();

// Get Tasks
router.get("/api/tasks", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  
  let query = `
    SELECT DISTINCT t.* 
    FROM tasks t
    LEFT JOIN projects p ON t.projectId = p.id
    LEFT JOIN project_members pm ON p.id = pm.projectId
    LEFT JOIN team_projects tp ON p.id = tp.projectId
    LEFT JOIN team_members tm ON tp.teamId = tm.teamId
  `;
  
  const conditions = [];
  const queryParams = [];
  
  if (!isAdminOrSuperAdmin(req.user)) {
    conditions.push(`(p.ownerId = ? OR pm.userId = ? OR tm.userId = ? OR t.assigneeId = ? OR t.creatorId = ?)`);
    queryParams.push(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
  }
  
  if (req.query.projectId) {
    conditions.push("t.projectId = ?");
    queryParams.push(req.query.projectId);
  }
  
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  const { page, pageSize, offset } = parsePageParams(req.query, R().config.pagination);
  const countRow = await db.get<{ count: number | string }>(
    `SELECT COUNT(DISTINCT t.id) as count FROM tasks t
     LEFT JOIN projects p ON t.projectId = p.id
     LEFT JOIN project_members pm ON p.id = pm.projectId
     LEFT JOIN team_projects tp ON p.id = tp.projectId
     LEFT JOIN team_members tm ON tp.teamId = tm.teamId
     ${conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""}`,
    queryParams
  );
  const total = Number(countRow?.count || 0);

  query += " ORDER BY t.createdAt DESC LIMIT ? OFFSET ?";
  const pageParams = [...queryParams, pageSize, offset];
  const tasks = await db.all(query, pageParams);
  
  if (tasks.length > 0) {
    const taskIds = tasks.map((t: any) => t.id);
    const placeholders = taskIds.map(() => '?').join(',');
    const deps = await db.all(`SELECT * FROM task_dependencies WHERE taskId IN (${placeholders})`, taskIds);
    tasks.forEach((t: any) => {
      t.dependencies = deps.filter((d: any) => d.taskId === t.id).map((d: any) => d.blockedByTaskId);
    });
  } else {
    tasks.forEach((t: any) => {
      t.dependencies = [];
    });
  }
  
  sendPaginated(res, tasks, buildPageInfo(total, page, pageSize));
});

// Logs activity
async function logActivity(db: any, taskId: string, userId: string, action: string) {
  const activityId = uuidv4();
  await db.run(
    "INSERT INTO task_activities (id, taskId, userId, action, createdAt) VALUES (?, ?, ?, ?, ?)",
    [activityId, taskId, userId, action, new Date().toISOString()]
  );
}

// Get Task Details (Comments and Activities)
router.get("/api/tasks/:id/details", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const taskId = req.params.id;
  const access = await checkTaskAccess(db, taskId, req.user);
  if (!access.allowed) {
    return res.status(403).json({ error: "Access denied to task details." });
  }

  const comments = await db.all("SELECT * FROM task_comments WHERE taskId = ? ORDER BY createdAt ASC", taskId);
  const activities = await db.all("SELECT * FROM task_activities WHERE taskId = ? ORDER BY createdAt DESC", taskId);
  res.json({ comments, activities });
});

// Create Comment
router.post("/api/tasks/:id/comments", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const taskId = req.params.id;
  const access = await checkTaskAccess(db, taskId, req.user);
  if (!access.allowed) {
    return res.status(403).json({ error: "Access denied to comment on this task." });
  }

  if (!req.body.content || typeof req.body.content !== 'string' || req.body.content.trim() === '') {
    return res.status(400).json({ error: "Comment content is required." });
  }

  const commentId = uuidv4();
  await db.run(
    "INSERT INTO task_comments (id, taskId, userId, content, createdAt) VALUES (?, ?, ?, ?, ?)",
    [commentId, taskId, req.user.id, req.body.content, new Date().toISOString()]
  );
  await logActivity(db, taskId, req.user.id, `commented: ${req.body.content.substring(0, 50)}...`);
  const comment = await db.get("SELECT * FROM task_comments WHERE id = ?", commentId);
  res.json(comment);
});

// Edit Comment
router.put("/api/tasks/:taskId/comments/:commentId", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const { taskId, commentId } = req.params;
  const { content } = req.body;
  
  const access = await checkTaskAccess(db, taskId, req.user);
  if (!access.allowed) {
    return res.status(403).json({ error: "Access denied to this task." });
  }

  const comment = await db.get("SELECT * FROM task_comments WHERE id = ? AND taskId = ?", [commentId, taskId]);
  if (!comment) return res.status(404).json({ error: "Comment not found" });
  if (comment.userId !== req.user.id && !isAdminOrSuperAdmin(req.user)) {
    return res.status(403).json({ error: "Unauthorized to edit this comment" });
  }

  await db.run("UPDATE task_comments SET content = ? WHERE id = ?", [content, commentId]);
  const updatedComment = await db.get("SELECT * FROM task_comments WHERE id = ?", commentId);
  res.json(updatedComment);
});

// Delete Comment
router.delete("/api/tasks/:taskId/comments/:commentId", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const { taskId, commentId } = req.params;

  const access = await checkTaskAccess(db, taskId, req.user);
  if (!access.allowed) {
    return res.status(403).json({ error: "Access denied to this task." });
  }

  const comment = await db.get("SELECT * FROM task_comments WHERE id = ? AND taskId = ?", [commentId, taskId]);
  if (!comment) return res.status(404).json({ error: "Comment not found" });
  if (comment.userId !== req.user.id && !isAdminOrSuperAdmin(req.user)) {
    return res.status(403).json({ error: "Unauthorized to delete this comment" });
  }

  await db.run("DELETE FROM task_comments WHERE id = ?", commentId);
  res.json({ success: true });
});

// Create Task
router.post("/api/tasks", auth, async (req: any, res: any) => {
  const isAllowed = await hasPermission(req.user, "create_tasks");
  if (!isAllowed) {
    return res.status(403).json({ error: "You do not have permission to create tasks." });
  }

  if (!req.body.projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }
  if (!req.body.title || typeof req.body.title !== 'string' || req.body.title.trim() === '') {
    return res.status(400).json({ error: "Task title is required" });
  }

  const db = await R().getDb();

  const project = await db.get("SELECT ownerId, projectKey, taskCounter FROM projects WHERE id = ?", req.body.projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const hasProjectAccess = await checkProjectAccess(db, req.body.projectId, req.user);
  if (!hasProjectAccess) {
     return res.status(403).json({ error: "You must have access to the project to create tasks in it." });
  }
  
  if (req.body.parentId) {
    const parentTask = await db.get("SELECT id, projectId FROM tasks WHERE id = ?", req.body.parentId);
    if (!parentTask) {
      return res.status(400).json({ error: "Parent task does not exist." });
    }
    if (String(parentTask.projectId) !== String(req.body.projectId)) {
      return res.status(400).json({ error: "Parent task must belong to the same project." });
    }
  }

  const taskStatus = req.body.status || "todo";
  if (typeof taskStatus !== 'string' || taskStatus.trim() === '' || taskStatus.length > 50) {
    return res.status(400).json({ error: "Invalid task status." });
  }

  if (req.body.projectId) {
    const colRow = await db.get("SELECT columnsJson FROM project_columns WHERE projectId = ?", req.body.projectId);
    if (colRow && colRow.columnsJson) {
      try {
        const parsedCols = JSON.parse(colRow.columnsJson);
        if (Array.isArray(parsedCols) && parsedCols.length > 0) {
          const validIds = new Set(parsedCols.map((c: any) => c.id || c.name));
          if (!validIds.has(taskStatus)) {
            return res.status(400).json({ error: "Specified status is not a valid column in this project." });
          }
        }
      } catch (e) {
        // fallback
      }
    }
  }

  let branchName = req.body.branchName;
  if (!branchName) {
    if (project && project.projectKey) {
        const nextCount = await nextTaskCounter(db, req.body.projectId);
        branchName = `${project.projectKey}-${nextCount}`;
    }
  } else {
    const taskNum = extractTaskNumber(branchName);
    if (taskNum !== null && taskNum > (project.taskCounter || 0)) {
        await db.run("UPDATE projects SET taskCounter = ? WHERE id = ?", [taskNum, req.body.projectId]);
    }
  }

  const newTask: Task = {
    id: uuidv4(),
    title: req.body.title,
    description: req.body.description || "",
    status: req.body.status || "todo",
    priority: req.body.priority || "medium",
    deadline: req.body.deadline || new Date().toISOString(),
    assigneeId: req.body.assigneeId || null,
    creatorId: req.user.id,
    branchName: branchName || null,
    parentId: req.body.parentId || null,
    projectId: req.body.projectId || null,
    milestoneId: req.body.milestoneId || null,
    createdAt: new Date().toISOString(),
    orderIndex: req.body.orderIndex !== undefined ? req.body.orderIndex : Date.now(),
  };

  await db.run(
    "INSERT INTO tasks (id, title, description, status, priority, deadline, assigneeId, creatorId, branchName, parentId, projectId, milestoneId, createdAt, orderIndex) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [newTask.id, newTask.title, newTask.description, newTask.status, newTask.priority, newTask.deadline, newTask.assigneeId, newTask.creatorId, newTask.branchName, newTask.parentId, newTask.projectId, newTask.milestoneId, newTask.createdAt, newTask.orderIndex]
  );
  
  if (req.body.dependencies && Array.isArray(req.body.dependencies)) {
    for (const depId of req.body.dependencies) {
      if (!depId || depId === newTask.id) continue;
      const depTask = await db.get("SELECT id, projectId FROM tasks WHERE id = ?", depId);
      if (depTask && depTask.projectId === newTask.projectId) {
        await db.run("INSERT INTO task_dependencies (taskId, blockedByTaskId) VALUES (?, ?)", [newTask.id, depId]);
      }
    }
  }

  if (newTask.parentId) {
    const parentTask = await db.get("SELECT * FROM tasks WHERE id = ? AND projectId = ?", [newTask.parentId, newTask.projectId]);
    if (parentTask) {
       const subtasks = await db.all("SELECT status FROM tasks WHERE parentId = ? AND projectId = ?", [newTask.parentId, newTask.projectId]);
       if (subtasks.length > 0) {
           const allDone = subtasks.every((st: any) => st.status === 'done');
           if (allDone && parentTask.status !== 'done') {
               await db.run("UPDATE tasks SET status = 'done' WHERE id = ? AND projectId = ?", [newTask.parentId, newTask.projectId]);
           } else if (!allDone && parentTask.status === 'done') {
               await db.run("UPDATE tasks SET status = 'in_progress' WHERE id = ? AND projectId = ?", [newTask.parentId, newTask.projectId]);
           }
       }
    }
  }

  await logActivity(db, newTask.id, req.user.id, "created task");

  res.json(newTask);
});

// Update Task
router.put("/api/tasks/:id", auth, async (req: any, res: any) => {
  if (req.body.title !== undefined && (typeof req.body.title !== 'string' || req.body.title.trim() === '')) {
    return res.status(400).json({ error: "Task title cannot be empty" });
  }

  const db = await R().getDb();
  const task = await db.get("SELECT * FROM tasks WHERE id = ?", req.params.id);
  if (!task) return res.sendStatus(404);

  if (task.projectId) {
    const hasProjectAccess = await checkProjectAccess(db, task.projectId, req.user);
    const isAssigneeOrCreator = task.assigneeId === req.user.id || task.creatorId === req.user.id;
    if (!hasProjectAccess && !isAssigneeOrCreator) {
      return res.status(403).json({ error: "Access denied to the project containing this task." });
    }
  }

  let canManageTask = false;
  if (task.projectId) {
    canManageTask = await isProjectAdminOrOwner(db, task.projectId, req.user);
    if (!canManageTask) {
      const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [task.projectId, req.user.id]);
      if (pm && pm.role !== 'viewer') {
        canManageTask = await hasPermission(req.user, "edit_all_tasks");
      }
    }
  } else {
    canManageTask = isAdminOrSuperAdmin(req.user);
  }

  if (!canManageTask) {
    if (task.assigneeId !== req.user.id && task.creatorId !== req.user.id) {
      return res.status(403).json({ error: "Only admins, managers, the assigned contributor, or the task creator can update this task." });
    }

    // Check if projectId is changed
    if (req.body.projectId !== undefined && String(req.body.projectId) !== String(task.projectId)) {
      return res.status(403).json({ error: "You are not allowed to change the project." });
    }

    // Check if assigneeId is changed
    if (req.body.assigneeId !== undefined && (req.body.assigneeId || null) !== (task.assigneeId || null)) {
      return res.status(403).json({ error: "You are not allowed to change the assignee." });
    }

    // Check if priority is changed
    if (req.body.priority !== undefined && req.body.priority !== task.priority) {
      return res.status(403).json({ error: "You are not allowed to change the priority." });
    }

    // Check if deadline is changed
    if (req.body.deadline !== undefined && req.body.deadline !== task.deadline) {
      return res.status(403).json({ error: "You are not allowed to change the deadline." });
    }

    // Check if milestoneId is changed
    if (req.body.milestoneId !== undefined && (req.body.milestoneId || null) !== (task.milestoneId || null)) {
      return res.status(403).json({ error: "You are not allowed to change the milestone." });
    }

    // Check if parentId is changed
    if (req.body.parentId !== undefined && (req.body.parentId || null) !== (task.parentId || null)) {
      return res.status(403).json({ error: "You are not allowed to change the parent task." });
    }

    // Check if branchName is changed
    if (req.body.branchName !== undefined && (req.body.branchName || null) !== (task.branchName || null)) {
      return res.status(403).json({ error: "You are not allowed to change the branch name." });
    }

    // Check if dependencies are changed
    if (req.body.dependencies !== undefined && Array.isArray(req.body.dependencies)) {
      const currentDepsRows = await db.all("SELECT blockedByTaskId FROM task_dependencies WHERE taskId = ?", task.id);
      const currentDepIds = currentDepsRows.map((r: any) => r.blockedByTaskId).sort();
      const newDepIds = [...req.body.dependencies].sort();
      if (JSON.stringify(currentDepIds) !== JSON.stringify(newDepIds)) {
        return res.status(403).json({ error: "You are not allowed to change dependencies." });
      }
    }
  }

  if (!canManageTask && task.creatorId !== req.user.id && task.assigneeId !== req.user.id) {
    return res.status(403).json({ error: "Only authorized roles, task creators, or assignees can edit tasks." });
  }

  if (req.body.projectId === null || req.body.projectId === "") {
    return res.status(400).json({ error: "projectId cannot be removed from a task" });
  }

  if (req.body.projectId !== undefined && String(req.body.projectId) !== String(task.projectId)) {
    const hasDestAccess = await checkProjectAccess(db, req.body.projectId, req.user);
    if (!hasDestAccess) {
      return res.status(403).json({ error: "You do not have access to the destination project." });
    }
  }
  
  if (req.body.parentId !== undefined && req.body.parentId !== null && req.body.parentId !== "") {
    if (req.body.parentId === task.id) {
      return res.status(400).json({ error: "A task cannot be its own parent." });
    }
    const targetProjectId = req.body.projectId !== undefined ? req.body.projectId : task.projectId;
    const parentTask = await db.get("SELECT id, projectId FROM tasks WHERE id = ?", req.body.parentId);
    if (!parentTask) {
      return res.status(400).json({ error: "Parent task does not exist." });
    }
    if (String(parentTask.projectId) !== String(targetProjectId)) {
      return res.status(400).json({ error: "Parent task must belong to the same project." });
    }
  }

  if (req.body.status !== undefined) {
    if (typeof req.body.status !== 'string' || req.body.status.trim() === '' || req.body.status.length > 50) {
      return res.status(400).json({ error: "Invalid task status." });
    }
    const targetProjId = req.body.projectId !== undefined ? req.body.projectId : task.projectId;
    if (targetProjId) {
      const colRow = await db.get("SELECT columnsJson FROM project_columns WHERE projectId = ?", targetProjId);
      if (colRow && colRow.columnsJson) {
        try {
          const parsedCols = JSON.parse(colRow.columnsJson);
          if (Array.isArray(parsedCols) && parsedCols.length > 0) {
            const validIds = new Set(parsedCols.map((c: any) => c.id || c.name));
            if (!validIds.has(req.body.status)) {
              return res.status(400).json({ error: "Specified status is not a valid column in this project." });
            }
          }
        } catch (e) {
          // ignore column json parse error fallback
        }
      }
    }
  }

  const updated: Task = {
    id: task.id,
    title: req.body.title !== undefined ? String(req.body.title).trim() : task.title,
    description: req.body.description !== undefined ? String(req.body.description || '') : task.description,
    status: req.body.status !== undefined ? String(req.body.status) : task.status,
    priority: req.body.priority !== undefined ? String(req.body.priority) : task.priority,
    deadline: req.body.deadline !== undefined ? String(req.body.deadline) : task.deadline,
    assigneeId: req.body.assigneeId !== undefined ? (req.body.assigneeId || null) : task.assigneeId,
    creatorId: task.creatorId,
    branchName: req.body.branchName !== undefined ? (req.body.branchName || null) : task.branchName,
    parentId: req.body.parentId !== undefined ? (req.body.parentId || null) : task.parentId,
    projectId: req.body.projectId !== undefined ? (req.body.projectId || null) : task.projectId,
    milestoneId: req.body.milestoneId !== undefined ? (req.body.milestoneId || null) : task.milestoneId,
    createdAt: task.createdAt,
    orderIndex: req.body.orderIndex !== undefined ? Number(req.body.orderIndex) : task.orderIndex,
    prUrl: task.prUrl,
    prStatus: task.prStatus
  };

  if (updated.status === 'done') {
    // Check if there are pending dependencies
    let depIds = [];
    if (req.body.dependencies !== undefined && Array.isArray(req.body.dependencies)) {
       depIds = req.body.dependencies;
    } else {
       const rows = await db.all("SELECT blockedByTaskId FROM task_dependencies WHERE taskId = ?", updated.id);
       depIds = rows.map((r: any) => r.blockedByTaskId);
    }
    
    if (depIds.length > 0) {
      const placeholders = depIds.map(() => '?').join(',');
      const pendingDeps = await db.all(`SELECT id FROM tasks WHERE id IN (${placeholders}) AND status != 'done'`, depIds);
      if (pendingDeps.length > 0) {
        return res.status(400).json({ error: `Cannot mark task as done. ${pendingDeps.length} dependencies are still pending.` });
      }
    }
  }

  await db.run(
    "UPDATE tasks SET title=?, description=?, status=?, priority=?, deadline=?, assigneeId=?, branchName=?, parentId=?, projectId=?, milestoneId=?, orderIndex=? WHERE id=?",
    [updated.title, updated.description, updated.status, updated.priority, updated.deadline, updated.assigneeId, updated.branchName, updated.parentId, updated.projectId, updated.milestoneId, updated.orderIndex !== undefined ? updated.orderIndex : task.orderIndex, updated.id]
  );

  if (updated.branchName && updated.projectId) {
    const taskNum = extractTaskNumber(updated.branchName);
    if (taskNum !== null) {
      const proj = await db.get("SELECT taskCounter FROM projects WHERE id = ?", updated.projectId);
      if (proj && taskNum > (proj.taskCounter || 0)) {
        await db.run("UPDATE projects SET taskCounter = ? WHERE id = ?", [taskNum, updated.projectId]);
      }
    }
  }
  
  if (req.body.dependencies !== undefined && Array.isArray(req.body.dependencies)) {
    await db.run("DELETE FROM task_dependencies WHERE taskId = ?", updated.id);
    for (const depId of req.body.dependencies) {
      if (!depId || depId === updated.id) continue;
      const depTask = await db.get("SELECT id, projectId FROM tasks WHERE id = ?", depId);
      if (depTask && depTask.projectId === updated.projectId) {
        await db.run("INSERT INTO task_dependencies (taskId, blockedByTaskId) VALUES (?, ?)", [updated.id, depId]);
      }
    }
  }

  if (updated.parentId) {
    const parentTask = await db.get("SELECT * FROM tasks WHERE id = ? AND projectId = ?", [updated.parentId, updated.projectId]);
    if (parentTask) {
       const subtasks = await db.all("SELECT status FROM tasks WHERE parentId = ? AND projectId = ?", [updated.parentId, updated.projectId]);
       if (subtasks.length > 0) {
           const allDone = subtasks.every((st: any) => st.status === 'done');
           if (allDone && parentTask.status !== 'done') {
               await db.run("UPDATE tasks SET status = 'done' WHERE id = ? AND projectId = ?", [updated.parentId, updated.projectId]);
           } else if (!allDone && parentTask.status === 'done') {
               await db.run("UPDATE tasks SET status = 'in_progress' WHERE id = ? AND projectId = ?", [updated.parentId, updated.projectId]);
           }
       }
    }
  }

  const changes: string[] = [];
  if (task.status !== updated.status) {
    changes.push(`status to ${updated.status}`);
  }
  if (task.assigneeId !== updated.assigneeId) {
    if (updated.assigneeId) {
       const newAssignee = await db.get("SELECT name FROM users WHERE id = ?", updated.assigneeId);
       changes.push(`assigned to ${newAssignee ? newAssignee.name : 'Unknown'}`);
    } else {
       changes.push(`unassigned`);
    }
  }
  if (task.priority !== updated.priority) {
    changes.push(`priority to ${updated.priority}`);
  }
  if (task.title !== updated.title) {
    changes.push(`title`);
  }
  
  let actionStr = "updated task";
  if (changes.length > 0) {
    actionStr = `Updated ${changes.join(', ')}`;
  }
  await logActivity(db, updated.id, req.user.id, actionStr);

  res.json(updated);
});

// Delete Task
router.delete("/api/tasks/:id", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const task = await db.get("SELECT * FROM tasks WHERE id = ?", req.params.id);
  if (!task) return res.sendStatus(404);

  if (task.projectId) {
    const hasProjectAccess = await checkProjectAccess(db, task.projectId, req.user);
    const isAssigneeOrCreator = task.assigneeId === req.user.id || task.creatorId === req.user.id;
    if (!hasProjectAccess && !isAssigneeOrCreator) {
      return res.status(403).json({ error: "Access denied to the project containing this task." });
    }
  }

  let canManageTask = false;
  if (task.projectId) {
    canManageTask = await isProjectAdminOrOwner(db, task.projectId, req.user);
    if (!canManageTask) {
      const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [task.projectId, req.user.id]);
      if (pm && pm.role !== 'viewer') {
        canManageTask = await hasPermission(req.user, "delete_tasks");
      }
    }
  } else {
    canManageTask = isAdminOrSuperAdmin(req.user);
  }

  if (!canManageTask && task.creatorId !== req.user.id) {
    return res.status(403).json({ error: "Only project admins, owners, or the task creator can delete this task." });
  }

  // Get subtasks to cascade delete relations
  const subtasks = await db.all("SELECT id FROM tasks WHERE parentId = ?", req.params.id);
  const allTargetIds = [req.params.id, ...subtasks.map((st: any) => st.id)];

  for (const tid of allTargetIds) {
    await db.run("DELETE FROM task_dependencies WHERE taskId = ? OR blockedByTaskId = ?", [tid, tid]);
    await db.run("DELETE FROM task_comments WHERE taskId = ?", tid);
    await db.run("DELETE FROM task_activities WHERE taskId = ?", tid);
  }

  await db.run("DELETE FROM tasks WHERE parentId = ?", req.params.id);
  await db.run("DELETE FROM tasks WHERE id = ?", req.params.id);
  
  if (task.parentId) {
    const parentTask = await db.get("SELECT * FROM tasks WHERE id = ? AND projectId = ?", [task.parentId, task.projectId]);
    if (parentTask) {
       const remainingSubtasks = await db.all("SELECT status FROM tasks WHERE parentId = ? AND projectId = ?", [task.parentId, task.projectId]);
       if (remainingSubtasks.length > 0) {
           const allDone = remainingSubtasks.every((st: any) => st.status === 'done');
           if (allDone && parentTask.status !== 'done') {
               await db.run("UPDATE tasks SET status = 'done' WHERE id = ? AND projectId = ?", [task.parentId, task.projectId]);
           } else if (!allDone && parentTask.status === 'done') {
               await db.run("UPDATE tasks SET status = 'in_progress' WHERE id = ? AND projectId = ?", [task.parentId, task.projectId]);
           }
       }
    }
  }

  res.json({ success: true });
});

// Generate Branch Name
router.post("/api/tasks/branch", auth, async (req: any, res: any) => {
  try {
    const { title, type, projectId } = req.body;
    let projectKey = "";
    
    if (projectId) {
      const db = await R().getDb();
      if (!(await checkProjectAccess(db, projectId, req.user))) {
        return res.status(403).json({ error: "Access denied to this project." });
      }
      const project = await db.get("SELECT projectKey, taskCounter FROM projects WHERE id = ?", projectId);
      if (project && project.projectKey) {
        const nextNum = (project.taskCounter || 0) + 1;
        projectKey = `${project.projectKey}-${nextNum}`;
      }
    }
    
    if (!projectKey) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const randomLetters = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const nextNumber = Math.floor(Math.random() * 90000) + 10000;
      projectKey = `${randomLetters}-${nextNumber}`;
    }
    
    let branchName = projectKey;
    
    res.json({ branchName });
  } catch (error: any) {
    console.error("Generate branch error:", error);
    res.status(500).json({ error: "Failed to generate branch name." });
  }
});



  return router;
}
