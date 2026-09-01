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
import { extractTaskNumber, mapPrStatusToBoardColumn, sanitizeProject, sanitizeGitProviderError } from "../util.ts";
import { buildPageInfo, parsePageParams, sendPaginated } from "../pagination.ts";
import * as github from "../git/github.ts";
import * as gitlab from "../git/gitlab.ts";

function auth(req: any, res: any, next: any) {
  return R().authenticateToken(req, res, next);
}

export function projectsRouter(): Router {
  const router = Router();

// Projects APIs
router.get("/api/projects/:id/workload", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to project workload." });
  }
  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.sendStatus(404);

  const tasks = await db.all("SELECT id, status, assigneeId FROM tasks WHERE projectId = ?", req.params.id);
  const assigneeIds = Array.from(new Set(tasks.map((t: any) => t.assigneeId).filter(Boolean)));
  let users: any[] = [];
  if (assigneeIds.length > 0) {
    const placeholders = assigneeIds.map(() => '?').join(',');
    users = await db.all(`SELECT id, name, email FROM users WHERE id IN (${placeholders})`, assigneeIds);
  }

  const workload: Record<string, any> = {};
  
  tasks.forEach((task: any) => {
    if (!task.assigneeId) return; 
    if (!workload[task.assigneeId]) {
      const user = users.find(u => u.id === task.assigneeId);
      workload[task.assigneeId] = {
        user: user || { id: task.assigneeId, name: 'Unknown User', email: '' },
        total: 0,
        statuses: {}
      };
    }
    workload[task.assigneeId].total++;
    const s = task.status || 'todo';
    if (!workload[task.assigneeId].statuses[s]) {
      workload[task.assigneeId].statuses[s] = 0;
    }
    workload[task.assigneeId].statuses[s]++;
  });

  const result = Object.values(workload).map((w: any) => {
    // For legacy 'done' logic calculation where custom boards might use something else, we take 'done' if present, otherwise 0
    const doneCount = w.statuses['done'] || 0;
    return {
      ...w,
      completionPercentage: w.total > 0 ? Math.round((doneCount / w.total) * 100) : 0
    };
  }).sort((a: any, b: any) => b.total - a.total);

  res.json(result);
});

const sanitizeProject = (project: any) => {
  if (!project) return project;
  const sanitized = { ...project };
  if (sanitized.repoToken && sanitized.repoToken.trim() !== '') {
    sanitized.repoToken = '••••••••';
  } else {
    sanitized.repoToken = '';
  }
  return sanitized;
};

router.get("/api/projects", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const { page, pageSize, offset } = parsePageParams(req.query, R().config.pagination);
  let projects;
  let total = 0;
  if (isAdminOrSuperAdmin(req.user)) {
    const countRow = await db.get<{ count: number | string }>("SELECT COUNT(*) as count FROM projects");
    total = Number(countRow?.count || 0);
    projects = await db.all("SELECT * FROM projects ORDER BY createdAt DESC LIMIT ? OFFSET ?", [pageSize, offset]);
  } else {
    const countRow = await db.get<{ count: number | string }>(
      `SELECT COUNT(DISTINCT p.id) as count
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.projectId
      LEFT JOIN team_projects tp ON p.id = tp.projectId
      LEFT JOIN team_members tm ON tp.teamId = tm.teamId
      WHERE p.ownerId = ? OR pm.userId = ? OR tm.userId = ?`,
      [req.user.id, req.user.id, req.user.id]
    );
    total = Number(countRow?.count || 0);
    projects = await db.all(
      `
      SELECT DISTINCT p.*
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.projectId
      LEFT JOIN team_projects tp ON p.id = tp.projectId
      LEFT JOIN team_members tm ON tp.teamId = tm.teamId
      WHERE p.ownerId = ?
         OR pm.userId = ?
         OR tm.userId = ?
      ORDER BY p.createdAt DESC
      LIMIT ? OFFSET ?
    `,
      [req.user.id, req.user.id, req.user.id, pageSize, offset]
    );
  }
  sendPaginated(res, projects.map(sanitizeProject), buildPageInfo(total, page, pageSize));
});

router.get("/api/projects/:id", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const hasAccess = await checkProjectAccess(db, req.params.id, req.user);
  if (!hasAccess) {
    return res.status(403).json({ error: "Access denied to project." });
  }

  res.json(sanitizeProject(project));
});

