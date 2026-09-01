import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Project, GitBranch, Task } from '../types';
import { useSearchParams } from 'react-router';
import { getIncrementedBranchName, getBranchSuggestions } from '../lib/utils';
import { 
  GitBranch as GitBranchIcon, Github, Gitlab, Link as LinkIcon, 
  ExternalLink, Plus, RefreshCw, CheckCircle2, GitPullRequest, 
  Copy, Check, Shield, Key, Layers, Terminal, Search, FolderKanban,
  Code2, AlertCircle, Sparkles, ChevronDown
} from 'lucide-react';
import TaskModal from '../components/TaskModal';
import { apiGet, apiPost, apiPut, fetchAllPages } from '../lib/api';

export default function GitRepositoryPage() {
  const { token, user } = useAuth();
  const { success, error, info } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(searchParams.get('projectId') || '');
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const [activeTab, setActiveTab] = useState<'branches' | 'prs' | 'create' | 'settings'>('branches');
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedBranch, setCopiedBranch] = useState<string | null>(null);
  const [selectedTaskForModal, setSelectedTaskForModal] = useState<Task | null>(null);

  // Settings form state
  const [repoProvider, setRepoProvider] = useState<'github' | 'gitlab'>('github');
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoToken, setRepoToken] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [savingSettings, setSavingSettings] = useState(false);

  // Create branch form state
  const [newBranchName, setNewBranchName] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [creatingBranch, setCreatingBranch] = useState(false);

  // PR Form state
  const [prSourceBranch, setPrSourceBranch] = useState('');
  const [prTargetBranch, setPrTargetBranch] = useState('main');
  const [prTitle, setPrTitle] = useState('');
  const [prDescription, setPrDescription] = useState('');
  const [prTaskId, setPrTaskId] = useState('');
  const [creatingPR, setCreatingPR] = useState(false);
  const [syncingPRs, setSyncingPRs] = useState(false);

  const handleSyncPRs = async () => {
    if (!selectedProjectId) return;
    setSyncingPRs(true);
    try {
      const data = await apiPost<{ success?: boolean; updatedCount?: number; error?: string }>(
        `/api/projects/${selectedProjectId}/git/pull-requests/sync`
      );
      if (data.success) {
        if (data.updatedCount && data.updatedCount > 0) {
          success(`Successfully synchronized PRs! Updated ${data.updatedCount} task(s).`);
        } else {
          info('All Pull Request statuses are already up to date!');
        }
        fetchBranches();
        fetchTasks();
      } else {
        error(data.error || 'Failed to sync PR statuses');
      }
    } catch (err) {
      error('Error syncing Pull Requests');
    } finally {
      setSyncingPRs(false);
    }
  };

  // Fetch all projects
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const data = await fetchAllPages<Project>('/api/projects');
        setProjects(data);
        if (data.length > 0 && !selectedProjectId) {
          setSelectedProjectId(data[0].id);
        }
      } catch (err) {
        console.error("Failed to load projects:", err);
      }
    };
    fetchProjects();
  }, [token]);

  // Sync active project state
  useEffect(() => {
    if (selectedProjectId) {
      const p = projects.find(proj => proj.id === selectedProjectId);
      if (p) {
        setActiveProject(p);
        setRepoProvider(p.repoProvider || 'github');
        setRepoOwner(p.repoOwner || '');
        setRepoName(p.repoName || '');
        setRepoUrl(p.repoUrl || '');
        setRepoToken(p.repoToken || '');
        setDefaultBranch(p.defaultBranch || 'main');
        setBaseBranch(p.defaultBranch || 'main');
        setPrTargetBranch(p.defaultBranch || 'main');
        
        // Update URL search query
        setSearchParams({ projectId: p.id });
      }
    } else if (projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [selectedProjectId, projects]);

  const fetchBranches = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    try {
      const data = await apiGet<{ branches?: GitBranch[]; error?: string }>(
        `/api/projects/${selectedProjectId}/git/branches`
      );
      setBranches(data.branches || []);
      if (data.error) {
        info(`Git notice: ${data.error}`);
      }
    } catch (err: any) {
      console.error("Failed to load branches:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTasks = async () => {
    if (!selectedProjectId) return;
    try {
      const data = await fetchAllPages<Task>(`/api/tasks?projectId=${selectedProjectId}`);
      setTasks(data);
    } catch (err) {
      console.error("Failed to fetch project tasks:", err);
    }
  };

  useEffect(() => {
    if (selectedProjectId) {
      fetchBranches();
      fetchTasks();
    }
  }, [selectedProjectId]);

  const isManagerOrAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'manager' || (activeProject && activeProject.ownerId === user?.id);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      error("No active project selected. Please select a project before saving.");
      return;
    }
    if (!isManagerOrAdmin) {
      error("Permission denied: Only Admins, Managers, or the Project Owner can alter repository integration settings");
      return;
    }
    setSavingSettings(true);
    try {
      const updated = await apiPut<Project>(`/api/projects/${selectedProjectId}/repo`, {
        repoProvider,
        repoOwner,
        repoName,
        repoUrl,
        repoToken,
        defaultBranch
      });

      setActiveProject(updated);
      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
      success('Repository integration configured successfully');
      fetchBranches();
      setActiveTab('branches');
    } catch (err: any) {
      error(err.message || 'Error saving settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      error("No active project selected. Please select a project first.");
      return;
    }
    if (!newBranchName.trim()) {
      error('Branch name is required');
      return;
    }

    setCreatingBranch(true);
    try {
      const data = await apiPost<{ success?: boolean; error?: string; remoteError?: string; message?: string }>(
        `/api/projects/${selectedProjectId}/git/branches`,
        {
          branchName: newBranchName.trim().toUpperCase(),
          taskId: selectedTaskId || null,
          baseBranch
        }
      );

      if (!data.success) {
        throw new Error(data.error || data.remoteError || 'Failed to create branch');
      }

      success(data.message || `Branch '${newBranchName}' created successfully`);
      setNewBranchName('');
      setSelectedTaskId('');
      fetchBranches();
      fetchTasks();
      setActiveTab('branches');
    } catch (err: any) {
      error(err.message || 'Failed to create branch');
    } finally {
      setCreatingBranch(false);
    }
  };

  const handleCreatePR = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProjectId) {
      error("No active project selected. Please select a project first.");
      return;
    }
    if (!prSourceBranch) {
      error('Source branch is required');
      return;
    }

    setCreatingPR(true);
    try {
      const data = await apiPost<{ prUrl?: string; isFallback?: boolean }>(
        `/api/projects/${selectedProjectId}/git/pull-requests`,
        {
          taskId: prTaskId || null,
          sourceBranch: prSourceBranch,
          targetBranch: prTargetBranch || defaultBranch || 'main',
          title: prTitle || `Merge ${prSourceBranch} into ${prTargetBranch || 'main'}`,
          description: prDescription
        }
      );

      if (data.prUrl) {
        window.open(data.prUrl, '_blank');
        if (data.isFallback) {
          info('Credentials unconfigured or API connection failed. Opened web compare page in a new tab for manual creation!');
        } else {
          success('Pull / Merge Request created via API! Link opened in a new tab');
        }
        fetchBranches();
        fetchTasks();
        setPrSourceBranch('');
        setPrTitle('');
        setPrDescription('');
      } else {
        error('Failed to create Pull Request');
      }
    } catch (err) {
      error('Error creating Pull Request');
    } finally {
      setCreatingPR(false);
    }
  };

  const copyCheckoutCommand = (bName: string) => {
    navigator.clipboard.writeText(`git checkout ${bName}`);
    setCopiedBranch(bName);
    setTimeout(() => setCopiedBranch(null), 2000);
    success(`Copied: git checkout ${bName}`);
  };

  const autoGenerateBranchFromTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    const task = tasks.find(t => t.id === taskId);
    if (task && activeProject) {
      const cleanTitle = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30);
      const keyStr = activeProject.projectKey ? `${activeProject.projectKey}-` : '';
      setNewBranchName(`${keyStr}${cleanTitle}`);
    }
  };

  const filteredBranches = branches.filter(b => 
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (b.linkedTaskTitle && b.linkedTaskTitle.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const tasksWithBranches = tasks.filter(t => t.branchName);
  const tasksWithPRs = tasks.filter(t => t.prUrl);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      
      {/* Top Header & Project Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-subtle pb-5">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shadow-sm">
              <Code2 size={24} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-strong tracking-tight flex items-center gap-2">
                <span>Git Repositories & Branch Management</span>
              </h1>
              <p className="text-xs text-muted">
                Seamlessly connect project repositories, create remote branches, and issue Pull Requests
              </p>
            </div>
          </div>
        </div>

        {/* Project Dropdown Selector */}
        <div className="flex items-center space-x-3">
          <label className="text-xs font-bold uppercase tracking-wider text-muted hidden sm:inline">
            Project:
          </label>
          <div className="relative min-w-[220px]">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs font-bold bg-surface border border-border-subtle rounded-xl text-strong focus:outline-none focus:border-blue-500 shadow-sm appearance-none cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} [{p.projectKey || 'PROJ'}]
                </option>
              ))}
            </select>
            <FolderKanban size={14} className="absolute left-3 top-2.5 text-muted pointer-events-none" />
            <ChevronDown size={14} className="absolute right-3 top-2.5 text-muted pointer-events-none" />
          </div>
          
          <button
            onClick={() => setActiveTab('settings')}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-surface border border-border-subtle hover:border-blue-500/50 text-strong rounded-xl transition-all shadow-sm"
          >
            <Key size={14} className="text-blue-400" />
            <span>Config Repo</span>
          </button>
        </div>
      </div>

      {/* Overview Stat Cards */}
      {activeProject && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="p-4 rounded-xl bg-surface border border-border-subtle flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Repository</p>
              <p className="text-sm font-bold text-strong truncate max-w-[170px]">
                {activeProject.repoOwner && activeProject.repoName 
                  ? `${activeProject.repoOwner}/${activeProject.repoName}` 
                  : 'Not Connected'}
              </p>
              <div className="flex items-center gap-1.5 text-[10px]">
                {activeProject.repoOwner ? (
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <CheckCircle2 size={10} /> Connected ({activeProject.repoProvider?.toUpperCase() || 'GIT'})
                  </span>
                ) : (
                  <span className="text-subtle font-medium flex items-center gap-1">
                    <CheckCircle2 size={10} className="text-blue-400" /> Local Git Mode (Remote Optional)
                  </span>
                )}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-surface-dim border border-border-subtle text-muted">
              {activeProject.repoProvider === 'gitlab' ? <Gitlab size={20} className="text-amber-400" /> : <Github size={20} className="text-blue-400" />}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-border-subtle flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Active Branches</p>
              <p className="text-xl font-bold text-strong">{branches.length}</p>
              <p className="text-[10px] text-muted">Default: <code className="text-blue-400">{activeProject.defaultBranch || 'main'}</code></p>
            </div>
            <div className="p-3 rounded-lg bg-surface-dim border border-border-subtle text-blue-400">
              <GitBranchIcon size={20} />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-border-subtle flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Tasks with Branch</p>
              <p className="text-xl font-bold text-strong">{tasksWithBranches.length}</p>
              <p className="text-[10px] text-muted">Out of {tasks.length} total tasks</p>
            </div>
            <div className="p-3 rounded-lg bg-surface-dim border border-border-subtle text-indigo-400">
              <Layers size={20} />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-surface border border-border-subtle flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Open PRs / MRs</p>
              <p className="text-xl font-bold text-strong">{tasksWithPRs.length}</p>
              <p className="text-[10px] text-muted">Linked to project tasks</p>
            </div>
            <div className="p-3 rounded-lg bg-surface-dim border border-border-subtle text-purple-400">
              <GitPullRequest size={20} />
            </div>
          </div>

        </div>
      )}

      {/* Main Tabs Navigation */}
      <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
        <div className="flex border-b border-border-subtle bg-surface-dim px-4 space-x-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('branches')}
            className={`flex items-center space-x-2 px-4 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'branches' 
                ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                : 'border-transparent text-muted hover:text-strong'
            }`}
          >
            <GitBranchIcon size={14} />
            <span>Branches ({branches.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('prs')}
            className={`flex items-center space-x-2 px-4 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'prs' 
                ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                : 'border-transparent text-muted hover:text-strong'
            }`}
          >
            <GitPullRequest size={14} />
            <span>Pull / Merge Requests</span>
          </button>

          <button
            onClick={() => setActiveTab('create')}
            className={`flex items-center space-x-2 px-4 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'create' 
                ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                : 'border-transparent text-muted hover:text-strong'
            }`}
          >
            <Plus size={14} />
            <span>Create Branch</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center space-x-2 px-4 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'settings' 
                ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                : 'border-transparent text-muted hover:text-strong'
            }`}
          >
            <Key size={14} />
            <span>Repository Integration</span>
            {!isManagerOrAdmin && (
              <span title="Restricted to Managers & Admins">
                <Shield size={12} className="text-amber-400 ml-1" />
              </span>
            )}
          </button>
        </div>

        {/* TAB CONTENTS */}
        <div className="p-6">
          
          {/* TAB 1: BRANCHES */}
          {activeTab === 'branches' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search branches or task titles..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                  />
                  <Search size={14} className="absolute left-3 top-2.5 text-muted" />
                </div>

                <div className="flex items-center space-x-2 self-end sm:self-auto">
                  <button
                    onClick={fetchBranches}
                    disabled={loading}
                    className="flex items-center space-x-1.5 px-3 py-2 text-xs text-muted hover:text-strong border border-border-subtle rounded-lg hover:bg-surface-dim transition-all"
                  >
                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                    <span>Refresh</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('create')}
                    className="flex items-center space-x-1.5 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-sm"
                  >
                    <Plus size={14} />
                    <span>New Branch</span>
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="py-16 text-center text-xs text-muted flex flex-col items-center gap-2">
                  <RefreshCw size={28} className="animate-spin text-blue-500" />
                  <span>Syncing branches from remote repository...</span>
                </div>
              ) : filteredBranches.length === 0 ? (
                <div className="py-16 border border-dashed border-border-subtle rounded-xl text-center space-y-3 p-6">
                  <GitBranchIcon size={36} className="mx-auto text-muted/50" />
                  <p className="text-sm font-bold text-strong">No branches found</p>
                  <p className="text-xs text-muted max-w-md mx-auto">
                    {searchQuery ? 'No branches matched your search query.' : 'No active branches found for this repository. Create a new branch directly linked to your project tasks.'}
                  </p>
                  <button
                    onClick={() => setActiveTab('create')}
                    className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-md"
                  >
                    <Plus size={14} />
                    <span>Create Branch</span>
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-border-subtle border border-border-subtle rounded-lg overflow-hidden bg-surface-dim">
                  {filteredBranches.map((b) => (
                    <div 
                      key={b.name}
                      className="flex flex-col md:flex-row md:items-center justify-between p-4 hover:bg-surface transition-colors gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span className="font-mono text-sm font-bold text-blue-400 flex items-center gap-1.5">
                            <GitBranchIcon size={14} className="text-blue-500" />
                            {b.name}
                          </span>

                          {b.isDefault && (
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              DEFAULT
                            </span>
                          )}

                          {b.protected && (
                            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                              <Shield size={10} /> Protected
                            </span>
                          )}

                          {b.commitSha && b.commitSha !== 'local' && (
                            <span className="font-mono text-[10px] text-muted px-1.5 py-0.5 bg-slate-800 rounded">
                              {b.commitSha}
                            </span>
                          )}
                        </div>

                        {b.linkedTaskTitle ? (
                          <div className="text-xs text-subtle flex items-center gap-1.5 flex-wrap">
                            <Layers size={12} className="text-muted" />
                            <span>Task:</span>
                            <button
                              onClick={() => {
                                const t = tasks.find(tk => tk.id === b.linkedTaskId);
                                if (t) setSelectedTaskForModal(t);
                              }}
                              className="font-semibold text-strong hover:text-blue-400 underline text-left"
                            >
                              {b.linkedTaskTitle}
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-muted italic">Unlinked repository branch</p>
                        )}

                        {b.commitMessage && (
                          <div className="text-[11px] text-muted font-mono mt-1 flex items-center gap-1.5 bg-slate-900/40 rounded px-2 py-1 border border-border-subtle/30 max-w-lg">
                            <span className="text-blue-500 font-bold">&gt;</span>
                            <span className="truncate">{b.commitMessage}</span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center space-x-2 self-end md:self-auto">
                        <button
                          onClick={() => copyCheckoutCommand(b.name)}
                          title="Copy Git checkout command"
                          className="flex items-center space-x-1 px-2.5 py-1.5 text-xs text-muted hover:text-strong bg-surface border border-border-subtle hover:border-slate-600 rounded-md transition-all"
                        >
                          {copiedBranch === b.name ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          <span className="font-mono text-[11px]">checkout</span>
                        </button>

                        <button
                          onClick={() => {
                            setPrSourceBranch(b.name);
                            setPrTaskId(b.linkedTaskId || '');
                            setPrTitle(`[${activeProject?.projectKey || 'TASK'}] Merge ${b.name}`);
                            setActiveTab('prs');
                          }}
                          className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-md transition-all"
                        >
                          <GitPullRequest size={12} />
                          <span>Open PR</span>
                        </button>

                        {b.webUrl && (
                          <a
                            href={b.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-muted hover:text-strong hover:bg-surface rounded-md transition-colors"
                            title="Open on GitHub/GitLab"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PULL / MERGE REQUESTS */}
          {activeTab === 'prs' && (
            <div className="space-y-6">
              
              {/* Quick PR Creator Form */}
              <form onSubmit={handleCreatePR} className="p-5 rounded-xl border border-border-subtle bg-surface-dim space-y-4">
                <h3 className="text-sm font-bold text-strong flex items-center gap-2">
                  <GitPullRequest size={16} className="text-blue-400" />
                  <span>Create New Pull / Merge Request</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                      Source Branch *
                    </label>
                    <input
                      type="text"
                      value={prSourceBranch}
                      onChange={(e) => setPrSourceBranch(e.target.value)}
                      placeholder="e.g. PROJ-101-login"
                      required
                      className="w-full px-3 py-2 text-xs font-mono bg-surface border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                      Target Branch
                    </label>
                    <input
                      type="text"
                      value={prTargetBranch}
                      onChange={(e) => setPrTargetBranch(e.target.value)}
                      placeholder="main"
                      className="w-full px-3 py-2 text-xs font-mono bg-surface border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                    Pull Request Title
                  </label>
                  <input
                    type="text"
                    value={prTitle}
                    onChange={(e) => setPrTitle(e.target.value)}
                    placeholder="e.g. [PROJ-101] Add OAuth login interface"
                    className="w-full px-3 py-2 text-xs bg-surface border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={creatingPR}
                    className="flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-md disabled:opacity-50"
                  >
                    <Sparkles size={14} />
                    <span>{creatingPR ? 'Creating PR...' : 'Create & Open PR'}</span>
                  </button>
                </div>
              </form>

              {/* Tasks with active PRs list */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
                    Project Tasks with Linked Pull Requests
                  </h4>
                  {tasksWithPRs.length > 0 && (
                    <button
                      type="button"
                      onClick={handleSyncPRs}
                      disabled={syncingPRs}
                      className="flex items-center space-x-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700 rounded hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50"
                    >
                      <RefreshCw size={10} className={syncingPRs ? 'animate-spin' : ''} />
                      <span>{syncingPRs ? 'Syncing...' : 'Sync PR Statuses'}</span>
                    </button>
                  )}
                </div>

                {tasksWithPRs.length === 0 ? (
                  <div className="py-8 border border-dashed border-border-subtle rounded-xl text-center text-xs text-muted">
                    No active Pull Requests created for task branches yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tasksWithPRs.map((t) => (
                      <div 
                        key={t.id}
                        className="flex items-center justify-between p-3.5 rounded-lg border border-border-subtle bg-surface-dim hover:border-slate-700 transition-all"
                      >
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-strong">{t.title}</p>
                          <div className="flex items-center space-x-2 text-[10px] text-muted font-mono">
                            <span>Branch: {t.branchName}</span>
                          </div>
                        </div>

                        <a
                          href={t.prUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-md transition-all"
                        >
                          <ExternalLink size={12} />
                          <span>View PR / MR</span>
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 3: CREATE BRANCH */}
          {activeTab === 'create' && (
            <form onSubmit={handleCreateBranch} className="max-w-xl space-y-4">
              <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-muted space-y-1">
                <span className="font-bold text-strong flex items-center gap-1.5">
                  <Terminal size={14} className="text-blue-400" /> Automated Remote Branching
                </span>
                <p>When selecting a project task, a standardized Git branch name is automatically formulated and created on your remote GitHub/GitLab repository.</p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                  Select Associated Task (Optional)
                </label>
                <div className="relative">
                  <select
                    value={selectedTaskId}
                    onChange={(e) => autoGenerateBranchFromTask(e.target.value)}
                    className="w-full pl-3 pr-8 py-2 text-xs bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500 appearance-none cursor-pointer"
                  >
                    <option value="">-- No specific task --</option>
                    {tasks.map(t => (
                      <option key={t.id} value={t.id}>
                        [{activeProject?.projectKey || 'TASK'}] {t.title} ({t.status})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                  Branch Name *
                </label>
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value.toUpperCase())}
                  placeholder="e.g. PROJ-12-auth-screen"
                  required
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                />

                {/* Dynamic Branch Name Increment and Suggestion Helper */}
                {(() => {
                  const incrementedVal = getIncrementedBranchName(newBranchName);
                  const existingSuggestions = getBranchSuggestions(branches.map(b => b.name));

                  if (!incrementedVal && existingSuggestions.length === 0) return null;

                  return (
                    <div className="mt-2.5 p-2.5 rounded-lg bg-surface border border-border-subtle space-y-2 text-xs animate-fade-in">
                      {/* Typed Input Increment Suggestion */}
                      {incrementedVal && (
                        <div className="flex items-center space-x-2">
                          <span className="text-muted">💡 Increment suggestion:</span>
                          <button
                            type="button"
                            onClick={() => setNewBranchName(incrementedVal)}
                            className="px-2 py-0.5 font-mono font-semibold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded transition-all"
                          >
                            {incrementedVal}
                          </button>
                        </div>
                      )}

                      {/* Existing Branch Increment Suggestions */}
                      {existingSuggestions.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-muted block font-medium">📈 Next suggestions from existing branches:</span>
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {existingSuggestions.map(s => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setNewBranchName(s)}
                                className="px-2 py-0.5 font-mono text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded transition-all"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                  Base Branch
                </label>
                <input
                  type="text"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  placeholder="main"
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex justify-end space-x-3">
                <button
                  type="submit"
                  disabled={creatingBranch}
                  className="flex items-center space-x-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-md disabled:opacity-50"
                >
                  <GitBranchIcon size={14} />
                  <span>{creatingBranch ? 'Creating Remote Branch...' : 'Create Remote Branch'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: REPOSITORY SETTINGS */}
          {activeTab === 'settings' && (
            !isManagerOrAdmin ? (
              <div className="p-8 text-center space-y-3 bg-surface-dim rounded-xl border border-border-subtle my-4">
                <Shield size={36} className="mx-auto text-amber-500" />
                <h3 className="text-sm font-bold text-strong">Integration Settings Restricted</h3>
                <p className="text-xs text-muted max-w-md mx-auto">
                  Repository integration configurations (URL, Personal Access Tokens, default branch) can only be altered by Project Managers, System Administrators, or the Project Owner.
                </p>
              </div>
            ) : (
            <form onSubmit={handleSaveSettings} className="max-w-2xl space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                    Git Provider
                  </label>
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => setRepoProvider('github')}
                      className={`flex-1 flex items-center justify-center space-x-2 py-2.5 border rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                        repoProvider === 'github'
                          ? 'bg-blue-500/10 border-blue-500 text-blue-400'
                          : 'bg-surface-dim border-border-subtle text-muted hover:text-strong'
                      }`}
                    >
                      <Github size={16} />
                      <span>GitHub</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRepoProvider('gitlab')}
                      className={`flex-1 flex items-center justify-center space-x-2 py-2.5 border rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                        repoProvider === 'gitlab'
                          ? 'bg-amber-500/10 border-amber-500 text-amber-400'
                          : 'bg-surface-dim border-border-subtle text-muted hover:text-strong'
                      }`}
                    >
                      <Gitlab size={16} />
                      <span>GitLab</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                    Default Branch
                  </label>
                  <input
                    type="text"
                    value={defaultBranch}
                    onChange={(e) => setDefaultBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3 py-2 text-xs font-mono bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                  Repository URL
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => {
                      setRepoUrl(e.target.value);
                      try {
                        const parsed = new URL(e.target.value);
                        const parts = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
                        if (parts.length >= 2) {
                          setRepoOwner(parts[0]);
                          setRepoName(parts.slice(1).join('/'));
                        }
                      } catch (err) {}
                    }}
                    placeholder="https://github.com/owner/repository"
                    className="w-full pl-8 pr-3 py-2 text-xs bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                  />
                  <LinkIcon size={14} className="absolute left-2.5 top-2.5 text-muted" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                    Owner / Organization
                  </label>
                  <input
                    type="text"
                    value={repoOwner}
                    onChange={(e) => setRepoOwner(e.target.value)}
                    placeholder="e.g. facebook or devteam"
                    className="w-full px-3 py-2 text-xs bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                    Repository Name
                  </label>
                  <input
                    type="text"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    placeholder="e.g. react or backend-api"
                    className="w-full px-3 py-2 text-xs bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1 flex items-center justify-between">
                  <span>Personal Access Token (PAT)</span>
                  <span className="text-[10px] text-muted font-normal lowercase">Enables live branch listing & remote creation</span>
                </label>
                <input
                  type="password"
                  value={repoToken}
                  onChange={(e) => setRepoToken(e.target.value)}
                  placeholder="github_pat_... or glpat-..."
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="flex items-center space-x-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-md disabled:opacity-50"
                >
                  <CheckCircle2 size={14} />
                  <span>{savingSettings ? 'Saving Settings...' : 'Save Integration Settings'}</span>
                </button>
              </div>
            </form>
            )
          )}

        </div>
      </div>

      {/* Task Modal for detailed inspection when clicking a task */}
      {selectedTaskForModal && (
        <TaskModal
          task={selectedTaskForModal}
          users={[]}
          projectId={selectedProjectId}
          onClose={() => setSelectedTaskForModal(null)}
          onSave={() => {
            setSelectedTaskForModal(null);
            fetchTasks();
            fetchBranches();
          }}
        />
      )}

    </div>
  );
}
