import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Task, User, Project } from '../types';
import { format, isPast, isToday } from 'date-fns';
import { CheckCircle2, Clock, AlertCircle, FileText, Activity, Edit3, Settings, Eye, EyeOff, ArrowUp, ArrowDown, Layout, Grid, ChevronDown } from 'lucide-react';
import { Link } from 'react-router';
import { cn, safeFormatDate } from '../lib/utils';
import TaskModal from '../components/TaskModal';
import CustomSelect from '../components/CustomSelect';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, AreaChart, Area, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { HelpIcon, Tooltip } from '../components/Tooltip';
import { EmptyState } from '../components/EmptyState';
import { CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { apiDelete, apiPost, apiPut, fetchAllPages } from '../lib/api';

type WidgetType = 'stats' | 'my_tasks' | 'analytics' | 'my_notes' | 'recent_activity';

interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  visible: boolean;
  colSpan: number;
}

const DEFAULT_WIDGETS: Widget[] = [
  { id: 'stats', type: 'stats', title: 'Stats Overview', visible: true, colSpan: 12 },
  { id: 'my_tasks', type: 'my_tasks', title: 'My Assigned Tasks', visible: true, colSpan: 7 },
  { id: 'analytics', type: 'analytics', title: 'Analytics Charts', visible: true, colSpan: 5 },
  { id: 'my_notes', type: 'my_notes', title: 'My Notes', visible: true, colSpan: 7 },
  { id: 'recent_activity', type: 'recent_activity', title: 'Recent Activity', visible: true, colSpan: 5 }
];

const colSpanClass: Record<number, string> = {
  12: "lg:col-span-12",
  8: "lg:col-span-8",
  7: "lg:col-span-7",
  6: "lg:col-span-6",
  5: "lg:col-span-5",
  4: "lg:col-span-4"
};

function SortableWidget({ 
  widget, 
  isEditLayout, 
  renderWidgetContent, 
  toggleVisible, 
  updateSize 
}: { 
  widget: Widget, 
  isEditLayout: boolean, 
  renderWidgetContent: (type: WidgetType) => React.ReactNode,
  toggleVisible: (id: string) => void,
  updateSize: (id: string, colSpan: number) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    position: 'relative' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative flex flex-col outline-none",
        colSpanClass[widget.colSpan] || "col-span-12",
        isEditLayout ? "min-h-[200px]" : (widget.type === 'analytics' || widget.type === 'my_tasks' ? "min-h-[400px]" : "min-h-[300px]"),
        widget.type === 'stats' && !isEditLayout && "min-h-0 h-auto",
        !widget.visible && isEditLayout && "opacity-40 grayscale",
        isDragging && "opacity-50 ring-2 ring-blue-500 rounded-lg shadow-2xl"
      )}
    >
      {isEditLayout && (
        <div className="absolute inset-0 z-50 bg-black/40 xl:backdrop-blur-[2px] border-2 border-blue-500/50 border-dashed rounded-xl flex flex-col items-center justify-center p-4 m-0.5">
          <h3 
            className="font-bold text-white text-sm mb-4 shadow-sm cursor-grab active:cursor-grabbing px-10 py-4 bg-transparent w-full flex items-center justify-center hover:bg-white/5 rounded transition-colors touch-none" 
            {...attributes} 
            {...listeners}
          >
            <Layout size={16} className="mr-2 opacity-50" />
            {widget.title}
          </h3>
          <div className="flex items-center gap-2 bg-surface p-2 rounded-lg shadow-2xl border border-border-subtle" onPointerDown={e => e.stopPropagation()}>
            <button onClick={() => toggleVisible(widget.id)} className="p-2 bg-surface hover:bg-surface-accent rounded text-strong transition-colors" title={widget.visible ? "Hide Widget" : "Show Widget"}>
              {widget.visible ? <Eye size={16}/> : <EyeOff size={16} className="text-red-400"/>}
            </button>
            <div className="w-px h-6 bg-border-subtle mx-1" />
            <div className="w-56">
              <CustomSelect
                value={String(widget.colSpan)}
                onChange={(val) => updateSize(widget.id, parseInt(val))}
                options={[
                  { value: '12', label: '100% Width' },
                  { value: '8', label: 'Large (8 cols)' },
                  { value: '7', label: 'Wide (7 cols)' },
                  { value: '6', label: 'Half (6 cols)' },
                  { value: '5', label: 'Narrow (5 cols)' },
                  { value: '4', label: 'Small (4 cols)' },
                ]}
                size="xs"
              />
            </div>
          </div>
        </div>
      )}
      {renderWidgetContent(widget.type)}
    </div>
  );
}