router.post("/api/projects", auth, async (req: any, res: any) => {
  const canCreate = await hasPermission(req.user, "manage_projects") || isAdminOrSuperAdmin(req.user);
  if (!canCreate) {
    return res.status(403).json({ error: "You do not have permission to create projects." });
  }

  const db = await R().getDb();

  const { name, description, projectKey: customProjectKey } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: "Project name is required" });
  }

  const projectId = uuidv4();
  
  let projectKey = customProjectKey ? customProjectKey.replace(/[^a-zA-Z0-9-]/g, '').toUpperCase() : null;
  
  if (!projectKey) {
    if (name) {
      projectKey = name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase();
    }
    if (!projectKey || projectKey.length < 2) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      projectKey = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }
  }

  try {
    if (db.isPg) {
      await db.run(
        "INSERT INTO projects (id, name, description, ownerId, projectKey, taskCounter, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [projectId, name, description || "", req.user.id, projectKey, 0, new Date().toISOString()]
      );
      await db.run(
        "INSERT INTO project_members (projectId, userId, role, joinedAt) VALUES (?, ?, 'admin', ?) ON CONFLICT (projectId, userId) DO NOTHING",
        [projectId, req.user.id, new Date().toISOString()]
      );
    } else {
      await db.run(
        "INSERT INTO projects (id, name, description, ownerId, projectKey, taskCounter, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [projectId, name, description || "", req.user.id, projectKey, 0, new Date().toISOString()]
      );
      await db.run(
        "INSERT INTO project_members (projectId, userId, role, joinedAt) VALUES (?, ?, 'admin', ?)",
        [projectId, req.user.id, new Date().toISOString()]
      );
    }
    
    const newProject = await db.get("SELECT * FROM projects WHERE id = ?", projectId);
    res.json(sanitizeProject(newProject));
  } catch (err: any) {
    console.error("Error creating project:", err);
    res.status(500).json({ error: err?.message || "Failed to create project" });
  }
});

// Get Project Activity
router.get("/api/projects/:id/activity", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to project activity." });
  }
  
  const activities = await db.all(`
    SELECT a.*, t.title as taskTitle
    FROM task_activities a
    JOIN tasks t ON a.taskId = t.id
    WHERE t.projectId = ?
    ORDER BY a.createdAt DESC
    LIMIT ${R().config.git.projectActivityLimit}
  `, req.params.id);
  
  res.json(activities);
});

router.put("/api/projects/:id", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied: user is not a member of this project." });
  }

  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.sendStatus(404);

  const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [req.params.id, req.user.id]);
  const isProjectAdmin = pm && pm.role === 'admin';

  if (project.ownerId !== req.user.id && !isProjectAdmin && !isAdminOrSuperAdmin(req.user)) {
    return res.status(403).json({ error: "Only project owners, project admins, or system administrators can edit project details." });
  }

  const { name, description } = req.body;
  await db.run(
    "UPDATE projects SET name = ?, description = ? WHERE id = ?",
    [name, description, req.params.id]
  );
  
  const updatedProject = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  res.json(sanitizeProject(updatedProject));
});

// Update Project Repository Settings
router.put("/api/projects/:id/repo", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied: user is not a member of this project." });
  }

  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [req.params.id, req.user.id]);
  const isProjectAdmin = pm && pm.role === 'admin';

  if (project.ownerId !== req.user.id && !isProjectAdmin && !isAdminOrSuperAdmin(req.user)) {
    return res.status(403).json({ error: "Only project owners, project admins, or system administrators can configure repository settings." });
  }

  const { repoProvider, repoOwner, repoName, repoUrl, repoToken, defaultBranch } = req.body;

  let owner = repoOwner || '';
  let name = repoName || '';
  if (repoUrl && (!owner || !name)) {
    try {
      const parsed = new URL(repoUrl);
      const parts = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
      if (parts.length >= 2) {
        owner = owner || parts[0];
        name = name || parts.slice(1).join('/');
      }
    } catch (e) {}
  }

  const rawToken = repoToken !== undefined && repoToken !== '••••••••' ? repoToken : (project.repoToken ? R().decryptSecret(project.repoToken) : '');
  const storedToken = rawToken ? R().encryptSecret(rawToken) : '';

  await db.run(
    `UPDATE projects SET 
      repoProvider = ?, 
      repoOwner = ?, 
      repoName = ?, 
      repoUrl = ?, 
      repoToken = ?, 
      defaultBranch = ? 
     WHERE id = ?`,
    [
      repoProvider || 'github',
      owner,
      name,
      repoUrl || '',
      storedToken,
      defaultBranch || 'main',
      req.params.id
    ]
  );

  const updated = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  res.json(sanitizeProject(updated));
});

