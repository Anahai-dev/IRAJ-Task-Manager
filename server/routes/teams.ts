import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { R } from "../runtime.ts";
import {
  checkProjectAccess,
  hasPermission,
  isAdminOrSuperAdmin,
} from "../rbac.ts";
import { sanitizeProject } from "../util.ts";

function auth(req: any, res: any, next: any) {
  return R().authenticateToken(req, res, next);
}

export function teamsRouter(): Router {
  const router = Router();

// Teams APIs
router.get("/api/teams", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  let teams;
  if (isAdminOrSuperAdmin(req.user)) {
    teams = await db.all("SELECT * FROM teams");
  } else {
    teams = await db.all(`
      SELECT DISTINCT t.* 
      FROM teams t 
      LEFT JOIN project_members pm ON t.projectId = pm.projectId 
      LEFT JOIN projects p ON t.projectId = p.id
      LEFT JOIN team_members tm ON t.id = tm.teamId
      WHERE t.ownerId = ? 
         OR tm.userId = ? 
         OR (t.projectId IS NOT NULL AND (pm.userId = ? OR p.ownerId = ?))
    `, [req.user.id, req.user.id, req.user.id, req.user.id]);
  }
  res.json(teams);
});

router.post("/api/teams", auth, async (req: any, res: any) => {
  const db = await R().getDb();

  const { name, description, projectId } = req.body;

  if (projectId) {
    const project = await db.get("SELECT ownerId FROM projects WHERE id = ?", projectId);
    const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [projectId, req.user.id]);
    const isProjectAdmin = pm && pm.role === 'admin';
    if (!project || (!isAdminOrSuperAdmin(req.user) && project.ownerId !== req.user.id && !isProjectAdmin)) {
       return res.status(403).json({ error: "Only admins, project owner or project admins can create teams for this project." });
    }
  } else {
    const canManageTeams = await hasPermission(req.user, "manage_teams");
    if (!canManageTeams) {
      return res.status(403).json({ error: "You do not have permission to create global teams." });
    }
  }

  const teamId = uuidv4();
  await db.run(
    "INSERT INTO teams (id, name, description, ownerId, createdAt, projectId) VALUES (?, ?, ?, ?, ?, ?)",
    [teamId, name, description || "", req.user.id, new Date().toISOString(), projectId || null]
  );
  // add owner to members
  await db.run(
    "INSERT INTO team_members (id, teamId, userId, joinedAt) VALUES (?, ?, ?, ?)",
    [uuidv4(), teamId, req.user.id, new Date().toISOString()]
  );
  const newTeam = await db.get("SELECT * FROM teams WHERE id = ?", teamId);
  res.json(newTeam);
});

const checkTeamAccess = async (db: any, teamId: string, user: any): Promise<boolean> => {
  if (isAdminOrSuperAdmin(user)) return true;
  const team = await db.get("SELECT * FROM teams WHERE id = ?", teamId);
  if (!team) return false;
  if (team.ownerId === user.id) return true;
  const tm = await db.get("SELECT 1 FROM team_members WHERE teamId = ? AND userId = ?", [teamId, user.id]);
  if (tm) return true;
  if (team.projectId) {
    return await checkProjectAccess(db, team.projectId, user);
  }
  return false;
};

router.get("/api/teams/:id/members", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkTeamAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to team members." });
  }
  const members = await db.all(`
    SELECT u.id, u.name, u.email, u.role, tm.joinedAt, tm.teamId
    FROM team_members tm
    JOIN users u ON tm.userId = u.id
    WHERE tm.teamId = ?
  `, req.params.id);
  res.json(members);
});

router.post("/api/teams/:id/members", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const { userId } = req.body;
  const teamId = req.params.id;

  const team = await db.get("SELECT * FROM teams WHERE id = ?", teamId);
  if (!team) return res.sendStatus(404);

  if (!isAdminOrSuperAdmin(req.user) && team.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only admins or the team owner can add members." });
  }

  try {
    const newMemberId = uuidv4();
    await db.run(
      "INSERT INTO team_members (id, teamId, userId, joinedAt) VALUES (?, ?, ?, ?)",
      [newMemberId, teamId, userId, new Date().toISOString()]
    );
    res.json({ success: true, memberId: newMemberId });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint failed") || err.code === '23505' || err.message?.includes("duplicate key value")) {
      res.status(400).json({ error: "User is already in team" });
    } else {
      res.status(500).json({ error: "Failed to add member" });
    }
  }
});