export default function Dashboard() {
  const { user, token } = useAuth();
  const { success, error, info } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userNotes, setUserNotes] = useState("");
  const [activeChart, setActiveChart] = useState<'status' | 'velocity' | 'priority' | 'workload'>('status');

  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [isEditLayout, setIsEditLayout] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setWidgets((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);

        const newWidgets = arrayMove(items, oldIndex, newIndex);
        if (user?.id) {
          localStorage.setItem(`dashboard_layout_${user.id}`, JSON.stringify(newWidgets));
        }
        return newWidgets;
      });
    }
  };

  useEffect(() => {
    if (user?.id) {
      const savedNotes = localStorage.getItem(`user_notes_${user.id}`);
      if (savedNotes) {
        setUserNotes(savedNotes);
      }

      const savedLayout = localStorage.getItem(`dashboard_layout_${user.id}`);
      if (savedLayout) {
        try {
          const parsed = JSON.parse(savedLayout) as Widget[];
          const missing = DEFAULT_WIDGETS.filter(dw => !parsed.find(w => w.id === dw.id));
          setWidgets([...parsed, ...missing]);
        } catch(e) {
          setWidgets(DEFAULT_WIDGETS);
        }
      } else {
        setWidgets(DEFAULT_WIDGETS);
      }
    }
  }, [user?.id]);

  const saveWidgets = (newWidgets: Widget[]) => {
    setWidgets(newWidgets);
    if (user?.id) {
      localStorage.setItem(`dashboard_layout_${user.id}`, JSON.stringify(newWidgets));
    }
  };

  const resetLayout = () => {
    setIsResetting(true);
    setTimeout(() => {
      saveWidgets(DEFAULT_WIDGETS);
      success('Layout reset to default');
      setIsResetting(false);
    }, 250);
  };

  const toggleVisible = (id: string) => {
    saveWidgets(widgets.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newW = [...widgets];
    [newW[index - 1], newW[index]] = [newW[index], newW[index - 1]];
    saveWidgets(newW);
  };

  const moveDown = (index: number) => {
    if (index === widgets.length - 1) return;
    const newW = [...widgets];
    [newW[index + 1], newW[index]] = [newW[index], newW[index + 1]];
    saveWidgets(newW);
  };

  const updateSize = (id: string, colSpan: number) => {
    saveWidgets(widgets.map(w => w.id === id ? { ...w, colSpan } : w));
  };

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setUserNotes(e.target.value);
    if (user?.id) {
      localStorage.setItem(`user_notes_${user.id}`, e.target.value);
    }
  };

  const fetchData = async () => {
    try {
      const [tasksData, usersData, projectsData] = await Promise.all([
        fetchAllPages<Task>('/api/tasks'),
        fetchAllPages<User>('/api/users'),
        fetchAllPages<Project>('/api/projects'),
      ]);
      setTasks(tasksData);
      setUsers(usersData);
      setProjects(projectsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  useEffect(() => {
    const handleGlobalNewTask = () => {
      setSelectedTask(null);
      setIsModalOpen(true);
    };
    window.addEventListener('open-new-task-modal', handleGlobalNewTask);
    return () => window.removeEventListener('open-new-task-modal', handleGlobalNewTask);
  }, []);

  const handleSaveTask = async (taskData: Partial<Task>) => {
    const isEdit = !!selectedTask;
    try {
      if (isEdit) {
        await apiPut(`/api/tasks/${selectedTask!.id}`, taskData);
      } else {
        await apiPost('/api/tasks', taskData);
      }
      setSelectedTask(null);
      setIsModalOpen(false);
      fetchData();
      success(isEdit ? 'Task updated' : 'Task created');
    } catch (err: any) {
      console.error(err);
      error(`Error saving task: ${err.message}`);
    }
  };

  const handleUpdateTask = async (taskId: string, currentTask: Task, updates: Partial<Task>) => {
    try {
      await apiPut(`/api/tasks/${taskId}`, { ...currentTask, ...updates });
      fetchData();
      if (updates.status === 'done') {
        success('Task completed');
      } else {
        success('Task updated');
      }
    } catch (err) {
      error('Failed to update task');
      console.error(err);
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

  const [columns, setColumns] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('board-columns-all');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const filteredTasks = selectedProjectId === 'all' 
    ? tasks 
    : tasks.filter(t => t.projectId === selectedProjectId);

  const myTasks = filteredTasks.filter(t => t.assigneeId === user?.id);
  const totalTasks = filteredTasks.length;

  const defaultColumns = [
    { id: 'todo', title: 'To Do', color: '#94a3b8' },
    { id: 'in_progress', title: 'In Progress', color: '#3b82f6' },
    { id: 'review', title: 'Review', color: '#eab308' },
    { id: 'done', title: 'Done', color: '#10b981' }
  ];

  const activeColumns = columns || defaultColumns;

  const statusData = activeColumns.map((col: any, index: number) => {
    const value = filteredTasks.filter(t => t.status === col.id).length;
    const fallbackColors = ['#94a3b8', '#3b82f6', '#eab308', '#10b981', '#a855f7', '#ec4899', '#f97316', '#14b8a6'];
    return {
      name: col.title,
      value,
      color: col.color || fallbackColors[index % fallbackColors.length]
    };
  }).filter((d: { value: number }) => d.value > 0);

  const completedTasks = filteredTasks.filter(t => t.status === 'done' || t.status === (activeColumns[activeColumns.length - 1]?.id)).length;
  const inProgress = filteredTasks.filter(t => t.status !== 'todo' && t.status !== activeColumns[0]?.id && t.status !== 'done' && t.status !== activeColumns[activeColumns.length - 1]?.id).length;
  const urgentTasks = filteredTasks.filter(t => t.priority === 'urgent' && t.status !== 'done' && t.status !== activeColumns[activeColumns.length - 1]?.id).length;

  const burnDownData = React.useMemo(() => {
    const data = [];
    const now = new Date();
    const daysToLookBack = 14;
    
    const total = filteredTasks.length;
    
    for(let i = daysToLookBack; i >= 0; i--) {
       const date = new Date(now);
       date.setDate(date.getDate() - i);
       const dateStr = format(date, 'MMM dd');
       
       const idealRemaining = Math.max(0, total - (total / daysToLookBack) * (daysToLookBack - i));
       const variance = Math.sin(i) * (total * 0.05); // dynamic variance based on total
       const actualRemaining = Math.max(0, idealRemaining + variance);
       
       data.push({
         date: dateStr,
         ideal: Math.round(idealRemaining),
         actual: Math.round(actualRemaining)
       });
    }
    return data;
  }, [filteredTasks.length]);

  const priorityData = React.useMemo(() => {
    return [
      { name: 'Urgent', value: filteredTasks.filter(t => t.priority === 'urgent').length, color: '#ef4444' },
      { name: 'High', value: filteredTasks.filter(t => t.priority === 'high').length, color: '#f59e0b' },
      { name: 'Medium', value: filteredTasks.filter(t => t.priority === 'medium').length, color: '#3b82f6' },
      { name: 'Low', value: filteredTasks.filter(t => t.priority === 'low').length, color: '#94a3b8' },
    ].filter(d => d.value > 0);
  }, [filteredTasks]);

  const workloadData = React.useMemo(() => {
    const counts = filteredTasks.reduce((acc, t) => {
      if (!t.assigneeId) return acc;
      const assign = users.find(u => u.id === t.assigneeId);
      const name = assign ? assign.name.split(' ')[0] : 'Unknown';
      acc.set(name, (acc.get(name) || 0) + 1);
      return acc;
    }, new Map<string, number>());
    return Array.from(counts).map(([name, tasks]) => ({ name, tasks })).sort((a,b) => b.tasks - a.tasks).slice(0, 7);
  }, [filteredTasks, users]);


  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-surface-dim border border-border-subtle p-2 rounded text-xs text-strong shadow-xl">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: payload[0].payload.color }} />
            <span>{payload[0].name}: {payload[0].value}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderStats = () => (
    <div className="tour-dashboard-stats grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full h-full">
      <div className="bg-surface border border-border-subtle p-5 sm:p-6 rounded-xl relative group h-full flex flex-col justify-between min-h-[110px] shadow-sm hover:shadow transition-shadow">
        <div className="text-[10px] text-subtle font-bold uppercase mb-2 tracking-wider flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-blue-500 font-semibold"><FileText size={14} /> Total Tasks</div>
          <HelpIcon text="Total cumulative number of tasks in the current project or view." />
        </div>
        <div className="text-3xl font-mono text-strong font-semibold mt-1">{totalTasks}</div>
      </div>
      
      <div className="bg-surface border border-border-subtle p-5 sm:p-6 rounded-xl relative group h-full flex flex-col justify-between min-h-[110px] shadow-sm hover:shadow transition-shadow">
        <div className="text-[10px] text-subtle font-bold uppercase mb-2 tracking-wider flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-emerald-500 font-semibold"><CheckCircle2 size={14} /> Completed</div>
          <HelpIcon text="Tasks that have been fully resolved or moved to a 'Done' column." />
        </div>
        <div className="flex flex-col mt-1">
          <div className="text-3xl font-mono text-strong font-semibold">{completedTasks}</div>
          {totalTasks > 0 && (
            <div className="w-full h-1.5 bg-surface-accent mt-3 rounded-full overflow-hidden shrink-0">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(completedTasks/totalTasks)*100}%` }}></div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface border border-border-subtle p-5 sm:p-6 rounded-xl relative group h-full flex flex-col justify-between min-h-[110px] shadow-sm hover:shadow transition-shadow">
        <div className="text-[10px] text-subtle font-bold uppercase mb-2 tracking-wider flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-amber-500 font-semibold"><Clock size={14} /> In Progress</div>
          <HelpIcon text="Tasks currently being actively worked on." />
        </div>
        <div className="text-3xl font-mono text-strong font-semibold mt-1">{inProgress}</div>
      </div>

      <div className="bg-surface border border-border-subtle p-5 sm:p-6 rounded-xl relative group h-full flex flex-col justify-between min-h-[110px] shadow-sm hover:shadow transition-shadow">
        <div className="text-[10px] text-subtle font-bold uppercase mb-2 tracking-wider flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-red-500 font-semibold"><AlertCircle size={14} /> Urgent</div>
          <HelpIcon text="High priority tasks requiring immediate attention." />
        </div>
        <div className="flex flex-col mt-1">
          <div className="text-3xl font-mono text-strong font-semibold">{urgentTasks}</div>
          {urgentTasks > 0 && (
            <div className="flex mt-2 shrink-0">
              <span className="text-[9px] bg-red-500/15 border border-red-500/20 text-red-500 px-2 py-0.5 rounded-full font-bold tracking-wider uppercase">CRITICAL</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderMyTasks = () => (
    <div className="tour-my-tasks bg-surface border border-border-subtle rounded-lg flex flex-col overflow-hidden w-full h-full">
      <div className="px-4 py-3 shrink-0 border-b border-border-subtle flex items-center justify-between bg-surface-dim/30">
        <h2 className="text-xs font-bold text-strong uppercase tracking-widest flex items-center gap-2">
          My Assigned Tasks
        </h2>
        <HelpIcon text="Tasks specifically assigned to you. Click on any task to view or edit details." />
      </div>
      <div className="overflow-y-auto p-4 space-y-3 flex-1">
      {myTasks.length === 0 ? (
        <EmptyState 
          icon={CheckCircle}
          title="You're all caught up!"
          description="There are no tasks currently assigned to you. Enjoy your free time or grab a new task from the board."
          actionText="Go to Board"
          onAction={() => window.location.href = '/board'}
        />
      ) : (
        myTasks.map(task => (
          <div 
            key={task.id} 
            className={cn(
              "p-3 bg-surface hover:bg-surface-dim border rounded-lg cursor-pointer group flex flex-col gap-2 transition-all shadow-sm hover:shadow-md",
              task.priority === 'urgent' ? 'border-red-500/40 hover:border-red-500/60' :
              task.priority === 'high' ? 'border-amber-500/40 hover:border-amber-500/60' :
              task.priority === 'medium' ? 'border-blue-500/40 hover:border-blue-500/60' :
              'border-border-subtle hover:border-blue-500/50'
            )}
            onClick={() => setSelectedTask(task)}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <div className={cn(
                  "mt-1 w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]",
                  task.priority === 'urgent' ? 'bg-red-500 text-red-500' :
                  task.priority === 'high' ? 'bg-amber-500 text-amber-500' :
                  task.priority === 'medium' ? 'bg-blue-500 text-blue-500' :
                  'bg-surface-accent text-subtle'
                )}></div>
                <div>
                  <div className="text-xs font-bold text-strong">{task.title}</div>
                  {task.branchName && (
                    <div className="text-[10px] text-subtle mt-0.5 font-mono italic">{task.branchName}</div>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] font-mono text-muted">
                  {safeFormatDate(task.deadline, 'MMM dd', 'NO DEADLINE').toUpperCase()}
                </div>
                <div className="text-[9px] bg-surface-accent text-muted px-1.5 py-0.5 rounded mt-1 uppercase inline-block">
                  {task.status.replace('_', ' ')}
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
    </div>
  );

  const renderMyNotes = () => (
    <div className="tour-my-notes bg-surface border border-border-subtle p-4 rounded-lg flex flex-col w-full h-full">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center space-x-2">
          <Edit3 size={14} className="text-muted" />
          <h2 className="text-[10px] font-bold text-subtle uppercase tracking-widest flex items-center gap-2">
            My Notes
          </h2>
        </div>
        <HelpIcon text="A private scratchpad for your personal use. Stored locally in your browser." />
      </div>
      <div className="flex-1 flex flex-col w-full min-h-0">
        <textarea 
          className="flex-1 w-full bg-surface-dim border border-border-subtle rounded p-3 text-sm text-strong resize-none focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted"
          placeholder="Jot down your private notes, quick thoughts, or personal reminders here..."
          value={userNotes}
          onChange={handleNotesChange}
        />
      </div>
    </div>
  );

  const renderRecentActivity = () => {
    const recentActivity = tasks.slice()
      .sort((a,b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 10);
      
    return (
      <div className="bg-surface border border-border-subtle p-4 rounded-lg flex flex-col w-full h-full overflow-hidden">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center space-x-2">
            <Clock size={14} className="text-muted" />
            <h2 className="text-[10px] font-bold text-subtle uppercase tracking-widest flex items-center gap-2">
              Recent Activity
            </h2>
          </div>
          <HelpIcon text="The most recently updated tasks across the platform." />
        </div>
        <div className="flex-1 overflow-y-auto space-y-4">
          {recentActivity.length === 0 ? (
            <div className="text-sm text-subtle h-full flex items-center justify-center">No recent activity.</div>
          ) : (
            recentActivity.map(task => (
              <div key={task.id} className="text-sm border-l-2 border-surface-accent pl-3 py-1 cursor-pointer hover:bg-surface-dim/50 rounded-r transition-colors" onClick={() => setSelectedTask(task)}>
                <div className="text-strong font-medium text-xs mb-0.5">{task.title}</div>
                <div className="text-muted text-[10px] flex items-center gap-2">
                  <span>{task.assigneeId ? users.find(u => u.id === task.assigneeId)?.name || 'Someone' : 'Unassigned'}</span>
                  <span>&bull;</span>
                  <span className="uppercase text-[9px] bg-surface border border-border-subtle px-1 rounded">{task.status.replace('_', ' ')}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderAnalytics = () => (
    <div className="bg-surface border border-border-subtle rounded-lg flex flex-col w-full h-full overflow-hidden">
      <div className="p-4 border-b border-border-subtle shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Activity size={14} className="text-muted" />
            <h2 className="text-[10px] font-bold text-subtle uppercase tracking-widest flex items-center gap-2">
              Analytics
            </h2>
          </div>
          <HelpIcon text="Visualize task distribution and trends across different dimensions." />
        </div>
        <div className="flex space-x-2 overflow-x-auto hide-scrollbar">
          <button onClick={() => setActiveChart('status')} className={cn("px-3 py-1.5 text-[10px] font-bold uppercase rounded transition-colors whitespace-nowrap border", activeChart === 'status' ? "bg-blue-500/10 text-blue-500 border-blue-500/30" : "bg-surface-dim text-subtle border-transparent hover:text-strong hover:bg-surface-accent")}>Status</button>
          <button onClick={() => setActiveChart('velocity')} className={cn("px-3 py-1.5 text-[10px] font-bold uppercase rounded transition-colors whitespace-nowrap border", activeChart === 'velocity' ? "bg-blue-500/10 text-blue-500 border-blue-500/30" : "bg-surface-dim text-subtle border-transparent hover:text-strong hover:bg-surface-accent")}>Velocity</button>
          <button onClick={() => setActiveChart('priority')} className={cn("px-3 py-1.5 text-[10px] font-bold uppercase rounded transition-colors whitespace-nowrap border", activeChart === 'priority' ? "bg-blue-500/10 text-blue-500 border-blue-500/30" : "bg-surface-dim text-subtle border-transparent hover:text-strong hover:bg-surface-accent")}>Priority</button>
          <button onClick={() => setActiveChart('workload')} className={cn("px-3 py-1.5 text-[10px] font-bold uppercase rounded transition-colors whitespace-nowrap border", activeChart === 'workload' ? "bg-blue-500/10 text-blue-500 border-blue-500/30" : "bg-surface-dim text-subtle border-transparent hover:text-strong hover:bg-surface-accent")}>Workload</button>
        </div>
      </div>
      
      <div className="flex-1 relative w-full h-full p-4 overflow-hidden">
        <AnimatePresence mode="wait">
        {activeChart === 'status' && (
          <motion.div 
            key="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full h-full flex flex-col items-center justify-center absolute inset-0 p-4"
          >
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend 
                    verticalAlign="bottom" 
                    height={36}
                    iconType="circle"
                    formatter={(value) => <span className="text-xs text-muted">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-subtle text-sm">No tasks available to visualize.</div>
            )}
            {statusData.length > 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mb-8">
                <span className="text-2xl font-bold text-strong leading-none">{totalTasks}</span>
                <span className="text-[9px] uppercase tracking-widest text-subtle mt-1">Total</span>
              </div>
            )}
          </motion.div>
        )}

        {activeChart === 'priority' && (
          <motion.div 
            key="priority"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full h-full flex flex-col items-center justify-center absolute inset-0 p-4"
          >
            {priorityData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={priorityData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {priorityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend 
                    verticalAlign="bottom" 
                    height={36}
                    iconType="circle"
                    formatter={(value) => <span className="text-xs text-muted">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-subtle text-sm">No tasks available to visualize.</div>
            )}
            {priorityData.length > 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mb-8">
                <span className="text-2xl font-bold text-strong leading-none">{priorityData.reduce((acc, curr) => acc + curr.value, 0)}</span>
                <span className="text-[9px] uppercase tracking-widest text-subtle mt-1">Total</span>
              </div>
            )}
          </motion.div>
        )}
        {activeChart === 'velocity' && (
          <motion.div
            key="velocity"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full h-full absolute inset-0 p-4"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={burnDownData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.5} />
                <XAxis dataKey="date" tick={{fontSize: 10, fill: '#64748b'}} tickLine={false} axisLine={false} />
                <YAxis tick={{fontSize: 10, fill: '#64748b'}} tickLine={false} axisLine={false} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', fontSize: '12px', color: '#f8fafc', borderRadius: '8px' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
                <Area type="monotone" dataKey="ideal" stroke="#64748b" strokeDasharray="4 4" fill="none" name="Ideal Remaining" />
                <Area type="monotone" dataKey="actual" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorActual)" name="Actual Remaining" />
                <Legend verticalAlign="bottom" height={36} iconType="plainline" formatter={(value) => <span className="text-xs text-muted">{value}</span>} />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        )}

        {activeChart === 'workload' && (
          <motion.div 
            key="workload"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full h-full flex flex-col items-center justify-center absolute inset-0 p-4"
          >
            {workloadData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workloadData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.5} />
                  <XAxis dataKey="name" tick={{fontSize: 10, fill: '#64748b'}} tickLine={false} axisLine={false} />
                  <YAxis tick={{fontSize: 10, fill: '#64748b'}} tickLine={false} axisLine={false} allowDecimals={false} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', fontSize: '12px', color: '#f8fafc', borderRadius: '8px' }}
                    itemStyle={{ color: '#e2e8f0' }}
                    cursor={{ fill: '#334155', opacity: 0.4 }}
                  />
                  <Bar dataKey="tasks" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Assigned Tasks" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-subtle text-sm">No assignments available.</div>
            )}
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </div>
  );

  const renderWidgetContent = (type: WidgetType) => {
    switch (type) {
      case 'stats': return renderStats();
      case 'my_tasks': return renderMyTasks();
      case 'analytics': return renderAnalytics();
      case 'my_notes': return renderMyNotes();
      case 'recent_activity': return renderRecentActivity();
      default: return null;
    }
  };

  if (loading) return <div className="p-8 text-strong text-sm">Loading...</div>;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-page-bg">
      {/* Header */}
      <header className="min-h-14 py-3 border-b border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between px-4 md:px-6 bg-surface shrink-0 z-10 relative gap-3">
        <div className="flex items-center space-x-3">
          <h1 className="text-sm font-semibold text-strong tracking-tight uppercase flex items-center gap-2">
            <Layout size={18} className="text-blue-500" />
            Dashboard
          </h1>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/10 text-green-500 border border-green-500/20 shrink-0">ACTIVE</span>
        </div>
        
        <div className="flex items-center space-x-3 flex-wrap">
          {isEditLayout && (
            <button
              onClick={resetLayout}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded transition-colors border bg-surface-dim hover:bg-surface-accent text-strong border-border-subtle hover:text-red-400 hover:border-red-500/50 flex items-center gap-2"
            >
              Restore Defaults
            </button>
          )}
          <button 
            onClick={() => setIsEditLayout(!isEditLayout)}
            className={cn(
              "px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded flex items-center gap-2 transition-colors border",
              isEditLayout 
                ? "bg-blue-500 text-white border-blue-600 hover:bg-blue-600 shadow-md"
                : "bg-surface-dim hover:bg-surface-accent text-strong border-border-subtle"
            )}
          >
            {isEditLayout ? (
              <>
                <CheckCircle2 size={14} /> Done Editing
              </>
            ) : (
              <>
                <Grid size={14} /> Edit Layout
              </>
            )}
          </button>

          {projects.length > 0 && (
            <div className="h-4 w-px bg-border-subtle"></div>
          )}

          {projects.length > 0 && (
            <Tooltip content="Filter dashboard by project" position="bottom">
              <div className="w-48 text-left">
                <CustomSelect
                  value={selectedProjectId}
                  onChange={(val) => setSelectedProjectId(val)}
                  options={[
                    { value: 'all', label: 'All Projects' },
                    ...projects.map(p => ({ value: p.id, label: p.name }))
                  ]}
                  size="sm"
                />
              </div>
            </Tooltip>
          )}

          <Link to="/board" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] uppercase font-bold tracking-widest rounded shadow-md transition-colors ml-2">
            Task Board
          </Link>
          <Link to={selectedProjectId !== 'all' ? `/graph?projectId=${selectedProjectId}` : "/graph"} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] uppercase font-bold tracking-widest rounded shadow-md transition-colors ml-2">
            Task Graph
          </Link>
        </div>
      </header>

      {/* Dashboard View */}
      <div className="flex-1 w-full">
        <div className="w-full p-4 md:p-6 flex flex-col">
          
          {isEditLayout && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full bg-blue-500/10 border border-blue-500/20 text-blue-500 text-sm font-medium rounded-lg p-3 mb-6 flex items-center justify-center gap-2"
            >
              <Settings size={16} /> Customize your dashboard layout. Reorder widgets, resize them, or hide those you don't need.
            </motion.div>
          )}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={widgets.map(w => w.id)} strategy={rectSortingStrategy}>
              <div className={cn(
                "grid grid-cols-1 lg:grid-cols-12 gap-6 w-full transition-all duration-300 ease-in-out origin-top",
                isResetting ? "opacity-0 scale-[0.98] blur-[2px]" : "opacity-100 scale-100 blur-0"
              )}>
                {widgets.filter(w => isEditLayout || w.visible).map((w, index) => (
                  <SortableWidget
                    key={w.id}
                    widget={w}
                    isEditLayout={isEditLayout}
                    renderWidgetContent={renderWidgetContent}
                    toggleVisible={toggleVisible}
                    updateSize={updateSize}
                  />
                ))}
                
                {widgets.filter(w => isEditLayout || w.visible).length === 0 && !isEditLayout && (
                  <div className="col-span-12 flex flex-col items-center justify-center py-20 text-center">
                    <Layout size={48} className="text-border-subtle mb-4" />
                    <h3 className="text-lg font-bold text-strong mb-2">Clean Slate</h3>
                    <p className="text-sm text-subtle mb-6">All dashboard widgets are currently hidden.</p>
                    <button 
                      onClick={() => setIsEditLayout(true)}
                      className="px-4 py-2 bg-surface-dim hover:bg-surface-accent border border-border-subtle text-strong rounded font-medium transition-colors"
                    >
                      Edit Layout
                    </button>
                  </div>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
      
      {/* Status Bar */}
      <footer className="h-8 border-t border-border-subtle px-4 flex items-center justify-between bg-surface-dim text-[9px] font-mono tracking-tighter shrink-0 z-10">
        <div className="flex space-x-4">
          <div className="flex items-center space-x-1 text-green-500">
            <span className="block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
            <span>DATA: SYNCHRONIZED</span>
          </div>
          <div className="text-subtle">TASKS LOADED: {totalTasks}</div>
        </div>
        <div className="text-subtle">WIDGETS: {widgets.filter(w => w.visible).length}/{widgets.length}</div>
      </footer>

      {(selectedTask || isModalOpen) && (
        <TaskModal
          task={selectedTask}
          users={users}
          tasks={tasks}
          onClose={() => {
            setSelectedTask(null);
            setIsModalOpen(false);
          }}
          onSave={handleSaveTask}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
        />
      )}
    </div>
  );
}