// Get Live Branches from GitHub or GitLab for a Project
router.get("/api/projects/:id/git/branches", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to project git branches." });
  }
  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const tasks = await db.all("SELECT id, title, branchName, prUrl, prStatus FROM tasks WHERE projectId = ? AND branchName IS NOT NULL AND branchName != ''", req.params.id);
  const taskBranchMap = new Map();
  tasks.forEach((t: any) => {
    taskBranchMap.set(t.branchName, t);
  });

  const provider = project.repoProvider || 'github';
  const owner = project.repoOwner;
  const name = project.repoName;
  const token = R().decryptSecret(project.repoToken);

  const canUsePat = await isProjectAdminOrOwner(db, req.params.id, req.user);

  if (!owner || !name || !canUsePat) {
    // Fallback: return local task-linked branches
    const localBranches = Array.from(taskBranchMap.entries()).map(([bName, task]: [string, any]) => ({
      name: bName,
      commitSha: 'local',
      commitMessage: `Linked to task: ${task.title}`,
      isDefault: bName === (project.defaultBranch || 'main'),
      linkedTaskId: task.id,
      linkedTaskTitle: task.title,
      prUrl: task.prUrl,
      prStatus: task.prStatus
    }));

    if (localBranches.length === 0) {
      localBranches.push({
        name: project.defaultBranch || 'main',
        commitSha: 'main',
        commitMessage: 'Default branch',
        isDefault: true,
        linkedTaskId: null,
        linkedTaskTitle: null,
        prUrl: null,
        prStatus: null
      });
    }

    return res.json({ branches: localBranches, provider: 'none', configured: false });
  }

  try {
    const defaultBranch = project.defaultBranch || "main";
    const rawBranches =
      provider === "gitlab"
        ? await gitlab.listGitlabBranches({ owner, name, token, defaultBranch })
        : await github.listGithubBranches({ owner, name, token, defaultBranch });
    const branches = rawBranches.map((b) => {
      const linkedTask = taskBranchMap.get(b.name);
      return {
        ...b,
        linkedTaskId: linkedTask?.id,
        linkedTaskTitle: linkedTask?.title,
        prUrl: linkedTask?.prUrl,
        prStatus: linkedTask?.prStatus,
      };
    });
    return res.json({ branches, provider, configured: true });
  } catch (err: any) {
    console.error("Git API error:", err.message);
    const safeError = sanitizeGitProviderError(err);
    // Return graceful fallback with error notice
    const localBranches = Array.from(taskBranchMap.entries()).map(([bName, task]: [string, any]) => ({
      name: bName,
      commitSha: 'local',
      commitMessage: `Linked to task: ${task.title}`,
      isDefault: bName === (project.defaultBranch || 'main'),
      linkedTaskId: task.id,
      linkedTaskTitle: task.title,
      prUrl: task.prUrl,
      prStatus: task.prStatus
    }));

    return res.json({ 
      branches: localBranches, 
      provider, 
      configured: true, 
      error: safeError 
    });
  }
});

