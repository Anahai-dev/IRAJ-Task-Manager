import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Task, User, Project } from '../types';
import TaskModal from '../components/TaskModal';
import { Plus, Search, Filter, FolderKanban, Workflow, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { canCreateTasks } from '../lib/permissions';
import { useSearchParams, Link, Navigate } from 'react-router';
import TaskDiagram from '../components/TaskDiagram';
import Markdown from 'react-markdown';

import { Column, DEFAULT_COLUMNS } from './Board';

type SortOption = 'custom' | 'priority' | 'deadline' | 'createdAt';
type SortDirection = 'asc' | 'desc';

export default function Graph() {
  const { token, user } = useAuth();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  
  const [columns, setColumns] = useState<Column[]>(() => {
    try {
      const saved = localStorage.getItem(`board-columns-${projectId || 'all'}`);
      return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
    } catch (e) {
      return DEFAULT_COLUMNS;
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`board-columns-${projectId || 'all'}`);
      setColumns(saved ? JSON.parse(saved) : DEFAULT_COLUMNS);
    } catch (e) {
      setColumns(DEFAULT_COLUMNS);
    }
  }, [projectId]);

  const fetchData = async () => {
    if (!token) return;
    try {
      const results = await Promise.all([
        fetch('/api/tasks', { headers: { } }),
        fetch('/api/users', { headers: { } }),
        fetch('/api/projects', { headers: { } })
      ]);
      
      const tasksData: Task[] = await results[0].json();
      const usersData = await results[1].json();
      const projectsData: Project[] = await results[2].json();
      
      setAllProjects(projectsData);
      
      if (projectId) {
        const found = projectsData.find((p: Project) => p.id === projectId);
        setProject(found || null);
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

  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (filterAssignee !== 'all') {
      result = result.filter(t => t.assigneeId === filterAssignee);
    }
    
    if (filterPriority !== 'all') {
      result = result.filter(t => t.priority === filterPriority);
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
  }, [tasks, searchQuery, filterAssignee, filterPriority]);

  const handleCreateTask = () => {
    setEditingTask(null);
    setIsModalOpen(true);
  };

  useEffect(() => {
    const handleGlobalNewTask = () => handleCreateTask();
    window.addEventListener('open-new-task-modal', handleGlobalNewTask);
    return () => window.removeEventListener('open-new-task-modal', handleGlobalNewTask);
  }, []);

  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setIsModalOpen(true);
  };

  const handleSaveTask = async (taskData: Partial<Task>) => {
    const isEdit = !!editingTask;
    const url = isEdit ? `/api/tasks/${editingTask!.id}` : '/api/tasks';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(taskData)
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchData();
      } else {
        const errData = await res.text();
        alert(`Failed to save task: ${errData}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Error saving task: ${err.message}`);
    }
  };

  const handleUpdateTask = async (taskId: string, currentTask: Task, updates: Partial<Task>) => {
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ ...currentTask, ...updates })
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {

    await fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { }
    });
    setIsModalOpen(false);
    fetchData();
  };

  if (loading) return <div className="p-8 text-primary">Loading graph...</div>;

  if (!projectId) {
    if (allProjects.length === 1) {
      return <Navigate to={`/graph?projectId=${allProjects[0].id}`} replace />;
    }

    return (
      <div className="flex-1 flex flex-col p-8 bg-page-bg overflow-y-auto">
        <h1 className="text-xl font-semibold text-strong tracking-tight opacity-90 mb-2">Select a Project</h1>
        <p className="text-sm text-subtle mb-8">Choose a project to view its task graph</p>
        
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
                to={`/graph?projectId=${p.id}`}
                className="block p-6 bg-surface border border-border-subtle hover:border-blue-500/50 rounded-lg transition-all hover:shadow-lg group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 bg-blue-500/10 text-blue-500 rounded group-hover:scale-110 transition-transform">
                    <Workflow size={24} />
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
    <div className="tour-graph-view flex-1 flex flex-col p-6 min-h-0 bg-page-bg">
      <div className="flex justify-between items-start lg:items-center mb-6 shrink-0 flex-col lg:flex-row gap-4">
        <div>
          {project && (
            <>
              <h1 className="text-xl font-semibold text-strong tracking-tight flex items-center gap-2">
                <Workflow size={20} className="text-blue-500" />
                {project.name} <span className="text-sm font-normal text-subtle">Task Graph</span>
              </h1>
              <div className="text-xs text-subtle mt-1 prose dark:prose-invert prose-sm line-clamp-1">
                {project.description ? (
                  <Markdown>{project.description}</Markdown>
                ) : (
                  'Project Task Graph'
                )}
                <span className="ml-2 font-normal opacity-75">(Drag a connection between tasks to add dependency. Double-click connection to remove.)</span>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
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
          <div className="flex items-center space-x-2 bg-surface border border-border-subtle rounded px-3 py-1.5 text-[10px] flex-wrap">
            <Filter size={12} className="text-subtle shrink-0" />
            <div className="flex items-center gap-1 group/select cursor-pointer">
              <select 
                className="bg-transparent text-strong uppercase outline-none cursor-pointer font-bold tracking-wider appearance-none focus:outline-none group-hover/select:text-blue-400 transition-colors"
                value={filterAssignee}
                onChange={(e) => setFilterAssignee(e.target.value)}
              >
                <option value="all" className="bg-surface">ALL USERS</option>
                {user && <option value={user.id} className="bg-surface">ASSIGNED TO ME</option>}
                {users.filter(u => u.id !== user?.id).map(u => <option key={u.id} value={u.id} className="bg-surface">{u.name}</option>)}
              </select>
              <ChevronDown size={10} className="text-muted group-hover/select:text-blue-400 transition-colors pointer-events-none" />
            </div>
            <span className="text-border-strong px-1">|</span>
            <div className="flex items-center gap-1 group/select cursor-pointer">
              <select 
                className="bg-transparent text-strong uppercase outline-none cursor-pointer font-bold tracking-wider appearance-none focus:outline-none group-hover/select:text-blue-400 transition-colors"
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
              >
                <option value="all" className="bg-surface">ALL PRIORITIES</option>
                <option value="urgent" className="bg-surface">URGENT</option>
                <option value="high" className="bg-surface">HIGH</option>
                <option value="medium" className="bg-surface">MEDIUM</option>
                <option value="low" className="bg-surface">LOW</option>
              </select>
              <ChevronDown size={10} className="text-muted group-hover/select:text-blue-400 transition-colors pointer-events-none" />
            </div>
          </div>
          <Link
            to={`/board?projectId=${projectId}`}
            className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 hover:border-blue-500 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 text-xs font-bold rounded shadow-sm hover:scale-105 transition-all flex items-center space-x-2"
          >
            <FolderKanban size={14} className="text-blue-400" />
            <span>TASK BOARD</span>
          </Link>
          {canCreateTasks(user) && (
            <button
              onClick={handleCreateTask}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow hover:scale-105 transition-all flex items-center space-x-2"
            >
              <Plus size={14} />
              <span>NEW TASK</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 border border-border-subtle rounded overflow-hidden">
        <TaskDiagram 
           tasks={filteredTasks} 
           layoutKey={`${searchQuery}-${filterAssignee}-${filterPriority}`}
           onTaskDoubleClick={(taskId) => {
             const task = tasks.find(t => t.id === taskId);
             if (task) handleEditTask(task);
           }}
           onConnectTask={(sourceId, targetId) => {
             const targetTask = tasks.find(t => t.id === targetId);
             if (targetTask) {
               const deps = targetTask.dependencies || [];
               if (!deps.includes(sourceId) && sourceId !== targetId) {
                 handleUpdateTask(targetId, targetTask, { dependencies: [...deps, sourceId] });
               }
             }
           }}
           onReverseConnection={(sourceId, targetId) => {
             const targetTask = tasks.find(t => t.id === targetId);
             const sourceTask = tasks.find(t => t.id === sourceId);
             
             if (targetTask && sourceTask) {
               const targetDeps = targetTask.dependencies || [];
               const newTargetDeps = targetDeps.filter(id => id !== sourceId);
               
               const sourceDeps = sourceTask.dependencies || [];
               const newSourceDeps = Array.from(new Set([...sourceDeps, targetId]));
               
               handleUpdateTask(targetId, targetTask, { dependencies: newTargetDeps });
               handleUpdateTask(sourceId, sourceTask, { dependencies: newSourceDeps });
             }
           }}
           onRemoveConnection={(sourceId, targetId) => {
             const targetTask = tasks.find(t => t.id === targetId);
             if (targetTask) {
               const deps = targetTask.dependencies || [];
               handleUpdateTask(targetId, targetTask, { dependencies: deps.filter(id => id !== sourceId) });
             }
           }}
        />
      </div>

      {isModalOpen && (
        <TaskModal
          task={editingTask}
          users={users}
          tasks={tasks}
          columns={columns}
          parentId={null}
          projectId={projectId}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveTask}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onCreateSubtask={() => {}} // No subtask creation from graph root view directly unless we add it
        />
      )}
    </div>
  );
}
