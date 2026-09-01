import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Team, TeamMember, User, Project } from '../types';
import { Users, Plus, X, Trash2, Shield, FolderKanban, ChevronDown } from 'lucide-react';
import { safeFormatDate } from '../lib/utils';
import Markdown from 'react-markdown';
import UserAvatar from '../components/UserAvatar';
import SearchableSelect from '../components/SearchableSelect';
import { EmptyState } from '../components/EmptyState';
import { fetchAllPages } from '../lib/api';

export default function Teams() {
  const { token, user: currentUser } = useAuth();
  const { success, error, info } = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  
  // Data fetching
  const fetchTeams = async () => {
    try {
      const projectsData = await fetchAllPages<Project>('/api/projects');
      setProjects(projectsData);
      const res = await fetch('/api/teams', {
        headers: { }
      });
      if (res.ok) {
        setTeams(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, [token]);

  return (
    <div className="flex h-full flex-col bg-surface-dim">
      <header className="flex-none flex flex-col sm:flex-row sm:items-center justify-between px-4 md:px-6 py-4 border-b border-border-subtle bg-surface-dim gap-3">
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold text-strong tracking-tight">Teams</h1>
          <p className="text-xs text-muted mt-1">Manage development teams and members</p>
        </div>
        {(currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.role === 'manager') && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md shadow hover:scale-105 font-bold transition-all text-sm self-end sm:self-auto"
          >
            <Plus size={16} />
            <span>New Team</span>
          </button>
        )}
      </header>
      
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Teams List */}
        <div className={`flex flex-col overflow-y-auto p-4 md:p-6 transition-all h-full ${selectedTeam ? 'hidden md:flex md:w-1/3 md:border-r md:border-border-subtle' : 'w-full'}`}>
          {loading ? (
            <div className="text-subtle text-sm">Loading teams...</div>
          ) : teams.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]">
                <EmptyState 
                  icon={Users}
                  title="No teams available"
                  description="There are no development teams available yet. Create a team to organize your members and assign them to projects."
                  actionText={(currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.role === 'manager') ? "New Team" : undefined}
                  onAction={() => setShowCreateModal(true)}
                />
              </div>
          ) : (
            <div className={selectedTeam ? "space-y-3" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"}>
              {teams.map(team => (
                <div 
                  key={team.id}
                  onClick={() => setSelectedTeam(team)}
                  className={`bg-surface border ${selectedTeam?.id === team.id ? 'border-blue-500' : 'border-border-subtle hover:border-border-strong'} rounded-lg p-5 cursor-pointer transition-colors flex flex-col group relative`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-strong font-medium truncate flex-1 min-w-0 pr-2">{team.name}</h3>
                    <div className="flex items-center space-x-2 shrink-0">
                      {team.projectId && (
                        <span className="text-[10px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold truncate max-w-[100px]" title={projects.find(p => p.id === team.projectId)?.name || 'Private Project'}>
                          {projects.find(p => p.id === team.projectId)?.name || 'Private Project'}
                        </span>
                      )}
                      {team.ownerId === currentUser?.id && (
                        <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-bold">OWNER</span>
                      )}
                      {(currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || team.ownerId === currentUser?.id) && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setSelectedTeam(team);
                              setShowCreateModal(true);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-blue-400 transition-colors bg-surface-dim hover:bg-blue-500/10 rounded"
                            title="Edit Team"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              e.preventDefault();

                              try {
                                const res = await fetch(`/api/teams/${team.id}`, {
                                  method: 'DELETE',
                                  headers: { }
                                });
                                if (res.ok) {
                                  if (selectedTeam?.id === team.id) setSelectedTeam(null);
                                  fetchTeams();
                                }
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-red-400 transition-colors bg-surface-dim hover:bg-red-500/10 rounded"
                            title="Delete Team"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted mb-4 flex-1 prose dark:prose-invert prose-sm prose-p:my-1 overflow-hidden text-ellipsis line-clamp-2 break-words text-left">
                    {team.description ? (
                      <Markdown>{team.description}</Markdown>
                    ) : (
                      'No description provided.'
                    )}
                  </div>
                  <div className="text-[10px] text-subtle pt-3 border-t border-border-subtle">
                    Created {safeFormatDate(team.createdAt, 'MMM d, yyyy')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Team Details */}
        {selectedTeam && (
          <div className="flex-1 overflow-y-auto bg-page-bg">
            <TeamDetails 
              team={selectedTeam} 
              onClose={() => setSelectedTeam(null)} 
              onTeamDeleted={() => {
                setSelectedTeam(null);
                fetchTeams();
              }}
            />
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateTeamModal 
          team={selectedTeam}
          onClose={() => {
            setShowCreateModal(false);
            if (!selectedTeam?.id) setSelectedTeam(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            if (!selectedTeam?.id) setSelectedTeam(null);
            fetchTeams();
          }}
        />
      )}
    </div>
  );
}

function CreateTeamModal({ team, onClose, onSuccess }: { team?: Team | null, onClose: () => void, onSuccess: () => void }) {
  const { token, user } = useAuth();
  const [name, setName] = useState(team?.name || '');
  const [description, setDescription] = useState(team?.description || '');
  const [projectId, setProjectId] = useState(team?.projectId || '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [previewMode, setPreviewMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchAllPages<Project>('/api/projects')
      .then(setProjects)
      .catch(console.error);
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(team ? `/api/teams/${team.id}` : '/api/teams', {
        method: team ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, projectId: projectId || undefined })
      });
      if (res.ok) {
        onSuccess();
      } else {
        const err = await res.text();
        alert(`Error saving team: ${err}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-lg shadow-2xl border border-border-subtle w-full max-w-md overflow-hidden flex flex-col">
        <div className="flex justify-between items-center px-5 py-4 border-b border-border-subtle bg-surface-dim">
          <h2 className="text-sm font-bold text-strong uppercase tracking-wider">{team ? 'Edit Team' : 'Create New Team'}</h2>
          <button onClick={onClose} className="text-subtle hover:text-strong transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          {projects.length > 0 && (
            <div>
              <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block mb-2">Assign to Project (Optional)</label>
              <div className="relative">
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full bg-surface border border-border-subtle rounded pl-3 pr-8 py-2 text-strong focus:outline-none focus:border-blue-500 text-sm appearance-none cursor-pointer"
                >
                  <option value="">Global Team (No Project)</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
              <p className="text-xs text-muted mt-1">If a project is selected, only admins or project members can manage this team.</p>
            </div>
          )}
          <div>
            <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block mb-2">Team Name *</label>
            <input
              type="text"
              autoFocus
              className="w-full rounded bg-surface-dim border border-border-subtle px-3 py-2 text-sm text-strong focus:border-blue-500 focus:outline-none"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-2 shrink-0">
              <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block block">Description (Markdown)</label>
              <div className="flex space-x-1 bg-surface-dim border border-border-subtle rounded p-0.5">
                <button
                  type="button"
                  onClick={() => setPreviewMode(false)}
                  className={`px-3 py-1 text-[9px] font-bold rounded-sm uppercase tracking-wider ${!previewMode ? 'bg-surface-accent text-strong' : 'text-subtle hover:text-strong'}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode(true)}
                  className={`px-3 py-1 text-[9px] font-bold rounded-sm uppercase tracking-wider ${previewMode ? 'bg-surface-accent text-strong' : 'text-subtle hover:text-strong'}`}
                >
                  Preview
                </button>
              </div>
            </div>
            
            {!previewMode ? (
              <textarea
                className="w-full rounded bg-surface-dim border border-border-subtle px-3 py-2 text-sm text-strong focus:border-blue-500 focus:outline-none resize-none h-32 font-mono"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Supports Markdown format..."
              />
            ) : (
              <div className="w-full h-32 overflow-y-auto prose dark:prose-invert prose-sm max-w-none p-4 rounded border border-border-subtle bg-surface-dim text-primary font-sans text-sm">
                {description ? (
                  <Markdown>{description}</Markdown>
                ) : (
                  <span className="text-subtle italic">No description provided.</span>
                )}
              </div>
            )}
          </div>
          
          <div className="pt-4 flex justify-end gap-2 border-t border-border-subtle mt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-muted hover:text-strong transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-strong rounded transition-colors"
            >
              {submitting ? 'Saving...' : (team ? 'Save Changes' : 'Create Team')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TeamDetails({ team, onClose, onTeamDeleted }: { team: Team, onClose: () => void, onTeamDeleted: () => void }) {
  const { token, user: currentUser } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamProjects, setTeamProjects] = useState<Project[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [userToAdd, setUserToAdd] = useState('');
  const [projectToAdd, setProjectToAdd] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [addingProject, setAddingProject] = useState(false);

  const isAdminOrOwner = currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.id === team.ownerId;

  const fetchData = async () => {
    setLoading(true);
    try {
      const [membersRes, usersData, teamProjectsRes, allProjectsData] = await Promise.all([
        fetch(`/api/teams/${team.id}/members`, { headers: { } }),
        fetchAllPages<User>('/api/users'),
        fetch(`/api/teams/${team.id}/projects`, { headers: { } }),
        fetchAllPages<Project>('/api/projects')
      ]);
      
      if (membersRes.ok && teamProjectsRes.ok) {
        setMembers(await membersRes.json());
        setAllUsers(usersData);
        setTeamProjects(await teamProjectsRes.json());
        setAllProjects(allProjectsData);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [team.id]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToAdd) return;
    setAddingUser(true);
    try {
      const res = await fetch(`/api/teams/${team.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userToAdd })
      });
      if (res.ok) {
        setUserToAdd('');
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAddingUser(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {

    try {
      const res = await fetch(`/api/teams/${team.id}/members/${userId}`, {
        method: 'DELETE',
        headers: { }
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectToAdd) return;
    setAddingProject(true);
    try {
      const res = await fetch(`/api/teams/${team.id}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projectToAdd })
      });
      if (res.ok) {
        setProjectToAdd('');
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAddingProject(false);
    }
  };

  const handleRemoveProject = async (projectId: string) => {

    try {
      const res = await fetch(`/api/teams/${team.id}/projects/${projectId}`, {
        method: 'DELETE',
        headers: { }
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTeam = async () => {

    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: 'DELETE',
        headers: { }
      });
      if (res.ok) {
        onTeamDeleted();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const availableUsers = allUsers.filter(u => !members.some(m => m.id === u.id));
  const availableProjects = allProjects.filter(p => !teamProjects.some(tp => tp.id === p.id));

  return (
    <div className="flex flex-col h-full bg-surface-dim">
      <div className="flex justify-between items-center p-6 border-b border-border-subtle">
        <div>
          <h2 className="text-xl font-semibold text-strong">{team.name}</h2>
          <p className="text-xs text-muted mt-1">Created on {safeFormatDate(team.createdAt, 'MMM d, yyyy')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdminOrOwner && (
            <button
              onClick={handleDeleteTeam}
              className="text-red-500 hover:text-red-400 hover:bg-red-500/10 p-2 rounded transition-colors"
              title="Delete Team"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button onClick={onClose} className="text-subtle hover:text-strong p-2 rounded transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>
      
      <div className="p-6 space-y-8 flex-1 overflow-y-auto">
        {team.description && (
          <section>
            <h3 className="text-[10px] font-bold text-subtle uppercase tracking-widest mb-3 border-b border-border-subtle pb-1">Description</h3>
            <div className="prose dark:prose-invert prose-sm max-w-none text-primary">
              <Markdown>{team.description}</Markdown>
            </div>
          </section>
        )}

        <section>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[10px] font-bold text-subtle uppercase tracking-widest flex items-center">
              <FolderKanban size={12} className="mr-2" />
              Projects ({teamProjects.length})
            </h3>
          </div>

          <div className="bg-surface rounded-lg border border-border-subtle">
            {loading ? (
              <div className="p-4 text-sm text-subtle text-center">Loading projects...</div>
            ) : teamProjects.length === 0 ? (
              <div className="p-6 text-sm text-subtle text-center">No projects assigned yet.</div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {teamProjects.map((project, index) => (
                  <li key={project.id} className={`flex justify-between items-center p-4 hover:bg-surface-dim transition-colors ${index === 0 ? 'rounded-t-lg' : ''} ${(index === teamProjects.length - 1 && !isAdminOrOwner) ? 'rounded-b-lg' : ''}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                        <FolderKanban size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-strong flex items-center gap-2 truncate">
                          <span className="truncate">{project.name}</span>
                          {project.projectKey && <span className="text-[10px] text-subtle font-mono bg-surface-dim px-1.5 py-0.5 rounded border border-border-subtle shrink-0">{project.projectKey}</span>}
                        </div>
                      </div>
                    </div>
                    {isAdminOrOwner && (
                      <button
                        onClick={() => handleRemoveProject(project.id)}
                        className="text-subtle hover:text-red-400 p-2 rounded transition-colors text-xs shrink-0 ml-4"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            
            {isAdminOrOwner && availableProjects.length > 0 && (
              <div className="p-4 bg-page-bg border-t border-border-subtle rounded-b-lg">
                <form onSubmit={handleAddProject} className="flex gap-2">
                  <SearchableSelect
                    options={availableProjects.map(p => ({
                      id: p.id,
                      label: p.name,
                      subLabel: p.projectKey ? `(${p.projectKey})` : undefined
                    }))}
                    value={projectToAdd}
                    onChange={setProjectToAdd}
                    placeholder="Select a project to add..."
                    placement="top"
                  />
                  <button
                    type="submit"
                    disabled={!projectToAdd || addingProject}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-strong px-4 py-2 rounded text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    {addingProject ? 'Adding...' : 'Add Project'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[10px] font-bold text-subtle uppercase tracking-widest flex items-center">
              <Users size={12} className="mr-2" />
              Members ({members.length})
            </h3>
          </div>

          <div className="bg-surface rounded-lg border border-border-subtle">
            {loading ? (
              <div className="p-4 text-sm text-subtle text-center">Loading members...</div>
            ) : members.length === 0 ? (
              <div className="p-6 text-sm text-subtle text-center">No members yet.</div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {members.map((member, index) => (
                  <li key={member.id} className={`flex justify-between items-center p-4 hover:bg-surface-dim transition-colors ${index === 0 ? 'rounded-t-lg' : ''} ${(index === members.length - 1 && !isAdminOrOwner) ? 'rounded-b-lg' : ''}`}>
                    <div className="flex items-center gap-3">
                      <UserAvatar user={member} showTooltip={false} />
                      <div>
                        <div className="text-sm font-medium text-strong flex items-center gap-2 flex-wrap">
                          {member.name}
                          {member.id === team.ownerId && (
                            <Shield size={12} className="text-blue-400" />
                          )}
                          {member.status && member.status !== "Available" && (
                            <span className="text-[9px] font-medium text-subtle px-1.5 py-0.5 bg-surface-dim border border-border-subtle rounded">
                              {member.status}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted">{member.email} • {member.role}</div>
                      </div>
                    </div>
                    {isAdminOrOwner && member.id !== team.ownerId && (
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        className="text-subtle hover:text-red-400 p-2 rounded transition-colors text-xs"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            
            {isAdminOrOwner && availableUsers.length > 0 && (
              <div className="p-4 bg-page-bg border-t border-border-subtle rounded-b-lg">
                <form onSubmit={handleAddMember} className="flex gap-2 items-start">
                  <SearchableSelect
                    options={availableUsers.map(u => ({
                      id: u.id,
                      label: u.name,
                      subLabel: u.email
                    }))}
                    value={userToAdd}
                    onChange={setUserToAdd}
                    placeholder="Select a user to add..."
                    placement="top"
                  />
                  <button
                    type="submit"
                    disabled={!userToAdd || addingUser}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-strong px-4 py-2 rounded text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    {addingUser ? 'Adding...' : 'Add Member'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