// Create Branch on Remote GitHub or GitLab Repository
router.post("/api/projects/:id/git/branches", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to project git branches." });
  }
  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const { branchName, taskId, baseBranch } = req.body;
  if (!branchName) return res.status(400).json({ error: "Branch name is required" });

  if (taskId) {
    const task = await db.get("SELECT projectId FROM tasks WHERE id = ?", taskId);
    if (!task || task.projectId !== req.params.id) {
      return res.status(400).json({ error: "Specified task does not belong to this project." });
    }
    const taskAccess = await checkTaskAccess(db, taskId, req.user);
    if (!taskAccess.allowed) {
      return res.status(403).json({ error: "Access denied to specified task." });
    }
  }

  const targetBaseBranch = baseBranch || project.defaultBranch || 'main';
  const provider = project.repoProvider || 'github';
  const owner = project.repoOwner;
  const name = project.repoName;
  const token = R().decryptSecret(project.repoToken);

  // Protect against Confused Deputy: only project admins/owners can execute remote Git operations with configured PAT
  if (owner && name && token) {
    const canUsePat = await isProjectAdminOrOwner(db, req.params.id, req.user);
    if (!canUsePat) {
      return res.status(403).json({ error: "Only project administrators or owners can execute remote repository operations using the configured repository token." });
    }
  }

  let remoteCreated = false;
  let remoteUrl = '';
  let remoteError = null;

  if (owner && name && token) {
    try {
      if (provider === 'github') {
        const headers: Record<string, string> = {
          'User-Agent': 'devteam-taskmanager',
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${token}`
        };

        // 1. Get SHA of base branch
        const baseRefRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${targetBaseBranch}`, { headers, signal: AbortSignal.timeout(R().config.git.api.fetchTimeoutMs) });
        if (!baseRefRes.ok) {
          let errMsg = `Failed to find base branch '${targetBaseBranch}' on GitHub`;
          try {
            const errJson = await baseRefRes.json();
            if (errJson.message) {
              errMsg += ` (${errJson.message})`;
            }
          } catch (e) {}
          throw new Error(errMsg);
        }
        const baseRefData = await baseRefRes.json();
        const sha = baseRefData.object.sha;

        // 2. Create ref
        const createRefRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs`, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(R().config.git.api.fetchTimeoutMs),
          body: JSON.stringify({
            ref: `refs/heads/${branchName}`,
            sha
          })
        });

        if (!createRefRes.ok) {
          let errMsg = 'Failed to create branch on GitHub';
          try {
            const createErr = await createRefRes.json();
            errMsg = createErr.message || errMsg;
            if (createErr.errors && Array.isArray(createErr.errors)) {
              const details = createErr.errors.map((e: any) => e.message || JSON.stringify(e)).join(', ');
              errMsg += `: ${details}`;
            }
          } catch (e) {
            try {
              errMsg = await createRefRes.text() || errMsg;
            } catch (inner) {}
          }
          throw new Error(errMsg);
        }

        remoteCreated = true;
        remoteUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree/${encodeURIComponent(branchName)}`;
      } else if (provider === 'gitlab') {
        const gitlabUrl = R().config.oauth.gitlabUrl;
        const encodedProjectPath = encodeURIComponent(`${owner}/${name}`);
        
        const glRes = await fetch(`${gitlabUrl}/api/v4/projects/${encodedProjectPath}/repository/branches`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'PRIVATE-TOKEN': token
          },
          signal: AbortSignal.timeout(R().config.git.api.fetchTimeoutMs),
          body: JSON.stringify({
            branch: branchName,
            ref: targetBaseBranch
          })
        });

        if (!glRes.ok) {
          let errMsg = 'Failed to create branch on GitLab';
          try {
            const glErr = await glRes.json();
            errMsg = glErr.message || glErr.error || errMsg;
          } catch (e) {
            try {
              errMsg = await glRes.text() || errMsg;
            } catch (inner) {}
          }
          throw new Error(errMsg);
        }

        const glData = await glRes.json();
        remoteCreated = true;
        remoteUrl = glData.web_url || `${gitlabUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/-/tree/${encodeURIComponent(branchName)}`;
      }
    } catch (err: any) {
      console.error("Error creating remote branch:", err.message);
      remoteError = sanitizeGitProviderError(err);
    }
  }

  // If a remote repo is configured, but remote branch creation failed, return an error response
  if (owner && name && token && !remoteCreated) {
    return res.status(400).json({
      success: false,
      error: remoteError || "Failed to create remote branch on Git provider. Check your repository token permissions, repository path, and default branch settings."
    });
  }

  // Save branch onto task if taskId provided
  if (taskId) {
    await db.run("UPDATE tasks SET branchName = ? WHERE id = ?", [branchName, taskId]);
    
    const taskNum = extractTaskNumber(branchName);
    if (taskNum !== null) {
      const proj = await db.get("SELECT taskCounter FROM projects WHERE id = ?", req.params.id);
      if (proj && taskNum > (proj.taskCounter || 0)) {
        await db.run("UPDATE projects SET taskCounter = ? WHERE id = ?", [taskNum, req.params.id]);
      }
    }
    
    // Add activity
    const activityId = uuidv4();
    const actionText = remoteCreated 
      ? `created remote branch ${branchName} on ${provider.toUpperCase()}`
      : `linked branch ${branchName} to task`;

    await db.run(
      "INSERT INTO task_activities (id, taskId, userId, action, createdAt) VALUES (?, ?, ?, ?, ?)",
      [activityId, taskId, req.user.id, actionText, new Date().toISOString()]
    );
  }

  res.json({
    success: true,
    branchName,
    remoteCreated,
    remoteUrl,
    remoteError,
    message: remoteCreated ? `Branch '${branchName}' created successfully on ${provider.toUpperCase()}` : `Branch '${branchName}' linked locally`
  });
});

