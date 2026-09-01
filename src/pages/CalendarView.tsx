import React, { useState, useEffect } from 'react';
import { useSearchParams, Navigate, Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { Task, User, Project } from '../types';
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths,
  addWeeks,
  subWeeks,
  parseISO
} from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, CheckCircle2, Plus, FolderKanban } from 'lucide-react';
import { cn } from '../lib/utils';
import TaskModal from '../components/TaskModal';
import { fetchAllPages } from '../lib/api';
import { Tooltip } from '../components/Tooltip';

export default function CalendarView() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDateForNewTask, setSelectedDateForNewTask] = useState<Date | null>(null);

  const fetchData = async () => {
    try {
      const [tasksData, usersData, projectsData] = await Promise.all([
        fetchAllPages<Task>('/api/tasks'),
        fetchAllPages<User>('/api/users'),
        fetchAllPages<Project>('/api/projects'),
      ]);
      
      setUsers(usersData);
      setAllProjects(projectsData);
      
      if (projectId) {
        setProject(projectsData.find((p: Project) => p.id === projectId) || null);
        setTasks(tasksData.filter((t: Task) => t.projectId === projectId));
      } else {
        setProject(null);
        setTasks(tasksData);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token, projectId]);

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

  const handleSaveTask = async (taskData: Partial<Task>) => {
    const isEdit = !!selectedTask;
    const url = isEdit ? `/api/tasks/${selectedTask!.id}` : '/api/tasks';
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
        setSelectedTask(null);
        setSelectedDateForNewTask(null);
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

  const handleDeleteTask = async (taskId: string) => {

    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: { }
      });
      setSelectedTask(null);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const nextDateRange = () => {
    setCurrentDate(viewMode === 'month' ? addMonths(currentDate, 1) : addWeeks(currentDate, 1));
  };
  const prevDateRange = () => {
    setCurrentDate(viewMode === 'month' ? subMonths(currentDate, 1) : subWeeks(currentDate, 1));
  };
  const today = () => setCurrentDate(new Date());

  const startDate = viewMode === 'month' ? startOfWeek(startOfMonth(currentDate)) : startOfWeek(currentDate);
  const endDate = viewMode === 'month' ? endOfWeek(endOfMonth(currentDate)) : endOfWeek(currentDate);

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => setDraggingTaskId(taskId), 0);
  };

  const handleDragEnd = () => {
    setDraggingTaskId(null);
  };

  const handleDrop = async (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    setDraggingTaskId(null);
    const taskId = e.dataTransfer.getData('taskId');
    if (!taskId) return;

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Create a new Date at noon on the dropped date to avoid timezone weirdness
    const newDate = new Date(date);
    newDate.setHours(12, 0, 0, 0);
    const newDeadline = newDate.toISOString();
    
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, deadline: newDeadline } : t));
    
    await handleUpdateTask(taskId, task, { deadline: newDeadline });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleCreateTask = (e: React.MouseEvent, date: Date) => {
    e.stopPropagation();
    setSelectedDateForNewTask(date);
    setSelectedTask(null);
    setIsModalOpen(true);
  };

  useEffect(() => {
    const handleGlobalNewTask = () => {
      setSelectedDateForNewTask(null);
      setSelectedTask(null);
      setIsModalOpen(true);
    };
    window.addEventListener('open-new-task-modal', handleGlobalNewTask);
    return () => window.removeEventListener('open-new-task-modal', handleGlobalNewTask);
  }, []);

  if (loading) return <div className="p-8">Loading calendar...</div>;

  if (!projectId) {
    if (allProjects.length === 1) {
      return <Navigate to={`/calendar?projectId=${allProjects[0].id}`} replace />;
    }
    
    return (
      <div className="flex-1 flex flex-col p-8 bg-page-bg overflow-y-auto">
        <h1 className="text-xl font-semibold text-strong tracking-tight opacity-90 mb-2">Select a Project</h1>
        <p className="text-sm text-subtle mb-8">Choose a project to view its calendar</p>
        
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
                to={`/calendar?projectId=${p.id}`}
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
    <div className="flex-1 flex flex-col p-6 min-h-0 bg-page-bg">
      {/* Header */}
      <header className="flex justify-between items-center mb-6 shrink-0">
        <div className="flex items-center space-x-4">
          <div className="bg-blue-500/10 p-2 rounded-lg">
            <CalendarIcon className="text-blue-500" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-strong tracking-tight">Calendar</h1>
            <p className="text-xs text-muted uppercase tracking-widest mt-1">Schedule and manage deadlines</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex bg-surface border border-border-subtle rounded p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={cn(
                "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all",
                viewMode === 'month' ? "bg-blue-600 text-white" : "text-subtle hover:text-strong"
              )}
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={cn(
                "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all",
                viewMode === 'week' ? "bg-blue-600 text-white" : "text-subtle hover:text-strong"
              )}
            >
              Week
            </button>
          </div>

          <Tooltip content="Jump to current date" position="bottom">
            <button 
              onClick={today}
              className="px-4 py-2 bg-surface border border-border-subtle hover:bg-surface-accent text-strong text-xs font-bold rounded transition-colors uppercase tracking-widest shadow-sm"
            >
              Today
            </button>
          </Tooltip>
          <div className="flex items-center bg-surface border border-border-subtle rounded shadow-sm">
            <Tooltip content={viewMode === 'month' ? "Previous Month" : "Previous Week"} position="bottom">
              <button 
                onClick={prevDateRange}
                className="p-2 hover:bg-surface-accent text-muted hover:text-strong transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
            </Tooltip>
            <div className="px-4 py-2 font-bold text-strong w-56 text-center uppercase tracking-widest text-xs truncate">
              {viewMode === 'month' 
                ? format(currentDate, 'MMMM yyyy') 
                : `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`}
            </div>
            <Tooltip content={viewMode === 'month' ? "Next Month" : "Next Week"} position="bottom">
              <button 
                onClick={nextDateRange}
                className="p-2 hover:bg-surface-accent text-muted hover:text-strong transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </Tooltip>
          </div>
        </div>
      </header>

      {/* Calendar Grid */}
      <div className="flex-1 bg-surface border border-border-subtle rounded-lg flex flex-col overflow-hidden shadow-2xl">
        {/* Days of week */}
        <div className="grid grid-cols-7 border-b border-border-subtle shrink-0 bg-surface-dim">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="px-4 py-3 text-center text-[10px] font-bold text-subtle uppercase tracking-widest">
              {day}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className="flex-1 grid grid-cols-7 auto-rows-fr">
          {days.map((day, idx) => {
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isToday = isSameDay(day, new Date());
            
            // Get root tasks to display them by deadline
            const dayTasks = tasks.filter(t => {
              if (t.parentId || !t.deadline) return false;
              const date = parseISO(t.deadline);
              return !isNaN(date.getTime()) && isSameDay(date, day);
            });

            return (
              <div 
                key={day.toISOString()}
                className={cn(
                  "border-border-subtle py-2 px-2 flex flex-col gap-2 transition-colors group",
                  (viewMode === 'week' || idx > 6) && "border-t",
                  idx % 7 !== 6 && "border-r",
                  !isCurrentMonth ? "bg-surface-dim/50" : "bg-surface",
                  "hover:bg-surface-accent/30"
                )}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, day)}
              >
                <div className="flex items-center justify-between px-1">
                   <div className="flex items-center gap-1.5">
                     <div className={cn(
                       "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                       isToday 
                         ? "bg-blue-600 text-strong" 
                         : isCurrentMonth 
                           ? "text-primary" 
                           : "text-subtle opacity-50"
                     )}>
                       {format(day, 'd')}
                     </div>
                     <button
                       onClick={(e) => handleCreateTask(e, day)}
                       className="p-1 bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white rounded shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                       title="Add Task"
                     >
                       <Plus size={12} />
                     </button>
                   </div>
                   {dayTasks.length > 0 && (
                     <div className="text-[10px] text-subtle font-medium">
                       {dayTasks.length} task{dayTasks.length > 1 ? 's' : ''}
                     </div>
                   )}
                </div>

                <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                  {dayTasks.map(task => {
                     const isDone = task.status === 'done';
                     return (
                        <div
                          key={task.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, task.id)}
                          onDragEnd={handleDragEnd}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTask(task);
                            setIsModalOpen(true);
                          }}
                          className={cn(
                            "text-xs px-2 py-1.5 rounded cursor-pointer truncate transition-all border",
                            draggingTaskId === task.id && "opacity-40",
                            isDone ? "bg-surface-dim text-subtle border-border-strong opacity-60" : "bg-surface hover:bg-surface-dim text-strong shadow-[0_1px_2px_rgba(0,0,0,0.05)]",
                            !isDone && task.priority === 'urgent' ? "border-red-500/40 hover:border-red-500/60" :
                            !isDone && task.priority === 'high' ? "border-amber-500/40 hover:border-amber-500/60" :
                            !isDone && task.priority === 'medium' ? "border-blue-500/40 hover:border-blue-500/60" :
                            !isDone ? "border-border-subtle hover:border-blue-500/50" : ""
                          )}
                          title={task.title}
                        >
                          <div className="flex items-center space-x-1.5 truncate">
                            {isDone ? (
                               <CheckCircle2 size={12} className="shrink-0" />
                            ) : (
                               <Clock size={12} className="shrink-0 text-muted" />
                            )}
                            <span className={cn("truncate", isDone && "line-through")}>{task.title}</span>
                          </div>
                        </div>
                     );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isModalOpen && (
        <TaskModal
          task={selectedTask}
          users={users}
          tasks={tasks}
          projectId={projectId}
          initialDeadline={selectedDateForNewTask ? (() => { 
            const d = new Date(selectedDateForNewTask); 
            d.setHours(12,0,0,0); 
            return d.toISOString(); 
          })() : undefined}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedTask(null);
            setSelectedDateForNewTask(null);
          }}
          onSave={handleSaveTask}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
        />
      )}
    </div>
  );
}
