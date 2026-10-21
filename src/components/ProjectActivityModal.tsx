import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User } from '../types';
import { X, Activity, Clock, FileText, CheckCircle2, MessageSquare, AlertCircle } from 'lucide-react';
import { safeFormatDate } from '../lib/utils';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { apiGet } from '../lib/api';

interface ProjectActivityModalProps {
  projectId: string;
  projectName: string;
  users: User[];
  onClose: () => void;
}

export default function ProjectActivityModal({ projectId, projectName, users, onClose }: ProjectActivityModalProps) {
  const { token, user } = useAuth();
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEscapeKey(onClose);

  useEffect(() => {
    apiGet<any[]>(`/api/projects/${projectId}/activity`)
      .then(data => {
        setActivities(data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load project activity", err);
        setLoading(false);
      });
  }, [projectId, token]);

  const getActionIcon = (action: string) => {
    if (action.includes('created task')) return <FileText size={14} className="text-blue-500" />;
    if (action.includes('status')) return <Activity size={14} className="text-amber-500" />;
    if (action.includes('comment')) return <MessageSquare size={14} className="text-purple-500" />;
    if (action.includes('done')) return <CheckCircle2 size={14} className="text-green-500" />;
    return <AlertCircle size={14} className="text-subtle" />;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-activity-title"
      className="fixed inset-y-0 right-0 left-0 md:left-[var(--sidebar-width,80px)] z-50 overflow-y-auto flex justify-center items-start p-4 bg-black/80 backdrop-blur-sm transition-all duration-300"
    >
      <div className="my-auto bg-surface border border-border-subtle rounded-lg shadow-2xl w-full max-w-2xl max-h-[calc(100vh-2rem)] md:max-h-[85vh] flex flex-col font-sans overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-page-bg">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Activity size={16} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-strong tracking-tight leading-none mb-1">Project Activity</h2>
              <p className="text-[10px] text-subtle uppercase tracking-widest font-bold">{projectName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-subtle hover:text-red-400 p-1 rounded hover:bg-red-500/10 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 bg-surface-dim">
           {loading ? (
             <div className="flex items-center justify-center h-48 text-subtle uppercase tracking-widest text-xs font-bold">Loading activity...</div>
           ) : activities.length > 0 ? (
             <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-700 before:to-transparent">
              {activities.map(a => {
                const author = users.find(u => u.id === a.userId);
                return (
                  <div key={a.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                     <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border-subtle bg-surface shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-lg relative z-10">
                        {getActionIcon(a.action)}
                     </div>
                     <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border border-border-subtle bg-surface shadow-md hover:border-border-strong transition-colors">
                       <div className="flex items-center justify-between mb-2">
                          <div className="font-bold text-strong text-sm">{author ? author.name : 'Unknown User'}</div>
                          <time className="font-mono text-[10px] text-muted bg-surface-dim px-2 py-0.5 rounded border border-border-subtle">
                            {safeFormatDate(a.createdAt, 'MMM d, h:mm a')}
                          </time>
                       </div>
                       <div className="text-xs text-primary">
                         {a.action} on <span className="font-bold text-strong bg-surface-accent px-1 rounded mx-1">{a.taskTitle}</span>
                       </div>
                     </div>
                  </div>
                )
              })}
            </div>
           ) : (
             <div className="flex flex-col items-center justify-center h-64 text-center">
                <Activity size={32} className="text-subtle mb-3" />
                <p className="text-muted font-bold uppercase tracking-widest text-sm">No Activity Yet</p>
                <p className="text-subtle text-xs mt-1">Actions taken on this project will appear here.</p>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