// Create Pull Request / Merge Request for a Task
router.post("/api/projects/:id/git/pull-requests", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to project git pull requests." });
  }
  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const { taskId, sourceBranch, targetBranch, title, description } = req.body;
  if (!sourceBranch) return res.status(400).json({ error: "Source branch is required" });

  if (taskId) {
    const task = await db.get("SELECT projectId FROM tasks WHERE id = ?", taskId);
    if (!task || task.projectId !== req.params.id) {
      return res.status(400).json({ error: "Specified task does not belong to this project." });
    }
    const taskAccess = await checkTaskAccess(db, taskId, req.user);
    if (!taskAccess.allowed) {
      return res.status(403).json({ error: "Access denied to specified task." });
    }
  }

  const baseBranch = targetBranch || project.defaultBranch || 'main';
  const provider = project.repoProvider || 'github';
  const owner = project.repoOwner;
  const name = project.repoName;
  const token = R().decryptSecret(project.repoToken);

  // Protect against Confused Deputy: only project admins/owners can execute remote Git operations with configured PAT
  if (owner && name && token) {
    const canUsePat = await isProjectAdminOrOwner(db, req.params.id, req.user);
    if (!canUsePat) {
      return res.status(403).json({ error: "Only project administrators or owners can execute remote repository operations using the configured repository token." });
    }
  }

  let prUrl = '';
  let prStatus = 'open';
  let isFallback = false;

  if (!owner || !name || !token) {
    isFallback = true;
    // If no token or repo configured, generate web creation URL
    if (provider === 'github') {
      prUrl = `https://github.com/${encodeURIComponent(owner || 'owner')}/${encodeURIComponent(name || 'repo')}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(sourceBranch)}?expand=1`;
    } else {
      const gitlabUrl = R().config.oauth.gitlabUrl;
      prUrl = `${gitlabUrl}/${encodeURIComponent(owner || 'owner')}/${encodeURIComponent(name || 'repo')}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(sourceBranch)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(baseBranch)}`;
    }
  } else {
    try {
      if (provider === 'github') {
        const ghRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`, {
          method: 'POST',
          headers: {
            'User-Agent': 'devteam-taskmanager',
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(R().config.git.api.fetchTimeoutMs),
          body: JSON.stringify({
            title: title || `[Task] ${sourceBranch}`,
            head: sourceBranch,
            base: baseBranch,
            body: description || `Automated Pull Request created from DevTeam TaskManager`
          })
        });

        if (!ghRes.ok) {
          const ghErr = await ghRes.json();
          throw new Error(ghErr.message || 'Failed to create PR on GitHub');
        }

        const ghData = await ghRes.json();
        prUrl = ghData.html_url;
      } else if (provider === 'gitlab') {
        const gitlabUrl = R().config.oauth.gitlabUrl;
        const encodedProjectPath = encodeURIComponent(`${owner}/${name}`);

        const glRes = await fetch(`${gitlabUrl}/api/v4/projects/${encodedProjectPath}/merge_requests`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'PRIVATE-TOKEN': token
          },
          signal: AbortSignal.timeout(R().config.git.api.fetchTimeoutMs),
          body: JSON.stringify({
            title: title || `[Task] ${sourceBranch}`,
            source_branch: sourceBranch,
            target_branch: baseBranch,
            description: description || `Automated Merge Request created from DevTeam TaskManager`
          })
        });

        if (!glRes.ok) {
          const glErr = await glRes.json();
          throw new Error(glErr.message || 'Failed to create Merge Request on GitLab');
        }

        const glData = await glRes.json();
        prUrl = glData.web_url;
      }
    } catch (err: any) {
      console.error("PR Creation error:", err.message);
      isFallback = true;
      // Fallback web URL
      if (provider === 'github') {
        prUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(sourceBranch)}?expand=1`;
      } else {
        const gitlabUrl = R().config.oauth.gitlabUrl;
        prUrl = `${gitlabUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(sourceBranch)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(baseBranch)}`;
      }
    }
  }

  if (taskId) {
    await db.run("UPDATE tasks SET prUrl = ?, prStatus = ? WHERE id = ?", [prUrl, prStatus, taskId]);
    
    // Add activity
    const activityId = uuidv4();
    await db.run(
      "INSERT INTO task_activities (id, taskId, userId, action, createdAt) VALUES (?, ?, ?, ?, ?)",
      [activityId, taskId, req.user.id, `opened Pull Request on ${provider.toUpperCase()}`, new Date().toISOString()]
    );
  }

  res.json({ success: true, prUrl, prStatus, isFallback });
});

// Project Custom Columns Management
router.get("/api/projects/:id/columns", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to project." });
  }
  const row = await db.get("SELECT columnsJson FROM project_columns WHERE projectId = ?", req.params.id);
  if (!row) {
    return res.json({ columns: null });
  }
  try {
    const columns = JSON.parse(row.columnsJson);
    return res.json({ columns });
  } catch (e) {
    return res.json({ columns: null });
  }
});

