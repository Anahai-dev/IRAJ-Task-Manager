import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useGitFeature } from '../contexts/GitFeatureContext';
import { Project, User } from '../types';
import { FolderKanban, Plus, X, Trash2, Calendar, LayoutDashboard, Activity, Clock, Download, Users, User as UserIcon, GitBranch } from 'lucide-react';
import { safeFormatDate } from '../lib/utils';
import { useNavigate } from 'react-router';
import WorkloadModal from '../components/WorkloadModal';
import ProjectActivityModal from '../components/ProjectActivityModal';
import ProjectMembersModal from '../components/ProjectMembersModal';
import ProjectTeamsModal from '../components/ProjectTeamsModal';
import ProjectGitModal from '../components/ProjectGitModal';
import Markdown from 'react-markdown';
import { exportToCSV, exportToJSON } from '../lib/export';
import { EmptyState } from '../components/EmptyState';
import { fetchAllPages } from '../lib/api';
import { Tooltip } from '../components/Tooltip';

export default function Projects() {
  const { token, user: currentUser } = useAuth();
  const { success, error, info } = useToast();
  const { gitEnabled } = useGitFeature();
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isWorkloadModalOpen, setIsWorkloadModalOpen] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [isProjectTeamsModalOpen, setIsProjectTeamsModalOpen] = useState(false);
  const [isGitModalOpen, setIsGitModalOpen] = useState(false);
  const navigate = useNavigate();
  
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  const handleExportCSV = () => {
    setIsExportMenuOpen(false);
    const exportData = projects.map(p => ({
      ID: p.id,
      Key: p.projectKey || '',
      Name: p.name,
      Description: p.description || '',
      Owner: users.find(u => u.id === p.ownerId)?.name || 'Unknown',
      Created: p.createdAt
    }));
    exportToCSV('projects', exportData);
  };

  const handleExportJSON = () => {
    setIsExportMenuOpen(false);
    exportToJSON('projects', projects);
  };

  const fetchProjects = async () => {
    try {
      const [projectsData, usersData] = await Promise.all([
        fetchAllPages<Project>('/api/projects'),
        fetchAllPages<User>('/api/users'),
      ]);
      setProjects(projectsData);
      setUsers(usersData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchProjects();
  }, [token]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-dim overflow-y-auto">
      <header className="flex-none flex flex-col sm:flex-row sm:items-center justify-between px-4 md:px-6 py-4 border-b border-border-subtle bg-surface-dim gap-3">
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold text-strong tracking-tight">Projects</h1>
          <p className="text-xs text-muted mt-1">Manage all projects and their related tasks</p>
        </div>
        <div className="flex flex-row items-center space-x-3 self-end sm:self-auto">
          <div className="relative">
            <button
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="flex items-center space-x-2 bg-surface text-subtle border border-border-subtle hover:border-blue-500/50 hover:text-strong px-3 py-1.5 rounded transition-all text-xs font-bold uppercase tracking-widest"
            >
              <Download size={14} />
              <span>EXPORT</span>
            </button>
            {isExportMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsExportMenuOpen(false)} />
                <div className="absolute right-0 mt-2 z-50 w-36 bg-surface-dim border border-border-subtle rounded-md shadow-xl py-1">
                  <button 
                    onClick={handleExportCSV}
                    className="w-full text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-subtle hover:bg-surface hover:text-strong"
                  >
                    CSV File
                  </button>
                  <button 
                    onClick={handleExportJSON}
                    className="w-full text-left px-4 py-2 text-xs font-bold uppercase tracking-widest text-subtle hover:bg-surface hover:text-strong"
                  >
                    JSON File
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => {
              setSelectedProject(null);
              setShowCreateModal(true);
            }}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md shadow hover:scale-105 font-bold transition-all text-sm"
          >
            <Plus size={16} />
            <span>New Project</span>
          </button>
        </div>
      </header>
      
      <div className="p-6 flex-1">
        {loading ? (
          <div className="text-subtle text-sm">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="flex-1 flex items-center justify-center h-full min-h-[400px]">
            <EmptyState 
              icon={FolderKanban}
              title="No projects yet"
              description="Create a new project to start organizing tasks and collaborating with your team."
              actionText="New Project"
              onAction={() => {
                setSelectedProject(null);
                setShowCreateModal(true);
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {projects.map(project => {
              const isOwnerOrAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.role === 'manager' || currentUser?.id === project.ownerId;
              
              return (
              <div 
                key={project.id}
                onClick={() => navigate(`/board?projectId=${project.id}`)}
                className="bg-surface border border-border-subtle hover:border-blue-500/50 rounded-lg p-5 transition-all group flex flex-col relative cursor-pointer"
              >
                <div className="flex justify-between items-start mb-3 gap-2">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                      <FolderKanban size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-strong font-medium flex items-center gap-2 truncate">
                        <span className="truncate">{project.name}</span>
                        {project.projectKey && <span className="text-[10px] text-subtle font-mono bg-surface-dim px-1.5 py-0.5 rounded border border-border-subtle shrink-0">{project.projectKey}</span>}
                      </h3>
                      {project.ownerId === currentUser?.id && (
                        <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-bold tracking-wider uppercase inline-block mt-1">OWNER</span>
                      )}
                    </div>
                  </div>
                  {isOwnerOrAdmin && (
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setSelectedProject(project);
                          setShowCreateModal(true);
                        }}
                        className="p-1 text-muted hover:text-blue-400 transition-colors bg-surface-dim hover:bg-blue-500/10 rounded"
                        title="Edit Project"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          e.preventDefault();

                          try {
                            const res = await fetch(`/api/projects/${project.id}`, {
                              method: 'DELETE',
                              headers: { }
                            });
                            if (res.ok) {
                              fetchProjects();
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="p-1 text-muted hover:text-red-400 transition-colors bg-surface-dim hover:bg-red-500/10 rounded"
                        title="Delete Project"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="text-xs text-muted mb-6 flex-1 min-h-[32px] prose dark:prose-invert prose-sm prose-p:my-1 prose-h1:text-sm prose-h2:text-sm prose-h3:text-sm overflow-hidden text-ellipsis line-clamp-2 break-words">
                  {project.description ? (
                    <Markdown>{project.description}</Markdown>
                  ) : (
                    'No description provided.'
                  )}
                </div>
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-4 border-t border-border-subtle gap-3 mt-auto">
                  <div className="flex items-center text-[10px] text-subtle font-medium shrink-0">
                    <Calendar size={12} className="mr-1.5" />
                    {safeFormatDate(project.createdAt, 'MMM d, yyyy')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Tooltip content="Members" position="bottom">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProject(project);
                          setIsMembersModalOpen(true);
                        }}
                        className="flex items-center space-x-1.5 text-xs text-muted hover:text-strong font-medium bg-surface-dim hover:bg-surface-accent px-2.5 py-1.5 rounded transition-colors border border-border-subtle"
                      >
                        <UserIcon size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Teams" position="bottom">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProject(project);
                          setIsProjectTeamsModalOpen(true);
                        }}
                        className="flex items-center space-x-1.5 text-xs text-muted hover:text-strong font-medium bg-surface-dim hover:bg-surface-accent px-2.5 py-1.5 rounded transition-colors border border-border-subtle"
                      >
                        <Users size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Workload" position="bottom">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProject(project);
                          setIsWorkloadModalOpen(true);
                        }}
                        className="flex items-center space-x-1.5 text-xs text-muted hover:text-strong font-medium bg-surface-dim hover:bg-surface-accent px-2.5 py-1.5 rounded transition-colors border border-border-subtle"
                      >
                        <Activity size={14} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Activity logs" position="bottom">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProject(project);
                          setIsActivityModalOpen(true);
                        }}
                        className="flex items-center space-x-1.5 text-xs text-muted hover:text-strong font-medium bg-surface-dim hover:bg-surface-accent px-2.5 py-1.5 rounded transition-colors border border-border-subtle"
                      >
                        <Clock size={14} />
                      </button>
                    </Tooltip>
                    {gitEnabled && (
                      <Tooltip content="Git Repository Hub" position="bottom">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/git?projectId=${project.id}`);
                          }}
                          className="flex items-center space-x-1.5 text-xs text-amber-400 hover:text-amber-300 font-medium bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1.5 rounded transition-colors border border-amber-500/20"
                        >
                          <GitBranch size={14} />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip content="Task Board" position="bottom">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/board?projectId=${project.id}`);
                        }}
                        className="flex items-center space-x-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1.5 rounded transition-colors"
                      >
                        <LayoutDashboard size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            )})}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateProjectModal 
          project={selectedProject}
          onClose={() => {
            setShowCreateModal(false);
            setSelectedProject(null);
          }} 
          onSuccess={() => {
            setShowCreateModal(false);
            setSelectedProject(null);
            fetchProjects();
          }} 
        />
      )}

      {isWorkloadModalOpen && selectedProject && (
        <WorkloadModal
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          onClose={() => {
            setIsWorkloadModalOpen(false);
            setSelectedProject(null);
          }}
        />
      )}

      {isActivityModalOpen && selectedProject && (
        <ProjectActivityModal
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          users={users}
          onClose={() => {
            setIsActivityModalOpen(false);
            setSelectedProject(null);
          }}
        />
      )}

      {isMembersModalOpen && selectedProject && (
        <ProjectMembersModal
          project={selectedProject}
          allUsers={users}
          onClose={() => {
            setIsMembersModalOpen(false);
            setSelectedProject(null);
          }}
        />
      )}

      {isProjectTeamsModalOpen && selectedProject && (
        <ProjectTeamsModal
          project={selectedProject}
          onClose={() => {
            setIsProjectTeamsModalOpen(false);
            setSelectedProject(null);
          }}
        />
      )}

      {isGitModalOpen && selectedProject && (
        <ProjectGitModal
          project={selectedProject}
          onClose={() => {
            setIsGitModalOpen(false);
            setSelectedProject(null);
          }}
          onUpdateProject={(updated) => {
            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
          }}
        />
      )}

    </div>
  );
}

