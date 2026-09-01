import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { X, Activity, User, CheckCircle2, CircleDashed } from 'lucide-react';
import UserAvatar from './UserAvatar';
import { apiGet } from '../lib/api';

interface WorkloadModalProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

interface UserWorkload {
  user: { id: string; name: string; email: string };
  total: number;
  done: number;
  in_progress: number;
  review: number;
  todo: number;
  completionPercentage: number;
}

export default function WorkloadModal({ projectId, projectName, onClose }: WorkloadModalProps) {
  const { token } = useAuth();
  const [workloads, setWorkloads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [columns, setColumns] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem(`board-columns-${projectId || 'all'}`);
      const defCols = [
        { id: 'todo', title: 'To Do', color: '#94a3b8' },
        { id: 'in_progress', title: 'In Progress', color: '#3b82f6' },
        { id: 'review', title: 'Review', color: '#eab308' },
        { id: 'done', title: 'Done', color: '#10b981' }
      ];
      return saved ? JSON.parse(saved) : defCols;
    } catch {
      return [];
    }
  });

  const getColColor = (id: string, index: number) => {
    const col = columns.find(c => c.id === id);
    if (col?.color) return col.color;
    const fallbackColors = ['#3b82f6', '#eab308', '#10b981', '#a855f7', '#ec4899', '#f97316', '#14b8a6', '#94a3b8'];
    return fallbackColors[index % fallbackColors.length];
  };

  const getColTitle = (id: string) => columns.find(c => c.id === id)?.title || id.replace('_', ' ');

  useEffect(() => {
    let active = true;
    const fetchWorkload = async () => {
      try {
        const data = await apiGet<any[]>(`/api/projects/${projectId}/workload`);
        if (active) {
          setWorkloads(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchWorkload();
    return () => { active = false; };
  }, [projectId, token]);

  return (
    <div className="fixed inset-y-0 right-0 left-0 md:left-[var(--sidebar-width,80px)] z-50 overflow-y-auto flex justify-center items-start p-4 bg-black/80 backdrop-blur-sm transition-all duration-300">
      <div className="my-auto bg-surface border border-border-subtle rounded-lg shadow-2xl w-full max-w-2xl flex flex-col font-sans max-h-[calc(100vh-2rem)] md:max-h-[85vh]">
        <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-page-bg rounded-t-lg shrink-0">
          <div className="flex items-center space-x-2">
             <Activity className="text-blue-500" size={18} />
             <h2 className="text-sm font-bold text-strong tracking-widest">{projectName} - Team Workload</h2>
          </div>
          <button onClick={onClose} className="text-subtle hover:text-red-400 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto">
          {loading ? (
            <div className="text-subtle text-sm text-center py-8">Loading workload stats...</div>
          ) : workloads.length === 0 ? (
            <div className="text-center text-subtle py-12">
               <User size={32} className="mx-auto mb-3 opacity-20" />
               <p>No assigned tasks found in this project.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {workloads.map(w => (
                <div key={w.user.id} className="bg-surface-dim border border-border-subtle p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <UserAvatar user={w.user} className="w-10 h-10 text-sm" showTooltip={false} />
                      <div>
                        <div className="text-sm font-medium text-strong">{w.user.name}</div>
                        <div className="text-xs text-muted">{w.user.email}</div>
                      </div>
                    </div>
                    <div className="text-right">
                       <span className="text-lg font-bold text-strong">{w.completionPercentage}%</span>
                       <div className="text-[10px] text-subtle uppercase tracking-widest">Completed</div>
                    </div>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="h-2 w-full bg-surface rounded-full overflow-hidden flex mb-4">
                     {Object.entries(w.statuses || {}).map(([status, count], i) => (
                       <div key={status} style={{ width: `${((count as number) / w.total) * 100}%`, backgroundColor: getColColor(status, i) }} className="h-full" />
                     ))}
                  </div>
                  
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                    <div className="bg-surface rounded py-2 border border-border-subtle">
                       <div className="text-lg font-semibold text-primary">{w.total}</div>
                       <div className="text-[9px] uppercase tracking-wider text-subtle">Total</div>
                    </div>
                    {Object.entries(w.statuses || {}).map(([status, count], i) => (
                      <div key={status} className="bg-surface-dim border border-border-subtle rounded py-2" style={{ color: getColColor(status, i) }}>
                         <div className="flex items-center justify-center space-x-1 mb-1">
                            <span className="text-lg font-semibold leading-none">{String(count)}</span>
                         </div>
                         <div className="text-[9px] text-strong uppercase tracking-wider opacity-70 truncate px-1">{getColTitle(status)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