router.put("/api/projects/:id/columns", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied: user is not a member of this project." });
  }

  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [req.params.id, req.user.id]);
  const isProjectAdmin = pm && (pm.role === 'admin' || pm.role === 'lead');

  if (project.ownerId !== req.user.id && !isProjectAdmin && !isAdminOrSuperAdmin(req.user)) {
    return res.status(403).json({ error: "Permission denied. Only project owners, project admins, or system administrators can modify board column structure." });
  }

  const { columns } = req.body;
  if (!columns || !Array.isArray(columns)) {
    return res.status(400).json({ error: "Columns must be an array." });
  }

  const columnsJson = JSON.stringify(columns);
  const id = uuidv4();
  const now = new Date().toISOString();

  if (db.isPg) {
    await db.run(`
      INSERT INTO project_columns (id, projectId, columnsJson, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (projectId) DO UPDATE SET columnsJson = EXCLUDED.columnsJson, updatedAt = EXCLUDED.updatedAt
    `, [id, req.params.id, columnsJson, now]);
  } else {
    const existing = await db.get("SELECT id FROM project_columns WHERE projectId = ?", req.params.id);
    if (existing) {
      await db.run("UPDATE project_columns SET columnsJson = ?, updatedAt = ? WHERE projectId = ?", [columnsJson, now, req.params.id]);
    } else {
      await db.run("INSERT INTO project_columns (id, projectId, columnsJson, updatedAt) VALUES (?, ?, ?, ?)", [id, req.params.id, columnsJson, now]);
    }
  }

  res.json({ success: true, columns });
});

// Sync and Update Statuses of Pull/Merge Requests of a Project
router.post("/api/projects/:id/git/pull-requests/sync", auth, async (req: any, res: any) => {
  if (!R().config.git.enabled) {
    return res.status(403).json({ error: "Git integration is disabled on this server." });
  }
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to project git pull requests." });
  }
  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const provider = project.repoProvider || 'github';
  const owner = project.repoOwner;
  const name = project.repoName;
  const token = R().decryptSecret(project.repoToken);

  const tasks = await db.all("SELECT id, title, prUrl, prStatus, status FROM tasks WHERE projectId = ? AND prUrl IS NOT NULL AND prUrl != ''", req.params.id);
  if (tasks.length === 0) {
    return res.json({ success: true, message: "No active Pull Requests to sync.", updatedCount: 0 });
  }

  if (!owner || !name || !token) {
    return res.status(400).json({ error: "Repository or authentication credentials are not configured for this project." });
  }

  const canUsePat = await isProjectAdminOrOwner(db, req.params.id, req.user);
  if (!canUsePat) {
    return res.status(403).json({ error: "Only project administrators or owners can execute remote repository sync using the configured token." });
  }

  let updatedCount = 0;
  const errors: string[] = [];

  for (const task of tasks) {
    try {
      let prNumber: string | null = null;
      if (provider === 'github') {
        const match = task.prUrl.match(/\/pull\/(\d+)/);
        if (match) prNumber = match[1];
      } else if (provider === 'gitlab') {
        const match = task.prUrl.match(/\/merge_requests\/(\d+)/);
        if (match) prNumber = match[1];
      }

      if (!prNumber) continue;

      let remotePrStatus = task.prStatus || 'open';
      let remoteMerged = false;

      if (provider === 'github') {
        const headers: Record<string, string> = {
          'User-Agent': 'devteam-taskmanager',
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${token}`
        };
        const ghRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${prNumber}`, { headers, signal: AbortSignal.timeout(R().config.git.api.fetchTimeoutMs) });
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          remoteMerged = ghData.merged || false;
          remotePrStatus = ghData.state; // 'open' or 'closed'
          if (remoteMerged) {
            remotePrStatus = 'merged';
          }
        } else {
          errors.push(`GitHub error for task ${task.title}: ${ghRes.statusText}`);
        }
      } else if (provider === 'gitlab') {
        const gitlabUrl = R().config.oauth.gitlabUrl;
        const encodedProjectPath = encodeURIComponent(`${owner}/${name}`);
        const headers = { 'PRIVATE-TOKEN': token };
        const glRes = await fetch(`${gitlabUrl}/api/v4/projects/${encodedProjectPath}/merge_requests/${prNumber}`, { headers, signal: AbortSignal.timeout(R().config.git.api.fetchTimeoutMs) });
        if (glRes.ok) {
          const glData = await glRes.json();
          const glState = glData.state; // 'opened', 'closed', 'merged', 'locked'
          if (glState === 'opened') {
            remotePrStatus = 'open';
          } else if (glState === 'merged') {
            remotePrStatus = 'merged';
            remoteMerged = true;
          } else if (glState === 'closed') {
            remotePrStatus = 'closed';
          }
        } else {
          errors.push(`GitLab error for task ${task.title}: ${glRes.statusText}`);
        }
      }

      if (remotePrStatus !== task.prStatus) {
        const nextTaskStatus = await mapPrStatusToBoardColumn(
          db,
          req.params.id,
          task.status,
          remotePrStatus
        );

        if (nextTaskStatus !== null) {
          await db.run(
            "UPDATE tasks SET prStatus = ?, status = ? WHERE id = ?",
            [remotePrStatus, nextTaskStatus, task.id]
          );

          const activityId = uuidv4();
          await db.run(
            "INSERT INTO task_activities (id, taskId, userId, action, createdAt) VALUES (?, ?, ?, ?, ?)",
            [activityId, task.id, req.user.id, `synchronized PR status: updated PR to '${remotePrStatus}' and Board Status to '${nextTaskStatus}'`, new Date().toISOString()]
          );
        } else {
          await db.run("UPDATE tasks SET prStatus = ? WHERE id = ?", [remotePrStatus, task.id]);
        }

        updatedCount++;
      }
    } catch (err: any) {
      console.error(`Sync error for task ${task.id}:`, err.message);
      errors.push(`Failed to sync task ${task.title}: ${sanitizeGitProviderError(err)}`);
    }
  }

  res.json({
    success: true,
    updatedCount,
    errors: errors.length > 0 ? errors : null,
    message: `PR sync completed. Updated ${updatedCount} task(s).`
  });
});

