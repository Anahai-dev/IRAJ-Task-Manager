import React, { useState, useEffect } from 'react';
import { Project, GitBranch, Task } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getIncrementedBranchName, getBranchSuggestions } from '../lib/utils';
import { 
  X, GitBranch as GitBranchIcon, Github, Gitlab, Link as LinkIcon, 
  ExternalLink, Plus, RefreshCw, CheckCircle2, GitPullRequest, 
  Copy, Check, Shield, AlertCircle, Key, Layers, Terminal
} from 'lucide-react';
import { fetchAllPages } from '../lib/api';

interface ProjectGitModalProps {
  project: Project;
  onClose: () => void;
  onUpdateProject?: (updated: Project) => void;
}

export default function ProjectGitModal({ project, onClose, onUpdateProject }: ProjectGitModalProps) {
  const { token, user } = useAuth();
  const { success, error, info } = useToast();

  const canManageRepoSettings = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'manager' || project.ownerId === user?.id;

  const [activeTab, setActiveTab] = useState<'branches' | 'settings' | 'create_branch'>('branches');
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [copiedBranch, setCopiedBranch] = useState<string | null>(null);

  // Settings form state
  const [repoProvider, setRepoProvider] = useState<'github' | 'gitlab'>(project.repoProvider || 'github');
  const [repoOwner, setRepoOwner] = useState(project.repoOwner || '');
  const [repoName, setRepoName] = useState(project.repoName || '');
  const [repoUrl, setRepoUrl] = useState(project.repoUrl || '');
  const [repoToken, setRepoToken] = useState(project.repoToken || '');
  const [defaultBranch, setDefaultBranch] = useState(project.defaultBranch || 'main');
  const [savingSettings, setSavingSettings] = useState(false);

  // Create branch form state
  const [newBranchName, setNewBranchName] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [baseBranch, setBaseBranch] = useState(project.defaultBranch || 'main');
  const [creatingBranch, setCreatingBranch] = useState(false);

  const fetchBranches = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/git/branches`, {
        headers: { }
      });
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches || []);
        if (data.error) {
          info(`Git notice: ${data.error}`);
        }
      }
    } catch (err: any) {
      console.error("Failed to load branches:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTasks = async () => {
    try {
      const data = await fetchAllPages<Task>(`/api/tasks?projectId=${project.id}`);
      setTasks(data);
    } catch (err) {
      console.error("Failed to fetch project tasks:", err);
    }
  };

  useEffect(() => {
    fetchBranches();
    fetchTasks();
  }, [project.id]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageRepoSettings) {
      error("Permission denied: Only Admins, Managers, or the Project Owner can alter repository integration settings");
      return;
    }
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/repo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          repoProvider,
          repoOwner,
          repoName,
          repoUrl,
          repoToken,
          defaultBranch
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save repository settings');
      }

      const updated = await res.json();
      if (onUpdateProject) onUpdateProject(updated);
      success('Repository settings updated successfully');
      fetchBranches();
      setActiveTab('branches');
    } catch (err: any) {
      error(err.message || 'Error saving repository settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim()) {
      error('Branch name is required');
      return;
    }

    setCreatingBranch(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/git/branches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          branchName: newBranchName.trim(),
          taskId: selectedTaskId || null,
          baseBranch
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.remoteError || 'Failed to create branch');
      }

      success(data.message || `Branch ${newBranchName} created successfully`);
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

  const handleCreatePR = async (branchName: string, taskId?: string) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/git/pull-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          taskId,
          sourceBranch: branchName,
          targetBranch: defaultBranch || 'main',
          title: `[${project.projectKey || 'TASK'}] Merge ${branchName} into ${defaultBranch || 'main'}`
        })
      });

      const data = await res.json();
      if (res.ok && data.prUrl) {
        window.open(data.prUrl, '_blank');
        if (data.isFallback) {
          info('Credentials unconfigured or API connection failed. Opened web compare page in a new tab for manual creation!');
        } else {
          success('Pull / Merge Request created via API! Link opened in a new tab');
        }
        fetchBranches();
      } else {
        error('Failed to create Pull Request');
      }
    } catch (err) {
      error('Error creating Pull Request');
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
    if (task) {
      const cleanTitle = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30);
      const keyStr = project.projectKey ? `${project.projectKey}-` : '';
      setNewBranchName(`${keyStr}${cleanTitle}`);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 left-0 md:left-[var(--sidebar-width,80px)] z-50 overflow-y-auto flex justify-center items-start p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in transition-all duration-300">
      <div className="my-auto relative w-full max-w-3xl bg-surface border border-border-subtle rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] md:max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-surface-dim">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              {repoProvider === 'gitlab' ? <Gitlab size={20} /> : <Github size={20} />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-strong flex items-center gap-2">
                <span>Git & Branch Management</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-blue-400 border border-slate-700">
                  {project.projectKey || 'PROJECT'}
                </span>
              </h2>
              <p className="text-xs text-muted">
                {repoOwner && repoName ? `${repoOwner}/${repoName}` : 'Manage remote branches, PRs & GitHub/GitLab integration'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-strong hover:bg-surface-bright transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-border-subtle bg-surface px-6 space-x-2">
          <button
            onClick={() => setActiveTab('branches')}
            className={`flex items-center space-x-2 px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'branches' 
                ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                : 'border-transparent text-muted hover:text-strong'
            }`}
          >
            <GitBranchIcon size={14} />
            <span>Branches ({branches.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('create_branch')}
            className={`flex items-center space-x-2 px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'create_branch' 
                ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                : 'border-transparent text-muted hover:text-strong'
            }`}
          >
            <Plus size={14} />
            <span>New Branch</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center space-x-2 px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === 'settings' 
                ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                : 'border-transparent text-muted hover:text-strong'
            }`}
          >
            <Key size={14} />
            <span>Repo Settings</span>
            {!canManageRepoSettings && (
              <span title="Restricted to Managers & Admins">
                <Shield size={12} className="text-amber-400 ml-1" />
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* TAB 1: BRANCHES LIST */}
          {activeTab === 'branches' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted">
                  Showing branches linked to <span className="text-strong font-medium">{project.name}</span>
                </p>
                <button
                  onClick={fetchBranches}
                  disabled={loading}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs text-muted hover:text-strong border border-border-subtle rounded-lg hover:bg-surface-dim transition-all"
                >
                  <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                  <span>Refresh</span>
                </button>
              </div>

              {loading ? (
                <div className="py-12 text-center text-xs text-muted flex flex-col items-center gap-2">
                  <RefreshCw size={24} className="animate-spin text-blue-500" />
                  <span>Fetching repository branches...</span>
                </div>
              ) : branches.length === 0 ? (
                <div className="py-12 border border-dashed border-border-subtle rounded-xl text-center space-y-3 p-6">
                  <GitBranchIcon size={32} className="mx-auto text-muted/50" />
                  <p className="text-sm font-medium text-strong">No branches found yet</p>
                  <p className="text-xs text-muted max-w-sm mx-auto">
                    Create a new branch for this project or configure your GitHub / GitLab repository token in Settings.
                  </p>
                  <button
                    onClick={() => setActiveTab('create_branch')}
                    className="inline-flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-md"
                  >
                    <Plus size={14} />
                    <span>Create First Branch</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {branches.map((b) => (
                    <div 
                      key={b.name}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-lg border border-border-subtle bg-surface-dim hover:border-slate-700 transition-all gap-3"
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
                          <div className="text-xs text-subtle flex items-center gap-1">
                            <Layers size={12} className="text-muted" />
                            <span>Linked Task: </span>
                            <span className="font-semibold text-strong">{b.linkedTaskTitle}</span>
                          </div>
                        ) : (
                          <p className="text-xs text-muted italic">No specific task linked</p>
                        )}
                      </div>

                      {/* Branch Actions */}
                      <div className="flex items-center space-x-2 self-end sm:self-auto">
                        <button
                          onClick={() => copyCheckoutCommand(b.name)}
                          title="Copy Git checkout command"
                          className="flex items-center space-x-1 px-2.5 py-1.5 text-xs text-muted hover:text-strong bg-surface border border-border-subtle hover:border-slate-600 rounded-md transition-all"
                        >
                          {copiedBranch === b.name ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          <span className="font-mono text-[11px]">git checkout</span>
                        </button>

                        <button
                          onClick={() => handleCreatePR(b.name, b.linkedTaskId)}
                          title="Create Pull/Merge Request"
                          className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-md transition-all"
                        >
                          <GitPullRequest size={12} />
                          <span>PR / MR</span>
                        </button>

                        {b.webUrl && (
                          <a
                            href={b.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-muted hover:text-strong hover:bg-surface rounded-md transition-colors"
                            title="Open in GitHub/GitLab"
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

          {/* TAB 2: CREATE NEW BRANCH */}
          {activeTab === 'create_branch' && (
            <form onSubmit={handleCreateBranch} className="space-y-4">
              <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-muted space-y-1">
                <span className="font-bold text-strong flex items-center gap-1.5">
                  <Terminal size={14} className="text-blue-400" /> Branch Naming Standard
                </span>
                <p>Create branches directly linked to tasks. Names like <code className="text-blue-400 bg-slate-900 px-1 py-0.5 rounded">PROJ-101-user-login</code> facilitate automated tracking.</p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                  Select Associated Task (Optional)
                </label>
                <select
                  value={selectedTaskId}
                  onChange={(e) => autoGenerateBranchFromTask(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- No specific task --</option>
                  {tasks.map(t => (
                    <option key={t.id} value={t.id}>
                      [{project.projectKey || 'TASK'}] {t.title} ({t.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                  Branch Name *
                </label>
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
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
                  type="button"
                  onClick={() => setActiveTab('branches')}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted hover:text-strong"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingBranch}
                  className="flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-md disabled:opacity-50"
                >
                  <GitBranchIcon size={14} />
                  <span>{creatingBranch ? 'Creating Branch...' : 'Create Branch'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: REPOSITORY SETTINGS */}
          {activeTab === 'settings' && (
            !canManageRepoSettings ? (
              <div className="p-8 text-center space-y-3 bg-surface-dim rounded-xl border border-border-subtle my-4">
                <Shield size={36} className="mx-auto text-amber-500" />
                <h3 className="text-sm font-bold text-strong">Settings Restricted</h3>
                <p className="text-xs text-muted max-w-md mx-auto">
                  Repository integration settings (URL, tokens, default branch) can only be configured or modified by Project Managers, System Administrators, or the Project Owner.
                </p>
              </div>
            ) : (
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-subtle mb-1">
                    Git Provider
                  </label>
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => setRepoProvider('github')}
                      className={`flex-1 flex items-center justify-center space-x-2 py-2 border rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
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
                      className={`flex-1 flex items-center justify-center space-x-2 py-2 border rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
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
                  <span>Personal Access Token (PAT) / Token</span>
                  <span className="text-[10px] text-muted font-normal lowercase">Required for remote branch creation & private repos</span>
                </label>
                <input
                  type="password"
                  value={repoToken}
                  onChange={(e) => setRepoToken(e.target.value)}
                  placeholder="github_pat_... or glpat-..."
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-dim border border-border-subtle rounded-lg text-strong focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('branches')}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted hover:text-strong"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="flex items-center space-x-2 px-4 py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all shadow-md disabled:opacity-50"
                >
                  <CheckCircle2 size={14} />
                  <span>{savingSettings ? 'Saving...' : 'Save Settings'}</span>
                </button>
              </div>
            </form>
            )
          )}

        </div>

      </div>
    </div>
  );
}