router.delete("/api/teams/:id/members/:userId", auth, async (req: any, res: any) => {
  const db = await R().getDb();

  const team = await db.get("SELECT * FROM teams WHERE id = ?", req.params.id);
  if (!team) return res.sendStatus(404);

  if (!isAdminOrSuperAdmin(req.user) && team.ownerId !== req.user.id && req.user.id !== req.params.userId) {
    return res.status(403).json({ error: "Only admins or the team owner can remove members." });
  }

  await db.run("DELETE FROM team_members WHERE teamId = ? AND userId = ?", [req.params.id, req.params.userId]);
  res.json({ success: true });
});

router.get("/api/teams/:id/projects", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  if (!(await checkTeamAccess(db, req.params.id, req.user))) {
    return res.status(403).json({ error: "Access denied to team projects." });
  }
  const projects = await db.all(`
    SELECT p.* 
    FROM projects p
    JOIN team_projects tp ON p.id = tp.projectId
    WHERE tp.teamId = ?
  `, req.params.id);
  res.json(projects.map(sanitizeProject));
});

router.post("/api/teams/:id/projects", auth, async (req: any, res: any) => {
  const db = await R().getDb();

  const team = await db.get("SELECT * FROM teams WHERE id = ?", req.params.id);
  if (!team) return res.sendStatus(404);

  if (!isAdminOrSuperAdmin(req.user)) {
    if (team.ownerId !== req.user.id) {
      return res.status(403).json({ error: "Only admins or the team owner can add projects." });
    }
    const project = await db.get("SELECT ownerId FROM projects WHERE id = ?", req.body.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const pm = await db.get("SELECT role FROM project_members WHERE projectId = ? AND userId = ?", [req.body.projectId, req.user.id]);
    if (project.ownerId !== req.user.id && (!pm || pm.role !== 'admin')) {
      return res.status(403).json({ error: "You must be a project admin or owner to link this project to a team." });
    }
  }

  try {
    await db.run(
      "INSERT INTO team_projects (teamId, projectId) VALUES (?, ?)",
      [req.params.id, req.body.projectId]
    );
    res.json({ success: true });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint failed") || err.code === '23505' || err.message?.includes("duplicate key value")) {
      res.status(400).json({ error: "Project is already in team" });
    } else {
      res.status(500).json({ error: "Failed to add project" });
    }
  }
});

router.delete("/api/teams/:id/projects/:projectId", auth, async (req: any, res: any) => {
  const db = await R().getDb();

  const team = await db.get("SELECT * FROM teams WHERE id = ?", req.params.id);
  if (!team) return res.sendStatus(404);

  if (!isAdminOrSuperAdmin(req.user) && team.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only admins or the team owner can remove projects." });
  }

  await db.run("DELETE FROM team_projects WHERE teamId = ? AND projectId = ?", [req.params.id, req.params.projectId]);
  res.json({ success: true });
});

router.put("/api/teams/:id", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const team = await db.get("SELECT * FROM teams WHERE id = ?", req.params.id);
  if (!team) return res.sendStatus(404);

  const canManageTeams = await hasPermission(req.user, "manage_teams");
  if (!canManageTeams && team.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only team owners, admins, or authorized roles can edit this team." });
  }

  const { name = null, description = null, projectId } = req.body;
  
  if (projectId !== undefined) {
    await db.run(
      "UPDATE teams SET name = COALESCE(?, name), description = COALESCE(?, description), projectId = ? WHERE id = ?",
      [name, description, projectId, req.params.id]
    );
  } else {
    await db.run(
      "UPDATE teams SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?",
      [name, description, req.params.id]
    );
  }
  
  const updatedTeam = await db.get("SELECT * FROM teams WHERE id = ?", req.params.id);
  res.json(updatedTeam);
});

router.delete("/api/teams/:id", auth, async (req: any, res: any) => {
  const db = await R().getDb();
  const team = await db.get("SELECT * FROM teams WHERE id = ?", req.params.id);
  if (!team) return res.sendStatus(404);
  
  const canManageTeams = await hasPermission(req.user, "manage_teams");
  if (!canManageTeams && team.ownerId !== req.user.id) {
    return res.status(403).json({ error: "Only team owners, admins, or authorized roles can delete this team." });
  }

  await db.run("DELETE FROM teams WHERE id = ?", req.params.id);
  await db.run("DELETE FROM team_members WHERE teamId = ?", req.params.id);
  await db.run("DELETE FROM team_projects WHERE teamId = ?", req.params.id);
  res.json({ success: true });
});



  return router;
}