router.delete("/api/projects/:id", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied: user is not a member of this project." });
  }

  const project = await db.get("SELECT * FROM projects WHERE id = ?", req.params.id);
  if (!project) return res.sendStatus(404);

  const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [req.params.id, req.user.id]);
  const isProjectAdmin = pm && pm.role === 'admin';

  if (project.ownerId !== req.user.id && !isProjectAdmin && !isAdminOrSuperAdmin(req.user)) {
    return res.status(403).json({ error: "Only project owners, project admins, or system administrators can delete projects." });
  }

  const projectId = req.params.id;
  const projectTasks = await db.all("SELECT id FROM tasks WHERE projectId = ?", projectId);
  if (projectTasks.length > 0) {
    const taskIds = projectTasks.map((t: any) => t.id);
    const placeholders = taskIds.map(() => "?").join(",");
    await db.run(`DELETE FROM task_dependencies WHERE taskId IN (${placeholders}) OR blockedByTaskId IN (${placeholders})`, [...taskIds, ...taskIds]);
    await db.run(`DELETE FROM task_comments WHERE taskId IN (${placeholders})`, taskIds);
    await db.run(`DELETE FROM task_activities WHERE taskId IN (${placeholders})`, taskIds);
    await db.run(`DELETE FROM tasks WHERE id IN (${placeholders})`, taskIds);
  }

  await db.run("DELETE FROM documents WHERE projectId = ?", projectId);
  await db.run("DELETE FROM milestones WHERE projectId = ?", projectId);
  await db.run("DELETE FROM project_members WHERE projectId = ?", projectId);
  await db.run("DELETE FROM team_projects WHERE projectId = ?", projectId);
  await db.run("DELETE FROM projects WHERE id = ?", projectId);
  res.json({ success: true });
});

// Integration Connectivity Status API for GitHub & GitLab
router.get("/api/integrations/status", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  let projects;
  if (isAdminOrSuperAdmin(req.user)) {
    projects = await db.all("SELECT id, name, repoProvider, repoOwner, repoName, repoToken FROM projects");
  } else {
    projects = await db.all(`
      SELECT DISTINCT p.id, p.name, p.repoProvider, p.repoOwner, p.repoName, p.repoToken 
      FROM projects p 
      LEFT JOIN project_members pm ON p.id = pm.projectId 
      LEFT JOIN team_projects tp ON p.id = tp.projectId 
      LEFT JOIN team_members tm ON tp.teamId = tm.teamId 
      WHERE p.ownerId = ? 
         OR pm.userId = ? 
         OR tm.userId = ?
    `, [req.user.id, req.user.id, req.user.id]);
  }

  const githubProjects = projects.filter(p => p.repoProvider === 'github' && p.repoOwner && p.repoName);
  const gitlabProjects = projects.filter(p => p.repoProvider === 'gitlab' && p.repoOwner && p.repoName);

  // Evaluate GitHub (Optional by default)
  let ghStatus = 'disconnected';
  let ghText = 'Not Linked';
  let ghColor = 'slate';
  let ghDetail = 'Optional - No GitHub repository linked';

  if (githubProjects.length > 0) {
    const ghWithToken = githubProjects.filter(p => p.repoToken && p.repoToken.trim() !== '');
    if (ghWithToken.length === githubProjects.length) {
      ghStatus = 'connected';
      ghText = 'Connected';
      ghColor = 'emerald';
      ghDetail = `${githubProjects.length} GitHub ${githubProjects.length === 1 ? 'repo' : 'repos'} connected`;
    } else if (ghWithToken.length > 0) {
      ghStatus = 'connected_partial';
      ghText = 'Partial';
      ghColor = 'emerald';
      ghDetail = `${ghWithToken.length} of ${githubProjects.length} GitHub repos configured`;
    } else {
      ghStatus = 'not_linked';
      ghText = 'Not Linked';
      ghColor = 'slate';
      ghDetail = `Optional - Token not configured for ${githubProjects.length} GitHub repo(s)`;
    }
  }

  // Evaluate GitLab (Optional by default)
  let glStatus = 'disconnected';
  let glText = 'Not Linked';
  let glColor = 'slate';
  let glDetail = 'Optional - No GitLab repository linked';

  if (gitlabProjects.length > 0) {
    const glWithToken = gitlabProjects.filter(p => p.repoToken && p.repoToken.trim() !== '');
    if (glWithToken.length === gitlabProjects.length) {
      glStatus = 'connected';
      glText = 'Connected';
      glColor = 'emerald';
      glDetail = `${gitlabProjects.length} GitLab ${gitlabProjects.length === 1 ? 'repo' : 'repos'} connected`;
    } else if (glWithToken.length > 0) {
      glStatus = 'connected_partial';
      glText = 'Partial';
      glColor = 'emerald';
      glDetail = `${glWithToken.length} of ${gitlabProjects.length} GitLab repos configured`;
    } else {
      glStatus = 'not_linked';
      glText = 'Not Linked';
      glColor = 'slate';
      glDetail = `Optional - Token not configured for ${gitlabProjects.length} GitLab repo(s)`;
    }
  }

  res.json({
    github: {
      provider: 'github',
      name: 'GitHub',
      status: ghStatus,
      label: ghText,
      color: ghColor,
      details: ghDetail,
      count: githubProjects.length,
      repoCount: githubProjects.length,
      hasToken: githubProjects.length > 0 && githubProjects.every(p => p.repoToken && p.repoToken.trim() !== '')
    },
    gitlab: {
      provider: 'gitlab',
      name: 'GitLab',
      status: glStatus,
      label: glText,
      color: glColor,
      details: glDetail,
      count: gitlabProjects.length,
      repoCount: gitlabProjects.length,
      hasToken: gitlabProjects.length > 0 && gitlabProjects.every(p => p.repoToken && p.repoToken.trim() !== '')
    }
  });
});

