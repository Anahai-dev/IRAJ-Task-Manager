import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useGitFeature } from '../contexts/GitFeatureContext';
import { Task, User, Project, Milestone } from '../types';
import TaskModal from '../components/TaskModal';
import CustomSelect from '../components/CustomSelect';
import WorkloadModal from '../components/WorkloadModal';
import ProjectActivityModal from '../components/ProjectActivityModal';
import { Plus, MoreVertical, Calendar, ArrowUpDown, CornerDownRight, Search, Filter, AlertCircle, ChevronUp, Minus, ChevronDown, X, FolderKanban, Activity, CheckCircle2, Workflow, Clock, Pencil, Trash2, UserPlus, Download, GitBranch, GitPullRequest } from 'lucide-react';
import { format } from 'date-fns';
import { cn, safeFormatDate } from '../lib/utils';
import { canCreateTasks } from '../lib/permissions';
import { useSearchParams, Link, Navigate, useNavigate } from 'react-router';
import TaskDiagram from '../components/TaskDiagram';
import SafeMarkdown from '../components/SafeMarkdown';
import UserAvatar from '../components/UserAvatar';
import { exportToCSV, exportToJSON } from '../lib/export';
import { HelpIcon, Tooltip } from '../components/Tooltip';
import { apiDelete, apiPost, apiPut, fetchAllPages } from '../lib/api';
import { useBoardColumns } from '../hooks/useBoardColumns';
import { DEFAULT_BOARD_COLUMNS, type BoardColumn } from '../lib/board';

export type Column = BoardColumn;
export const DEFAULT_COLUMNS = DEFAULT_BOARD_COLUMNS;

type SortOption = 'custom' | 'priority' | 'deadline' | 'createdAt';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'board' | 'diagram';

const priorityWeight = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1
};

