import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useSearchParams, Link, Navigate } from 'react-router';
import { FolderKanban, Map, Milestone as MilestoneIcon, Plus, Calendar, Settings, Trash2, Edit, GitBranch, CheckCircle, ChevronDown } from 'lucide-react';
import { Project, Milestone, User, Task } from '../types';
import { safeFormatDate } from '../lib/utils';
import TaskTimelineD3 from '../components/TaskTimelineD3';
import TaskModal from '../components/TaskModal';
import CustomSelect from '../components/CustomSelect';
import { apiDelete, apiGet, apiPost, apiPut, fetchAllPages } from '../lib/api';
import { HelpIcon, Tooltip } from '../components/Tooltip';

export default function Planning() {
  const { token } = useAuth();
  const { success, error, info } = useToast();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editMilestone, setEditMilestone] = useState<Milestone | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    status: 'pending' as 'pending' | 'active' | 'completed'
  });

  useEffect(() => {
    fetchProjects();
    fetchUsers();
  }, [token]);

  useEffect(() => {
    if (projectId) {
      fetchMilestones();
      fetchTasks();
    }
  }, [projectId, token]);

  const fetchUsers = async () => {
    try {
      const usersData = await fetchAllPages<User>('/api/users');
      setUsers(usersData);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTasks = async () => {
    try {
      const allTasks = await fetchAllPages<Task>('/api/tasks');
      const projectTasks = allTasks.filter((t) => t.projectId === projectId);
      setTasks(projectTasks);
    } catch (err) {
      console.error(err);
    }
  };

  // Helper to calculate ranges and dates
  const timelineData = React.useMemo(() => {
    const allStarts = milestones.map(m => m.startDate).filter(Boolean) as string[];
    const allEnds = milestones.map(m => m.endDate).filter(Boolean) as string[];
    
    const validStarts = allStarts.map(d => new Date(d).getTime()).filter(t => !isNaN(t));
    const validEnds = allEnds.map(d => new Date(d).getTime()).filter(t => !isNaN(t));

    if (validStarts.length === 0 || validEnds.length === 0) return null;

    let minD = new Date(Math.min(...validStarts));
    let maxD = new Date(Math.max(...validEnds));
    
    // Add 15 days padding to min and max for better visual spacing
    minD = new Date(minD.setDate(minD.getDate() - 15));
    maxD = new Date(maxD.setDate(maxD.getDate() + 15));

    const totalTime = maxD.getTime() - minD.getTime();
    if (isNaN(totalTime) || totalTime <= 0) return null;
    
    // Generate tick marks (roughly 5-6 points)
    const ticks = [];
    const numTicks = 6;
    for (let i = 0; i <= numTicks; i++) {
        const tickTime = minD.getTime() + (totalTime * (i / numTicks));
        ticks.push({
            date: safeFormatDate(tickTime, 'MMM yyyy'),
            left: `${(i / numTicks) * 100}%`
        });
    }

    return { minD, maxD, totalTime, ticks };
  }, [milestones]);

  const fetchProjects = async () => {
    try {
      const data = await fetchAllPages<Project>('/api/projects');
      setAllProjects(data);
      if (projectId) {
        setProject(data.find((p) => p.id === projectId) || null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!projectId) setLoading(false);
    }
  };

  const fetchMilestones = async () => {
    try {
      const data = await apiGet<Milestone[]>(`/api/projects/${projectId}/milestones`);
      setMilestones(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editMilestone) {
        await apiPut(`/api/milestones/${editMilestone.id}`, formData);
      } else {
        await apiPost(`/api/projects/${projectId}/milestones`, formData);
      }
      setShowModal(false);
      fetchMilestones();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/api/milestones/${id}`);
      fetchMilestones();
    } catch (err) {
      console.error(err);
    }
  };

  const openModal = (m?: Milestone) => {
    if (m) {
      setEditMilestone(m);
      setFormData({
        name: m.name,
        description: m.description || '',
        startDate: m.startDate || '',
        endDate: m.endDate || '',
        status: m.status
      });
    } else {
      setEditMilestone(null);
      setFormData({
        name: '',
        description: '',
        startDate: '',
        endDate: '',
        status: 'pending'
      });
    }
    setShowModal(true);
  };

  const handleTaskClick = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      setEditingTask(task);
      setIsTaskModalOpen(true);
    }
  };

  const handleSaveTask = async (updatedTask: Partial<Task>) => {
    if (!editingTask) return;
    try {
      await apiPut(`/api/tasks/${editingTask.id}`, updatedTask);
      setIsTaskModalOpen(false);
      setEditingTask(null);
      fetchTasks();
    } catch (err) {
      console.error(err);
      alert("Failed to save task.");
    }
  };

  if (loading) return <div className="p-8 text-primary">Loading planning mode...</div>;

  if (!projectId) {
    if (allProjects.length === 1) {
      return <Navigate to={`/planning?projectId=${allProjects[0].id}`} replace />;
    }
    
    return (
      <div className="flex-1 flex flex-col p-8 bg-page-bg overflow-y-auto">
        <h1 className="text-xl font-semibold text-strong tracking-tight opacity-90 mb-2">Select a Project</h1>
        <p className="text-sm text-subtle mb-8">Choose a project to enter planning mode</p>
        
        {allProjects.length === 0 ? (
          <div className="text-center p-12 bg-surface border border-border-subtle rounded-lg">
            <h2 className="text-lg font-medium text-strong mb-2">No projects found</h2>
            <p className="text-sm text-subtle mb-4">You need to create a project first before planning.</p>
            <Link to="/projects" className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-strong text-sm font-medium rounded transition-colors">
              Go to Projects
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {allProjects.map(p => (
              <Link 
                key={p.id} 
                to={`/planning?projectId=${p.id}`}
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

  const getTimelineStyle = (start: string, end: string) => {
    if (!start || !end || !timelineData) return { display: 'none' };
    const { minD, totalTime } = timelineData;
    
    const sTime = new Date(start).getTime();
    const eTime = new Date(end).getTime();
    
    if (totalTime === 0) return { width: '100%', left: '0%' };
    
    const left = ((sTime - minD.getTime()) / totalTime) * 100;
    const width = ((eTime - sTime) / totalTime) * 100;
    
    return { left: `${Math.max(0, left)}%`, width: `${Math.max(0, width)}%` };
  };

  const activeMilestones = milestones.filter(m => m.status !== 'completed');
  const completedMilestones = milestones.filter(m => m.status === 'completed');

  return (
    <div className="tour-planning-view flex-1 flex flex-col p-8 bg-page-bg overflow-y-auto h-full relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-strong mb-1 flex items-center gap-2">
            Planning Mode
            <HelpIcon text="Define roadmap, epics, and milestones for tasks across your project" className="mt-1" />
          </h1>
          <p className="text-sm text-subtle">Define roadmap, epics, and milestones for {project?.name}</p>
        </div>
        <Tooltip content="Create a new milestone for the project" position="bottom">
          <button 
            onClick={() => openModal()}
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md shadow hover:scale-[1.02] transition-all text-sm font-bold flex items-center justify-center space-x-2"
          >
            <Plus size={16} />
            <span>New Milestone</span>
          </button>
        </Tooltip>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface p-6 border border-border-subtle rounded-lg shadow-sm overflow-x-auto">
            <h2 className="text-lg font-medium text-strong mb-4 flex items-center space-x-2">
              <Map size={20} className="text-blue-500" />
              <span>Roadmap Timeline</span>
              <HelpIcon text="Visual representation of milestones over time" />
            </h2>
            <div className="min-w-[600px] mt-8 relative py-4">
               {milestones.length === 0 ? (
                 <div className="h-48 flex items-center justify-center border border-dashed border-border-subtle rounded text-subtle text-sm">
                   Timeline view will go here. Add milestones with start/end dates.
                 </div>
               ) : (
                 <div className="space-y-4">
                   {/* Timeline Ticks Grid */}
                   <div className="ml-48 relative h-8 border-b border-border-strong mb-2">
                     {timelineData?.ticks.map((tick, i) => (
                       <div key={`tick-${i}`} className="absolute top-0 bottom-0 text-[10px] text-muted -translate-x-1/2 flex flex-col items-center" style={{ left: tick.left }}>
                         <span>{tick.date}</span>
                         <div className="w-px h-full bg-border-subtle mt-1 opacity-50 absolute top-[100%] z-0" style={{ height: `${milestones.length * 80}px` }} />
                       </div>
                     ))}
                   </div>
                   
                   {milestones.map(m => {
                     const mTasks = tasks.filter(t => t.milestoneId === m.id);
                     const completedTasks = mTasks.filter(t => t.status === 'done').length;
                     const progress = mTasks.length > 0 ? (completedTasks / mTasks.length) * 100 : 0;
                     
                     return (
                     <div key={`tl-${m.id}`} className="relative h-16 border-b border-border-subtle/50 group">
                       <div className="absolute left-0 w-48 truncate pr-4 mt-1">
                         <span className="text-sm font-medium text-strong block truncate">{m.name}</span>
                         <span className="block text-xs text-muted truncate">
                           {m.startDate ? safeFormatDate(m.startDate, 'PP') : ''}{m.startDate && m.endDate ? ' - ' : ''}{m.endDate ? safeFormatDate(m.endDate, 'PP') : ''}
                         </span>
                         {mTasks.length > 0 && (
                           <span className="text-[10px] text-muted">
                             {completedTasks}/{mTasks.length} tasks
                           </span>
                         )}
                       </div>
                       <div className="ml-48 relative h-full bg-surface-dim rounded border-l border-r border-border-subtle z-10">
                         {m.startDate && m.endDate && (
                           <div 
                             className={`absolute top-2 h-8 rounded px-2 text-xs flex flex-col justify-center text-white truncate shadow-sm transition-all z-20 ${
                               m.status === 'completed' ? 'bg-green-500' :
                               m.status === 'active' ? 'bg-blue-500' : 'bg-slate-500'
                             }`}
                             style={getTimelineStyle(m.startDate, m.endDate)}
                             title={m.name}
                           >
                             <span className="truncate">{m.name}</span>
                             {mTasks.length > 0 && m.status !== 'completed' && (
                                <div className="w-full bg-black/20 h-1.5 mt-1 rounded overflow-hidden">
                                  <div className="bg-white/80 h-full" style={{ width: `${progress}%` }} />
                                </div>
                             )}
                           </div>
                         )}
                       </div>
                     </div>
                   );
                 })}
                 </div>
               )}
            </div>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-1">
          <div className="bg-surface p-6 border border-border-subtle rounded-lg shadow-sm flex flex-col max-h-[500px]">
            <h2 className="text-lg font-medium text-strong mb-4 flex items-center space-x-2 shrink-0">
              <MilestoneIcon size={20} className="text-purple-500" />
              <span>Upcoming Milestones</span>
              <HelpIcon text="List of active or pending milestones" />
            </h2>
            
            {activeMilestones.length === 0 ? (
              <div className="text-center py-8 text-sm text-subtle border border-dashed border-border-subtle rounded shrink-0">
                No active milestones.
              </div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto pr-2">
                {activeMilestones.map(m => {
                   const mTasks = tasks.filter(t => t.milestoneId === m.id);
                   const completedTasks = mTasks.filter(t => t.status === 'done').length;
                   const progress = mTasks.length > 0 ? (completedTasks / mTasks.length) * 100 : 0;
                   return (
                  <div key={m.id} className="p-3 border border-border-subtle rounded-md bg-surface-dim group hover:border-blue-500/30 transition-colors flex flex-col">
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-medium text-sm text-strong truncate pr-2">{m.name}</h4>
                      <div className="flex space-x-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); openModal(m); }} className="p-1 hover:bg-surface rounded text-muted hover:text-blue-400">
                          <Edit size={12} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDelete(m.id); }} className="p-1 hover:bg-surface rounded text-muted hover:text-red-400">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    {m.description && <p className="text-xs text-subtle mb-2 line-clamp-2">{m.description}</p>}
                    <div className="flex justify-between items-center text-xs mb-2">
                      <span className={`px-2 py-0.5 rounded-full ${
                        m.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                        m.status === 'active' ? 'bg-blue-500/10 text-blue-500' :
                        'bg-slate-500/10 text-slate-400'
                      }`}>
                        {m.status}
                      </span>
                      {m.endDate && (
                        <span className="flex items-center text-muted">
                          <Calendar size={10} className="mr-1" />
                          {safeFormatDate(m.endDate, 'PP')}
                        </span>
                      )}
                    </div>
                    
                    {mTasks.length > 0 && (
                      <div className="mt-auto pt-2 border-t border-border-subtle">
                         <div className="flex justify-between items-center text-[10px] text-muted mb-1">
                           <span>{completedTasks}/{mTasks.length} tasks</span>
                           <span>{Math.round(progress)}%</span>
                         </div>
                         <div className="w-full bg-surface h-1.5 rounded overflow-hidden">
                           <div className={`h-full ${progress === 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${progress}%` }} />
                         </div>
                      </div>
                    )}
                  </div>
                )})}
              </div>
            )}
          </div>

          <div className="bg-surface p-6 border border-border-subtle rounded-lg shadow-sm flex flex-col max-h-[500px]">
            <h2 className="text-lg font-medium text-strong mb-4 flex items-center space-x-2 shrink-0">
              <CheckCircle size={20} className="text-green-500" />
              <span>Completed Milestones</span>
            </h2>
            
            {completedMilestones.length === 0 ? (
              <div className="text-center py-8 text-sm text-subtle border border-dashed border-border-subtle rounded shrink-0">
                No completed milestones.
              </div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto pr-2">
                {completedMilestones.map(m => {
                   const mTasks = tasks.filter(t => t.milestoneId === m.id);
                   const completedTasks = mTasks.filter(t => t.status === 'done').length;
                   const progress = mTasks.length > 0 ? (completedTasks / mTasks.length) * 100 : 0;
                   return (
                  <div key={m.id} className="p-3 border border-border-subtle rounded-md bg-surface-dim group hover:border-green-500/30 transition-colors flex flex-col opacity-75 hover:opacity-100">
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-medium text-sm text-strong truncate pr-2 line-through">{m.name}</h4>
                      <div className="flex space-x-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); openModal(m); }} className="p-1 hover:bg-surface rounded text-muted hover:text-blue-400">
                          <Edit size={12} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDelete(m.id); }} className="p-1 hover:bg-surface rounded text-muted hover:text-red-400">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-between items-center text-xs mb-2 mt-2">
                      <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">
                        {m.status}
                      </span>
                      {m.endDate && (
                        <span className="flex items-center text-muted">
                          <Calendar size={10} className="mr-1" />
                          {safeFormatDate(m.endDate, 'PP')}
                        </span>
                      )}
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-3">
           <div className="bg-surface p-6 border border-border-subtle rounded-lg shadow-sm">
             <h2 className="text-lg font-medium text-strong mb-4 flex items-center space-x-2">
               <GitBranch size={20} className="text-emerald-500" />
               <span>Task Dependencies Timeline</span>
               <HelpIcon text="Scroll to pinch-to-zoom and drag to pan the interactive D3 dependency graph" />
             </h2>
             <div className="h-[400px]">
               <TaskTimelineD3 tasks={tasks} width={1000} onTaskClick={handleTaskClick} />
             </div>
           </div>
        </div>
      </div>

      {isTaskModalOpen && editingTask && (
        <TaskModal
          task={editingTask}
          projectId={projectId || undefined}
          onClose={() => {
            setIsTaskModalOpen(false);
            setEditingTask(null);
            fetchTasks(); // fetch any updates made inside the modal
          }}
          onSave={handleSaveTask}
          users={users}
          tasks={tasks}
        />
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border-subtle rounded-xl w-full max-w-md shadow-2xl p-6">
            <h2 className="text-xl font-bold text-strong mb-6">{editMilestone ? 'Edit Milestone' : 'Create Milestone'}</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-subtle uppercase tracking-wider mb-1">Name</label>
                <input
                  required
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-surface-dim border border-border-subtle rounded px-3 py-2 text-strong focus:outline-none focus:border-blue-500 text-sm"
                  placeholder="e.g. Q3 Launch"
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-subtle uppercase tracking-wider mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                  className="w-full bg-surface-dim border border-border-subtle rounded px-3 py-2 text-strong focus:outline-none focus:border-blue-500 text-sm resize-none"
                  rows={3}
                />
              </div>

               <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-subtle uppercase tracking-wider mb-1">Start Date</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={formData.startDate}
                      onChange={e => setFormData(p => ({ ...p, startDate: e.target.value }))}
                      className="w-full bg-surface-dim border border-border-subtle rounded pl-9 pr-3 py-2 text-strong focus:outline-none focus:border-blue-500 text-sm dark:[color-scheme:dark]"
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none">
                      <Calendar size={13} />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-subtle uppercase tracking-wider mb-1">End Date</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={formData.endDate}
                      onChange={e => setFormData(p => ({ ...p, endDate: e.target.value }))}
                      className="w-full bg-surface-dim border border-border-subtle rounded pl-9 pr-3 py-2 text-strong focus:outline-none focus:border-blue-500 text-sm dark:[color-scheme:dark]"
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none">
                      <Calendar size={13} />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-subtle uppercase tracking-wider mb-1">Status</label>
                <CustomSelect
                  value={formData.status}
                  onChange={val => setFormData(p => ({ ...p, status: val as any }))}
                  options={[
                    { value: 'pending', label: 'PENDING' },
                    { value: 'active', label: 'ACTIVE' },
                    { value: 'completed', label: 'COMPLETED' },
                  ]}
                  size="sm"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-border-subtle mt-6">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-subtle hover:text-strong bg-surface hover:bg-surface-dim rounded border border-border-subtle transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                >
                  {editMilestone ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