// Project Members APIs
router.get("/api/projects/:id/members", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkProjectAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to project members." });
  }
  const members = await db.all(`
    SELECT u.id, u.name, u.email, u.role as globalRole, pm.role, pm.joinedAt, pm.projectId
    FROM project_members pm
    JOIN users u ON pm.userId = u.id
    WHERE pm.projectId = ?
  `, req.params.id);
  res.json(members);
});

router.post("/api/projects/:id/members", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const projectId = req.params.id;
  const { userId, role } = req.body;

  const project = await db.get("SELECT * FROM projects WHERE id = ?", projectId);
  if (!project) return res.sendStatus(404);

  const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [projectId, req.user.id]);
  const isProjectAdmin = pm && pm.role === 'admin';

  if (!isAdminOrSuperAdmin(req.user) && project.ownerId !== req.user.id && !isProjectAdmin) {
    return res.status(403).json({ error: "Only admins, project owner or project admins can manage members." });
  }

  const ALLOWED_PROJECT_ROLES = ['admin', 'member', 'viewer', 'contributor', 'lead'];
  const newRole = ALLOWED_PROJECT_ROLES.includes(role) ? role : 'member';

  const targetUser = await db.get("SELECT id FROM users WHERE id = ?", userId);
  if (!targetUser) {
    return res.status(404).json({ error: "User not found." });
  }

  try {
    await db.run(
      "INSERT INTO project_members (projectId, userId, role, joinedAt) VALUES (?, ?, ?, ?) ON CONFLICT(projectId, userId) DO UPDATE SET role = ?",
      [projectId, userId, newRole, new Date().toISOString(), newRole]
    );
    res.json({ success: true });
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint failed") || e.code === 'SQLITE_CONSTRAINT' || e.code === '23505' || e.message?.includes("duplicate key value")) {
      await db.run("UPDATE project_members SET role = ? WHERE projectId = ? AND userId = ?", [newRole, projectId, userId]);
      res.json({ success: true });
    } else {
      res.status(500).json({ error: "Failed to add/update member" });
    }
  }
});

router.delete("/api/projects/:id/members/:userId", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const projectId = req.params.id;

  const project = await db.get("SELECT * FROM projects WHERE id = ?", projectId);
  if (!project) return res.sendStatus(404);

  const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [projectId, req.user.id]);
  const isProjectAdmin = pm && pm.role === 'admin';

  if (!isAdminOrSuperAdmin(req.user) && project.ownerId !== req.user.id && !isProjectAdmin && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: "Only admins, project owner or project admins can remove members." });
  }

  await db.run("DELETE FROM project_members WHERE projectId = ? AND userId = ?", [projectId, req.params.userId]);
  res.json({ success: true });
});


  return router;
}