export default function Board() {
  const { token, user } = useAuth();
  const { success, error, info } = useToast();
  const { gitEnabled } = useGitFeature();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  
  const { columns, setColumns } = useBoardColumns(projectId, token);

  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnTitle, setEditingColumnTitle] = useState('');

  const handleAddColumn = () => {
    const newId = `col_${Date.now()}`;
    const newTitle = 'New Column';
    setColumns([...columns, { id: newId, title: newTitle }]);
    setTimeout(() => {
       setEditingColumnId(newId);
       setEditingColumnTitle(newTitle);
    }, 0);
  };

  const handleUpdateColumnTitle = (id: string) => {
    if (editingColumnTitle.trim()) {
      setColumns(columns.map(c => c.id === id ? { ...c, title: editingColumnTitle.trim() } : c));
    }
    setEditingColumnId(null);
  };

  const handleDeleteColumn = (id: string) => {
    setColumns(columns.filter(c => c.id !== id));
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWorkloadModalOpen, setIsWorkloadModalOpen] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('custom');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);

  const handleColumnDragEnter = (targetColId: string) => {
    if (!draggingColumnId || draggingColumnId === targetColId) return;
    setColumns(prev => {
      const sourceIdx = prev.findIndex(c => c.id === draggingColumnId);
      const targetIdx = prev.findIndex(c => c.id === targetColId);
      if (sourceIdx !== -1 && targetIdx !== -1) {
        const newCols = [...prev];
        const [dragged] = newCols.splice(sourceIdx, 1);
        newCols.splice(targetIdx, 0, dragged);
        return newCols;
      }
      return prev;
    });
  };

  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  const handleExportCSV = () => {
    setIsExportMenuOpen(false);
    const exportData = filteredTasks.map(t => ({
      ID: t.id,
      Project: t.projectId || '',
      Title: t.title,
      Description: t.description || '',
      Status: t.status,
      Priority: t.priority,
      Assignee: users.find(u => u.id === t.assigneeId)?.name || 'Unassigned',
      Branch: t.branchName || '',
      Deadline: t.deadline || '',
      Created: t.createdAt
    }));
    exportToCSV(`tasks-${project?.name || 'all'}`, exportData);
  };

  const handleExportJSON = () => {
    setIsExportMenuOpen(false);
    exportToJSON(`tasks-${project?.name || 'all'}`, filteredTasks);
  };

  const fetchData = async () => {
    try {
      const [tasksData, usersData, projectsData, milestonesData] = await Promise.all([
        fetchAllPages<Task>('/api/tasks'),
        fetchAllPages<User>('/api/users'),
        fetchAllPages<Project>('/api/projects'),
        fetchAllPages<Milestone>('/api/milestones'),
      ]);
      
      setAllProjects(projectsData);
      setMilestones(milestonesData);
      
      if (projectId) {
        const found = projectsData.find((p: Project) => p.id === projectId);
        setProject(found || null);
        // Filter tasks by this project
        setTasks(tasksData.filter((t: Task) => t.projectId === projectId));
      } else {
        setProject(null);
        setTasks(tasksData);
      }
      
      setUsers(usersData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token, projectId]);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      let comparison = 0;
      
      if (sortBy === 'custom') {
        comparison = (a.orderIndex || 0) - (b.orderIndex || 0);
      } else if (sortBy === 'priority') {
        comparison = priorityWeight[a.priority] - priorityWeight[b.priority];
      } else if (sortBy === 'deadline') {
        const tA = a.deadline ? new Date(a.deadline).getTime() : 0;
        const tB = b.deadline ? new Date(b.deadline).getTime() : 0;
        comparison = (isNaN(tA) ? 0 : tA) - (isNaN(tB) ? 0 : tB);
      } else if (sortBy === 'createdAt') {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        comparison = (isNaN(tA) ? 0 : tA) - (isNaN(tB) ? 0 : tB);
      }

      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [tasks, sortBy, sortDir]);

  const filteredTasks = useMemo(() => {
    let result = sortedTasks;

    if (filterAssignee !== 'all') {
      result = result.filter(t => t.assigneeId === filterAssignee);
    }
    
    if (filterPriority !== 'all') {
      result = result.filter(t => t.priority === filterPriority);
    }

    if (filterStatus !== 'all') {
      result = result.filter(t => t.status === filterStatus);
    }

    if (!searchQuery.trim()) return result;
    const lowerQuery = searchQuery.toLowerCase();
    
    const matchingTasks = new Set<string>();
    
    result.forEach(t => {
      if (t.title.toLowerCase().includes(lowerQuery) || (t.description && t.description.toLowerCase().includes(lowerQuery))) {
        matchingTasks.add(t.id);
        if (t.parentId) matchingTasks.add(t.parentId); // Include parent if subtask matches
      }
    });
    
    // Include all subtasks if parent matches
    result.forEach(t => {
      if (t.parentId && matchingTasks.has(t.parentId)) {
        matchingTasks.add(t.id);
      }
    });

    return result.filter(t => matchingTasks.has(t.id));
  }, [sortedTasks, searchQuery, filterAssignee, filterPriority, filterStatus]);

  const handleCreateTask = () => {
    setEditingTask(null);
    setSelectedParentId(null);
    setSelectedStatus(null);
    setIsModalOpen(true);
  };

  useEffect(() => {
    const handleGlobalNewTask = () => handleCreateTask();
    window.addEventListener('open-new-task-modal', handleGlobalNewTask);
    return () => window.removeEventListener('open-new-task-modal', handleGlobalNewTask);
  }, []);

  const handleCreateTaskInColumn = (status: string) => {
    setEditingTask(null);
    setSelectedParentId(null);
    setSelectedStatus(status);
    setIsModalOpen(true);
  };

  const handleDropTask = async (taskId: string, targetStatus: string, hoverTaskId?: string, dropPosition?: 'before' | 'after') => {
    setDraggingTaskId(null);
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (targetStatus === 'done' && task.status !== 'done') {
      const deps = task.dependencies || [];
      const pendingDeps = deps.filter(depId => {
        const dep = tasks.find(t => t.id === depId);
        return dep && dep.status !== 'done';
      });
      if (pendingDeps.length > 0) {
        error(`Cannot complete task. ${pendingDeps.length} dependencies are still pending.`);
        return;
      }
    }

    let newOrderIndex = task.orderIndex;

    const columnTasks = sortedTasks.filter(t => t.status === targetStatus && t.parentId === task.parentId);
    
    // Explicit reordering - exclude the dragged task from column Tasks to avoid index shifting bugs
    const columnTasksWithoutDragged = columnTasks.filter(t => t.id !== taskId);

    if (hoverTaskId) {
      if (sortBy !== 'custom') {
        setSortBy('custom');
        setSortDir('asc');
      }
      
      const hoverIndex = columnTasksWithoutDragged.findIndex(t => t.id === hoverTaskId);
      if (hoverIndex !== -1) {
        if (dropPosition === 'before') {
          const prevTask = columnTasksWithoutDragged[hoverIndex - 1];
          const hoverTask = columnTasksWithoutDragged[hoverIndex];
          if (prevTask) {
            newOrderIndex = ((prevTask.orderIndex || 0) + (hoverTask.orderIndex || 0)) / 2;
          } else {
            newOrderIndex = (hoverTask.orderIndex || 0) + (sortDir === 'asc' ? -1000 : 1000);
          }
        } else {
          const hoverTask = columnTasksWithoutDragged[hoverIndex];
          const nextTask = columnTasksWithoutDragged[hoverIndex + 1];
          if (nextTask) {
            newOrderIndex = ((hoverTask.orderIndex || 0) + (nextTask.orderIndex || 0)) / 2;
          } else {
            newOrderIndex = (hoverTask.orderIndex || 0) + (sortDir === 'asc' ? 1000 : -1000);
          }
        }
      }
    } else if (columnTasksWithoutDragged.length > 0) {
      if (task.status !== targetStatus) {
        const lastTask = columnTasksWithoutDragged[columnTasksWithoutDragged.length - 1];
        newOrderIndex = (lastTask.orderIndex || 0) + (sortDir === 'asc' ? 1000 : -1000);
      }
    } else {
      newOrderIndex = Date.now();
    }

    // Optimistic update
    setTasks(tasks.map(t => t.id === taskId ? { ...t, status: targetStatus as any, orderIndex: newOrderIndex } : t));
    
    try {
      await apiPut(`/api/tasks/${taskId}`, { ...task, status: targetStatus, orderIndex: newOrderIndex });
    } catch (err) {
      console.error('Failed to update status', err);
    } finally {
      fetchData();
    }
  };

  const handleCreateSubtask = (parentId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingTask(null);
    setSelectedParentId(parentId);
    setIsModalOpen(true);
  };

  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setSelectedParentId(null);
    setIsModalOpen(true);
  };

  const handleSaveTask = async (taskData: Partial<Task>) => {
    const isEdit = !!editingTask;

    try {
      if (isEdit) {
        await apiPut(`/api/tasks/${editingTask!.id}`, taskData);
      } else {
        await apiPost('/api/tasks', taskData);
      }
      setIsModalOpen(false);
      fetchData();
      success(editingTask ? 'Task updated' : 'Task created');
    } catch (err: unknown) {
      console.error(err);
      error(`Error saving task: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleUpdateTask = async (taskId: string, currentTask: Task, updates: Partial<Task>) => {
    try {
      await apiPut(`/api/tasks/${taskId}`, { ...currentTask, ...updates });
      fetchData();
      if (updates.status === 'done') {
        success('Task completed');
      } else {
        success(updates.orderIndex !== undefined && Object.keys(updates).length === 1 ? 'Task reordered' : 'Task updated');
      }
    } catch (err) {
      error('Failed to update task');
      console.error(err);
    }
  };

  const toggleSelection = (taskId: string) => {
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });
  };

  const handleBulkUpdate = async (updates: Partial<Task>) => {
    if (selectedTaskIds.size === 0) return;
    try {
      const selectedTasks = tasks.filter(t => selectedTaskIds.has(t.id));
      await Promise.all(selectedTasks.map(t => 
        apiPut(`/api/tasks/${t.id}`, { ...t, ...updates })
      ));
      setSelectedTaskIds(new Set());
      fetchData();
      if (updates.status === 'done') {
        success('Tasks completed');
      } else {
        success('Tasks updated');
      }
    } catch (err) {
      error('Bulk update failed');
      console.error('Bulk update failed', err);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTaskIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedTaskIds.size} tasks?`)) return;
    try {
      await Promise.all(Array.from(selectedTaskIds).map(id => 
        apiDelete(`/api/tasks/${id}`)
      ));
      setSelectedTaskIds(new Set());
      fetchData();
      success('Tasks deleted');
    } catch (err) {
      error('Bulk delete failed');
      console.error('Bulk delete failed', err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {

    try {
      await apiDelete(`/api/tasks/${taskId}`);
      fetchData();
      success('Task deleted');
    } catch (err) {
      error('Failed to delete task');
      console.error(err);
    }
  };

  if (loading) return <div className="p-8 text-primary">Loading board...</div>;

  if (!projectId) {
    if (allProjects.length === 1) {
      return <Navigate to={`/board?projectId=${allProjects[0].id}`} replace />;
    }
    
    return (
      <div className="flex-1 flex flex-col p-8 bg-page-bg overflow-y-auto">
        <h1 className="text-xl font-semibold text-strong tracking-tight opacity-90 mb-2">Select a Project</h1>
        <p className="text-sm text-subtle mb-8">Choose a project to view its task board</p>
        
        {allProjects.length === 0 ? (
          <div className="text-center p-12 bg-surface border border-border-subtle rounded-lg">
            <h2 className="text-lg font-medium text-strong mb-2">No projects found</h2>
            <p className="text-sm text-subtle mb-4">You need to create a project first before managing tasks.</p>
            <Link to="/projects" className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-strong text-sm font-medium rounded transition-colors">
              Go to Projects
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {allProjects.map(p => (
              <Link 
                key={p.id} 
                to={`/board?projectId=${p.id}`}
                className="block p-6 bg-surface border border-border-subtle hover:border-blue-500/50 rounded-lg transition-all hover:shadow-lg group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 bg-blue-500/10 text-blue-500 rounded group-hover:scale-110 transition-transform">
                    <FolderKanban size={24} />
                  </div>
                  <span className="text-xs font-mono text-muted bg-surface-accent px-2 py-1 rounded">
                    {p.projectKey || 'PRJ'}
                  </span>
                </div>
                <h3 className="text-lg font-medium text-strong mb-2 group-hover:text-blue-400 transition-colors">{p.name}</h3>
                <p className="text-sm text-subtle line-clamp-2">
                  {p.description ? p.description : 'No description'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 min-h-0 bg-page-bg">
      <div className="tour-board-header flex justify-between items-start lg:items-center mb-6 shrink-0 flex-col lg:flex-row gap-4">
        <div>
          {project ? (
            <>
              <h1 className="text-xl font-semibold text-strong tracking-tight flex items-center gap-2">
                <FolderKanban size={20} className="text-blue-500" />
                {project.name} <span className="text-sm font-normal text-subtle">Board</span>
              </h1>
              <div className="text-xs text-subtle mt-1 prose dark:prose-invert prose-sm line-clamp-1">
                {project.description ? (
                  <SafeMarkdown>{project.description}</SafeMarkdown>
                ) : (
                  'Project Task Board'
                )}
              </div>
            </>
          ) : (
            <>
              <h1 className="text-sm font-semibold text-strong tracking-tight uppercase">Task Board</h1>
              <p className="text-[10px] text-subtle uppercase tracking-widest mt-1">Manage all tasks</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {project && (
            <>
              <button
                onClick={() => setIsWorkloadModalOpen(true)}
                className="flex items-center space-x-2 bg-surface border border-border-subtle hover:border-blue-500/50 text-primary hover:text-strong px-3 py-1.5 rounded transition-all text-sm font-medium"
              >
                <Activity size={14} className="text-blue-500" />
                <span>Team Workload</span>
              </button>
              <button
                onClick={() => setIsActivityModalOpen(true)}
                className="flex items-center space-x-2 bg-surface border border-border-subtle hover:border-blue-500/50 text-primary hover:text-strong px-3 py-1.5 rounded transition-all text-sm font-medium"
              >
                <Clock size={14} className="text-blue-500" />
                <span>Project Activity</span>
              </button>
              {gitEnabled && (
                <button
                  onClick={() => navigate(`/git?projectId=${project.id}`)}
                  className="flex items-center space-x-2 bg-surface border border-border-subtle hover:border-amber-500/50 text-primary hover:text-amber-400 px-3 py-1.5 rounded transition-all text-sm font-medium"
                >
                  <GitBranch size={14} className="text-amber-400" />
                  <span>Git Repo</span>
                </button>
              )}
              <Link
                to={`/graph?projectId=${project.id}`}
                className="flex items-center space-x-2 bg-indigo-500/10 border border-indigo-500/30 hover:border-indigo-500 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 px-3 py-1.5 rounded transition-all text-sm font-medium shadow-sm hover:scale-105"
              >
                <Workflow size={14} className="text-indigo-400" />
                <span>Task Graph</span>
              </Link>
            </>
          )}
          <div className="flex items-center space-x-2 bg-surface border border-border-subtle rounded px-3 py-1.5 text-[10px]">
            <Search size={14} className="text-subtle shrink-0" />
            <input 
              type="text" 
              placeholder="SEARCH TASKS..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-strong uppercase font-bold tracking-widest outline-none w-32 md:w-48 placeholder-muted"
            />
          </div>
          <div className="flex items-center space-x-3 bg-surface border border-border-subtle rounded px-3 py-1.5 text-[10px] flex-wrap">
            <Filter size={12} className="text-subtle shrink-0" />
            <div className="min-w-28">
              <CustomSelect
                value={filterAssignee}
                onChange={setFilterAssignee}
                options={[
                  { value: 'all', label: 'ALL USERS' },
                  ...(user ? [{ value: user.id, label: 'ASSIGNED TO ME' }] : []),
                  ...users.filter(u => u.id !== user?.id).map(u => ({ value: u.id, label: u.name.toUpperCase() }))
                ]}
                variant="borderless"
                size="xs"
              />
            </div>
            <span className="text-border-strong px-1">|</span>
            <div className="min-w-32">
              <CustomSelect
                value={filterPriority}
                onChange={setFilterPriority}
                options={[
                  { value: 'all', label: 'ALL PRIORITIES' },
                  { value: 'urgent', label: 'URGENT' },
                  { value: 'high', label: 'HIGH' },
                  { value: 'medium', label: 'MEDIUM' },
                  { value: 'low', label: 'LOW' }
                ]}
                variant="borderless"
                size="xs"
              />
            </div>
            <span className="text-border-strong px-1">|</span>
            <div className="min-w-32">
              <CustomSelect
                value={filterStatus}
                onChange={setFilterStatus}
                options={[
                  { value: 'all', label: 'ALL STATUSES' },
                  ...columns.map(c => ({ value: c.id, label: c.title.toUpperCase() }))
                ]}
                variant="borderless"
                size="xs"
              />
            </div>
          </div>
          <div className="flex items-center space-x-2 bg-surface border border-border-subtle rounded px-3 py-1.5 text-[10px]">
             <ArrowUpDown size={12} className="text-subtle" />
             <span className="text-subtle font-bold uppercase tracking-widest border-r border-border-subtle pr-2">SORT BY</span>
             <div className="min-w-40">
               <CustomSelect
                 value={`${sortBy}-${sortDir}`}
                 onChange={(val) => {
                   const [by, dir] = val.split('-');
                   setSortBy(by as SortOption);
                   setSortDir(dir as SortDirection);
                 }}
                 options={[
                   { value: 'custom-asc', label: 'CUSTOM (DRAG & DROP)' },
                   { value: 'priority-desc', label: 'HIGHEST PRIORITY' },
                   { value: 'priority-asc', label: 'LOWEST PRIORITY' },
                   { value: 'deadline-asc', label: 'NEAREST DEADLINE' },
                   { value: 'deadline-desc', label: 'FURTHEST DEADLINE' },
                   { value: 'createdAt-desc', label: 'NEWEST FIRST' },
                   { value: 'createdAt-asc', label: 'OLDEST FIRST' }
                 ]}
                 variant="borderless"
                 size="xs"
               />
             </div>
          </div>
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
          {canCreateTasks(user) && (
            <Tooltip content="Create a new task with keyboard shortcut: c" position="bottom">
              <button
                onClick={handleCreateTask}
                className="tour-new-task px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow hover:scale-105 transition-all flex items-center space-x-2"
              >
                <Plus size={14} />
                <span>NEW TASK</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex-1 flex space-x-4 md:space-x-6 overflow-x-auto overflow-y-hidden pb-4 scrollbar-thin snap-x snap-mandatory scroll-smooth">
          {columns.map(column => {
            const parentTasks = filteredTasks.filter(t => !t.parentId);
            const columnTasks = parentTasks.filter(t => t.status === column.id);
          return (
            <div 
              key={column.id} 
              className={`w-[290px] sm:w-80 snap-center flex-shrink-0 flex flex-col bg-surface border rounded-lg transition-colors duration-200 ${draggingColumnId === column.id ? 'opacity-50 border-dashed border-blue-500' : 'border-border-subtle'} `}
              onDragEnter={(e) => {
                if (draggingColumnId) {
                  handleColumnDragEnter(column.id);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                e.currentTarget.classList.add('border-blue-500/50');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('border-blue-500/50');
              }}
              onDrop={async (e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-blue-500/50');
                
                const columnId = e.dataTransfer.getData('columnId');
                const taskId = e.dataTransfer.getData('taskId');
                
                if (columnId && columnId !== column.id) {
                  // Handle column reorder
                  setColumns(prev => {
                    const newColumns = [...prev];
                    const sourceIdx = newColumns.findIndex(c => c.id === columnId);
                    const targetIdx = newColumns.findIndex(c => c.id === column.id);
                    if (sourceIdx !== -1 && targetIdx !== -1) {
                        const [dragged] = newColumns.splice(sourceIdx, 1);
                        newColumns.splice(targetIdx, 0, dragged);
                    }
                    return newColumns;
                  });
                } else if (taskId) {
                  handleDropTask(taskId, column.id);
                }
                setDraggingColumnId(null);
              }}
            >
              <div 
                className="px-4 py-3 flex justify-between items-center border-b border-border-subtle group cursor-move"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('columnId', column.id);
                  setTimeout(() => setDraggingColumnId(column.id), 0);
                }}
                onDragEnd={() => {
                  setDraggingColumnId(null);
                }}
              >
                <div className="flex items-center space-x-2 flex-1">
                  {editingColumnId === column.id ? (
                    <input
                      type="text"
                      className="text-xs font-bold text-strong uppercase tracking-widest bg-transparent border-b border-blue-500 outline-none w-full"
                      value={editingColumnTitle}
                      onChange={(e) => setEditingColumnTitle(e.target.value)}
                      onBlur={() => handleUpdateColumnTitle(column.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdateColumnTitle(column.id);
                        if (e.key === 'Escape') setEditingColumnId(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <h3 className="text-xs font-bold text-strong uppercase tracking-widest cursor-pointer" onDoubleClick={() => {
                      setEditingColumnId(column.id);
                      setEditingColumnTitle(column.title);
                    }}>
                      {column.title}
                    </h3>
                  )}
                  <span className="bg-surface-accent text-strong px-2 py-0.5 rounded text-[10px] font-medium">
                    {columnTasks.length}
                  </span>
                </div>
                <div className="flex flex-row items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canCreateTasks(user) && (
                    <Tooltip content={`Add Task to ${column.title}`} position="top">
                      <button
                        onClick={() => handleCreateTaskInColumn(column.id)}
                        className="bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white p-1 rounded transition-colors"
                      >
                        <Plus size={16} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content={`Delete ${column.title}`} position="top">
                    <button
                      onClick={() => handleDeleteColumn(column.id)}
                      className="text-subtle hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {columnTasks.map(task => {
                  const assignee = users.find(u => u.id === task.assigneeId);
                  const subtasks = filteredTasks.filter(t => t.parentId === task.id);
                  const completedSubtasks = subtasks.filter(t => t.status === 'done').length;

                  return (
                    <div
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Task: ${task.title}`}
                      draggable
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleEditTask(task);
                        }
                      }}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('taskId', task.id);
                        setTimeout(() => setDraggingTaskId(task.id), 0);

                      }}
                      onDragEnd={() => setDraggingTaskId(null)}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes('columnid') || e.dataTransfer.types.includes('columnId')) {
                          return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        const rect = e.currentTarget.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        if (y < rect.height / 2) {
                          e.currentTarget.style.borderTopColor = '#3b82f6';
                          e.currentTarget.style.borderBottomColor = '#2d3139';
                        } else {
                          e.currentTarget.style.borderTopColor = '#2d3139';
                          e.currentTarget.style.borderBottomColor = '#3b82f6';
                        }
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.style.borderTopColor = '';
                        e.currentTarget.style.borderBottomColor = '';
                      }}
                      onDrop={(e) => {
                        const draggedColumnId = e.dataTransfer.getData('columnId');
                        if (draggedColumnId) {
                          // Allow it to bubble up to the column container
                          return;
                        }
                        
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.style.borderTopColor = '';
                        e.currentTarget.style.borderBottomColor = '';
                        const draggedTaskId = e.dataTransfer.getData('taskId');
                        if (!draggedTaskId || draggedTaskId === task.id) return;
                        
                        const rect = e.currentTarget.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const position = y < rect.height / 2 ? 'before' : 'after';
                        
                        handleDropTask(draggedTaskId, column.id, task.id, position);
                      }}
                      onClick={() => handleEditTask(task)}
                      className={cn(
                        "task-card p-3 bg-surface-dim border rounded cursor-pointer hover:border-blue-500 transition-colors group flex flex-col",
                        draggingTaskId === task.id && "opacity-40",
                        task.priority === 'urgent' ? 'border-red-500/40' :
                        task.priority === 'high' ? 'border-amber-500/40' :
                        task.priority === 'medium' ? 'border-blue-500/40' :
                        'border-border-subtle'
                      )}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center space-x-2">
                          <div 
                            className={cn(
                              "opacity-0 transition-opacity flex items-center justify-center cursor-pointer p-0.5 lg:group-hover:opacity-100",
                              (selectedTaskIds.has(task.id) || selectedTaskIds.size > 0) && "opacity-100"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelection(task.id);
                            }}
                          >
                            <input 
                              type="checkbox" 
                              readOnly 
                              checked={selectedTaskIds.has(task.id)} 
                              className="w-3 h-3 cursor-pointer accent-blue-500" 
                            />
                          </div>
                          <div className={cn(
                            "flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0",
                            task.priority === 'urgent' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            task.priority === 'high' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            task.priority === 'medium' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            'bg-surface-accent text-muted border border-border-strong'
                          )}>
                            {task.priority === 'urgent' && <AlertCircle size={10} />}
                            {task.priority === 'high' && <ChevronUp size={10} />}
                            {task.priority === 'medium' && <Minus size={10} />}
                            {task.priority === 'low' && <ChevronDown size={10} />}
                            <span>{task.priority}</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            className="text-subtle hover:text-blue-400 p-1 rounded hover:bg-blue-500/10"
                            title="Edit Task"
                            onClick={(e) => { e.stopPropagation(); handleEditTask(task); }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button 
                            className="text-subtle hover:text-red-400 p-1 rounded hover:bg-red-500/10"
                            title="Delete Task"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteTask(task.id); }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <h4 className="text-xs font-bold text-strong mb-1 leading-snug">{task.title}</h4>
                      {gitEnabled && task.branchName ? (
                        <div className="flex items-center space-x-1 mb-2 flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(`git checkout ${task.branchName}`);
                              success(`Copied: git checkout ${task.branchName}`);
                            }}
                            title="Click to copy: git checkout branch"
                            className="inline-flex items-center space-x-1 text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 px-1.5 py-0.5 rounded border border-blue-500/20 transition-all truncate max-w-[180px]"
                          >
                            <GitBranch size={10} className="shrink-0" />
                            <span className="truncate">{task.branchName}</span>
                          </button>
                          {task.prUrl && (
                            <a
                              href={task.prUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center space-x-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/20 transition-colors"
                              title="View Pull Request"
                            >
                              <GitPullRequest size={9} />
                              <span>PR</span>
                            </a>
                          )}
                        </div>
                      ) : null}
                      {task.milestoneId && (
                        <div className="text-[9px] font-bold uppercase tracking-widest text-[#a855f7] bg-[#a855f7]/10 border border-[#a855f7]/20 px-1.5 py-0.5 rounded inline-block mb-2 max-w-full truncate">
                          {milestones.find(m => m.id === task.milestoneId)?.name || 'Milestone'}
                        </div>
                      )}
                      
                      {(() => {
                        const allDeps = task.dependencies || [];
                        const pendingDeps = allDeps.filter(depId => {
                           const dep = filteredTasks.find(t => t.id === depId);
                           return dep && dep.status !== 'done';
                        }).length;
                        
                        if (allDeps.length === 0) return null;
                        
                        return (
                          <div className={cn("text-[9px] font-bold uppercase tracking-widest inline-flex items-center space-x-1 px-1.5 py-0.5 rounded mb-2", pendingDeps > 0 ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400")}>
                             {pendingDeps > 0 ? (
                               <>
                                 <AlertCircle size={10} />
                                 <span>{pendingDeps} Blocked</span>
                               </>
                             ) : (
                               <>
                                 <CheckCircle2 size={10} />
                                 <span>Unblocked</span>
                               </>
                             )}
                          </div>
                        );
                      })()}

                      {subtasks.length > 0 && (
                        <div className="mb-2 mt-1">
                          <div className="flex items-center justify-between text-[9px] font-bold text-subtle uppercase tracking-widest mb-1">
                            <span>Subtasks</span>
                            <span>{completedSubtasks}/{subtasks.length}</span>
                          </div>
                          <div className="w-full h-1 bg-surface-accent rounded-full overflow-hidden">
                            <div 
                              className={cn(
                                "h-full transition-all duration-300",
                                completedSubtasks === subtasks.length ? "bg-green-500" : "bg-blue-500"
                              )} 
                              style={{ width: `${(completedSubtasks / subtasks.length) * 100}%` }}
                            />
                          </div>
                          <div className="flex flex-col mt-2 space-y-1 pl-1 border-l-2 border-border-subtle/50 ml-1">
                            {subtasks.map(st => (
                              <div 
                                key={st.id} 
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('taskId', st.id);
                                  setTimeout(() => setDraggingTaskId(st.id), 0);

                                }}
                                onDragEnd={() => setDraggingTaskId(null)}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.dataTransfer.dropEffect = 'move';
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const y = e.clientY - rect.top;
                                  if (y < rect.height / 2) {
                                    e.currentTarget.style.borderTopColor = '#3b82f6';
                                    e.currentTarget.style.borderBottomColor = '';
                                  } else {
                                    e.currentTarget.style.borderTopColor = '';
                                    e.currentTarget.style.borderBottomColor = '#3b82f6';
                                  }
                                }}
                                onDragLeave={(e) => {
                                  e.currentTarget.style.borderTopColor = '';
                                  e.currentTarget.style.borderBottomColor = '';
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.currentTarget.style.borderTopColor = '';
                                  e.currentTarget.style.borderBottomColor = '';
                                  const draggedTaskId = e.dataTransfer.getData('taskId');
                                  if (!draggedTaskId || draggedTaskId === st.id) return;
                                  
                                  const draggedTask = tasks.find(t => t.id === draggedTaskId);
                                  if (!draggedTask) return;
                                  // For subtasks, only allow if same parentId (so we don't accidentally move parents into subtasks)
                                  if (draggedTask.parentId === st.parentId) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const y = e.clientY - rect.top;
                                    const position = y < rect.height / 2 ? 'before' : 'after';
                                    handleDropTask(draggedTaskId, column.id, st.id, position);
                                  }
                                }}
                                className={cn(
                                  "flex justify-between items-center bg-surface p-1.5 rounded cursor-pointer hover:bg-surface-dim border border-transparent hover:border-border-subtle",
                                  draggingTaskId === st.id && "opacity-40"
                                )}
                                onClick={(e) => { e.stopPropagation(); handleEditTask(st); }}
                              >
                                <div className="flex items-center space-x-1.5 overflow-hidden">
                                  <CornerDownRight size={10} className="text-border-strong shrink-0" />
                                  <span className={cn(
                                    "text-[10px] truncate max-w-[150px]", 
                                    st.status === 'done' ? "line-through text-subtle opacity-50" : "text-muted"
                                  )}>
                                    {st.title}
                                  </span>
                                </div>
                                <span className={cn(
                                  "w-2 h-2 rounded-full",
                                  st.status === 'done' ? 'bg-green-500' :
                                  st.status === 'in_progress' ? 'bg-blue-500' :
                                  st.status === 'review' ? 'bg-amber-500' :
                                  'bg-surface-accent'
                                )} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="mt-auto pt-2 flex items-center justify-between text-[10px] text-muted border-t border-border-subtle">
                        <div className="flex items-center space-x-1 font-mono">
                          <Calendar size={12} />
                          <span>
                            {safeFormatDate(task.deadline, 'MMM dd', 'NO DEADLINE').toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 relative group/assignee" title={assignee ? assignee.name : 'Unassigned'}>
                          <div className="cursor-pointer inline-flex relative">
                            {assignee ? (
                              <UserAvatar user={assignee} className="w-5 h-5 text-[9px] rounded" showTooltip={false} />
                            ) : (
                              <div className="w-5 h-5 rounded border border-dashed border-border-strong flex items-center justify-center text-muted group-hover:border-blue-500/50 group-hover:text-blue-400 transition-colors bg-surface-dim group-hover:bg-blue-500/10">
                                <UserPlus size={10} />
                              </div>
                            )}
                            <select 
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              value={task.assigneeId || ""}
                              onChange={(e) => {
                                e.stopPropagation();
                                const newAssigneeId = e.target.value || null;
                                setTasks(tasks.map(t => t.id === task.id ? { ...t, assigneeId: newAssigneeId } : t));
                                handleUpdateTask(task.id, task, { assigneeId: newAssigneeId });
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <option value="">Unassigned</option>
                              {users.map(u => (
                                 <option key={u.id} value={u.id}>{u.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="w-80 flex-shrink-0 flex items-center justify-center border border-dashed border-border-subtle hover:border-blue-500 hover:bg-blue-500/5 rounded-lg bg-surface-dim transition-colors cursor-pointer group" onClick={handleAddColumn}>
          <div className="flex items-center space-x-2 text-subtle group-hover:text-blue-500 transition-colors">
            <Plus size={16} />
            <span className="text-xs font-bold uppercase tracking-widest">New Column</span>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <TaskModal
          task={editingTask}
          users={users}
          tasks={tasks}
          columns={columns}
          parentId={selectedParentId}
          projectId={projectId}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveTask}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onCreateSubtask={handleCreateSubtask}
        />
      )}

      {selectedTaskIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface border border-border-subtle shadow-2xl rounded-full px-6 py-3 flex items-center space-x-6 text-sm">
          <div className="text-strong font-bold">
            {selectedTaskIds.size} task{selectedTaskIds.size > 1 ? 's' : ''} selected
          </div>
          <div className="w-px h-6 bg-surface-accent" />
          
          <div className="flex items-center space-x-3">
             <select 
               className="bg-surface-dim border border-border-subtle rounded px-3 py-1.5 text-xs text-strong uppercase font-medium hover:border-border-strong focus:outline-none cursor-pointer transition-colors"
               onChange={(e) => handleBulkUpdate({ status: e.target.value as any })}
               value=""
             >
               <option value="" disabled hidden>Change Status...</option>
               {columns.map(c => (
                 <option key={c.id} value={c.id}>{c.title}</option>
               ))}
             </select>

             <select 
               className="bg-surface-dim border border-border-subtle rounded px-3 py-1.5 text-xs text-strong uppercase font-medium hover:border-border-strong focus:outline-none cursor-pointer transition-colors"
               onChange={(e) => handleBulkUpdate({ priority: e.target.value as any })}
               value=""
             >
               <option value="" disabled hidden>Change Priority...</option>
               <option value="urgent">Urgent</option>
               <option value="high">High</option>
               <option value="medium">Medium</option>
               <option value="low">Low</option>
             </select>

             <select 
               className="bg-surface-dim border border-border-subtle rounded px-3 py-1.5 text-xs text-strong uppercase font-medium hover:border-border-strong focus:outline-none cursor-pointer transition-colors"
               onChange={(e) => handleBulkUpdate({ assigneeId: e.target.value || null })}
               value=""
             >
               <option value="" disabled hidden>Assign To...</option>
               <option value="">Unassigned</option>
               {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
             </select>
          </div>

          <div className="w-px h-6 bg-surface-accent" />
          
          <button 
            className="text-red-500 hover:text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded transition-colors flex items-center space-x-2"
            onClick={handleBulkDelete}
            title="Delete Selected"
          >
            <Trash2 size={16} />
            <span className="text-xs font-medium uppercase font-bold">Delete</span>
          </button>

          <div className="w-px h-6 bg-surface-accent" />
          
          <button 
            className="text-muted hover:text-strong hover:bg-surface-accent p-1.5 rounded-full transition-colors"
            onClick={() => setSelectedTaskIds(new Set())}
            title="Clear Selection"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {isWorkloadModalOpen && project && (
        <WorkloadModal
          projectId={project.id}
          projectName={project.name}
          onClose={() => setIsWorkloadModalOpen(false)}
        />
      )}
      {isActivityModalOpen && project && (
        <ProjectActivityModal
          projectId={project.id}
          projectName={project.name}
          users={users}
          onClose={() => setIsActivityModalOpen(false)}
        />
      )}
    </div>
  );
}