function CreateProjectModal({ project, onClose, onSuccess }: { project?: Project | null, onClose: () => void, onSuccess: () => void }) {
  const { token } = useAuth();
  const [name, setName] = useState(project?.name || '');
  const [projectKey, setProjectKey] = useState(project?.projectKey || '');
  const [description, setDescription] = useState(project?.description || '');
  const [previewMode, setPreviewMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(project ? `/api/projects/${project.id}` : '/api/projects', {
        method: project ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, description, projectKey })
      });
      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to save project. Please try again.');
      }
    } catch (err: any) {
      console.error(err);
      setError('An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-surface border border-border-subtle rounded-lg shadow-2xl w-full max-w-md flex flex-col font-sans">
        <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-page-bg rounded-t-lg">
          <h2 className="text-sm font-bold text-strong uppercase tracking-widest">{project ? 'Edit Project' : 'Create Project'}</h2>
          <button onClick={onClose} className="text-subtle hover:text-red-400 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs mb-4 font-medium">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block mb-2">Project Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
                placeholder="e.g. Frontend Redesign"
                className="w-full bg-surface-dim border border-border-subtle rounded px-3 py-2 text-strong focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
            
            <div>
              <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block mb-1">Project Key (Prefix for branches/tasks)</label>
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs text-muted">Leave empty to auto-generate a 3-letter project key.</p>
                {!project && (
                  <button
                    type="button"
                    onClick={() => {
                      let generatedKey = (name || "PRJ")
                        .split(/\s+/)
                        .map((w: string) => w[0])
                        .join('')
                        .replace(/[^A-Za-z0-9]/g, '')
                        .toUpperCase();
                        
                      if (generatedKey.length < 3) {
                        generatedKey = (name || "PRJ").replace(/[^A-Za-z0-9]/g, '').substring(0, 3).toUpperCase();
                        if (generatedKey.length < 3) {
                           generatedKey = generatedKey.padEnd(3, 'X');
                        }
                      } else if (generatedKey.length > 3) {
                        generatedKey = generatedKey.substring(0, 3);
                      }
                      setProjectKey(generatedKey);
                    }}
                    className="text-[9px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-1 rounded hover:bg-blue-500/20 flex items-center space-x-1 font-bold tracking-wider uppercase transition-colors shrink-0 ml-2"
                  >
                    Generate Prefix
                  </button>
                )}
              </div>
              <input
                type="text"
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                placeholder={project ? project.projectKey : "e.g. FRD (optional)"}
                disabled={!!project}
                className="w-full bg-surface-dim border border-border-subtle rounded px-3 py-2 text-strong focus:outline-none focus:border-blue-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed font-mono"
              />
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-2 shrink-0">
                <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block">Description (Markdown)</label>
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
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Brief description of the project goals... Supports Markdown."
                  className="w-full bg-surface-dim border border-border-subtle rounded px-3 py-2 text-strong font-mono focus:outline-none focus:border-blue-500 resize-none text-sm"
                />
              ) : (
                <div className="w-full h-[96px] overflow-y-auto prose dark:prose-invert prose-sm max-w-none p-4 rounded border border-border-subtle bg-surface-dim text-primary font-sans text-sm">
                  {description ? (
                    <Markdown>{description}</Markdown>
                  ) : (
                    <span className="text-subtle italic">No description provided.</span>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm text-muted hover:text-strong transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-strong rounded text-sm font-medium transition-colors"
            >
              {submitting ? 'Saving...' : (project ? 'Save Changes' : 'Create Project')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
