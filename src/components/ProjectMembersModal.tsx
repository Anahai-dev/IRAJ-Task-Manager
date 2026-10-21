import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Project, User, ProjectMember } from '../types';
import { X, Trash2, UserPlus, Settings, Shield, ChevronDown } from 'lucide-react';
import UserAvatar from './UserAvatar';
import CustomSelect from './CustomSelect';
import { apiDelete, apiGet, apiPost } from '../lib/api';

interface Props {
  project: Project;
  allUsers: User[];
  onClose: () => void;
}

export default function ProjectMembersModal({ project, allUsers, onClose }: Props) {
  const { token, user: currentUser } = useAuth();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'member'|'admin'|'viewer'>('member');
  const [adding, setAdding] = useState(false);

  const fetchMembers = async () => {
    try {
      const data = await apiGet<ProjectMember[]>(`/api/projects/${project.id}/members`);
      setMembers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [project.id]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setAdding(true);
    try {
      await apiPost(`/api/projects/${project.id}/members`, { userId: selectedUserId, role: selectedRole });
      setSelectedUserId('');
      setSelectedRole('member');
      fetchMembers();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add member';
      alert(`Failed to add member: ${message}`);
      console.error(err);
    } finally {
      setAdding(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      await apiPost(`/api/projects/${project.id}/members`, { userId, role: newRole });
      fetchMembers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveMember = async (userId: string) => {

    try {
      await apiDelete(`/api/projects/${project.id}/members/${userId}`);
      fetchMembers();
    } catch(err) {
      console.error(err);
    }
  };

  const currentUserMember = members.find(m => m.id === currentUser?.id);
  const canManage = currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.id === project.ownerId || currentUserMember?.role === 'admin';

  const nonMembers = allUsers.filter(u => !members.find(m => m.id === u.id) && u.id !== project.ownerId);

  return (
    <div className="fixed inset-y-0 right-0 left-0 md:left-[var(--sidebar-width,80px)] z-50 overflow-y-auto flex justify-center items-start p-4 bg-black/80 backdrop-blur-sm text-strong transition-all duration-300">
      <div className="my-auto bg-surface border border-border-subtle rounded-lg shadow-2xl w-full max-w-xl flex flex-col max-h-[calc(100vh-2rem)] md:max-h-[80vh]">
        <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-page-bg rounded-t-lg shrink-0">
          <div>
            <h2 className="text-sm font-bold text-strong uppercase tracking-widest">{project.name} - Members</h2>
          </div>
          <button onClick={onClose} className="text-subtle hover:text-red-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {canManage && (
            <form onSubmit={handleAddMember} className="mb-6 bg-surface-dim p-4 rounded border border-border-subtle flex items-end space-x-3">
              <div className="flex-1">
                <label className="block text-[10px] font-bold text-subtle uppercase tracking-widest mb-1">Add Member</label>
                <CustomSelect
                  value={selectedUserId}
                  onChange={setSelectedUserId}
                  options={nonMembers.map(u => ({ value: u.id, label: u.name.toUpperCase() }))}
                  placeholder="SELECT USER..."
                  size="sm"
                />
              </div>
              <div className="w-32">
                <label className="block text-[10px] font-bold text-subtle uppercase tracking-widest mb-1">Role</label>
                <CustomSelect
                  value={selectedRole}
                  onChange={val => setSelectedRole(val as any)}
                  options={[
                    { value: 'member', label: 'MEMBER' },
                    { value: 'viewer', label: 'VIEWER' },
                    { value: 'admin', label: 'ADMIN' },
                  ]}
                  size="sm"
                />
              </div>
              <button
                type="submit"
                disabled={!selectedUserId || adding}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-md shadow hover:scale-105 transition-all text-sm font-bold flex items-center space-x-2 h-[38px]"
              >
                <UserPlus size={16} />
                <span>Add</span>
              </button>
            </form>
          )}

          {loading ? (
            <div className="text-sm text-subtle">Loading members...</div>
          ) : (
            <div className="space-y-3">
              {/* Project Owner */}
              <div className="bg-surface-dim border border-border-subtle rounded p-3 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <UserAvatar user={allUsers.find(u => u.id === project.ownerId)?.name || 'Owner'} className="w-10 h-10 text-sm" />
                  <div>
                    <h3 className="text-sm font-bold">{allUsers.find(u => u.id === project.ownerId)?.name || 'Unknown'} <span className="text-xs font-normal text-muted ml-2">(Owner)</span></h3>
                    <p className="text-xs text-subtle">{allUsers.find(u => u.id === project.ownerId)?.email}</p>
                  </div>
                </div>
                <div>
                  <Shield size={16} className="text-blue-500" />
                </div>
              </div>

              {members.filter(m => m.id !== project.ownerId).map(member => (
                <div key={member.id} className="bg-surface border border-border-subtle rounded p-3 flex items-center justify-between group">
                  <div className="flex items-center space-x-3">
                    <UserAvatar user={member.name} className="w-10 h-10 text-sm" />
                    <div>
                      <h3 className="text-sm font-bold">{member.name}</h3>
                      <p className="text-xs text-subtle">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    {canManage ? (
                      <div className="w-24">
                        <CustomSelect 
                          value={member.role}
                          onChange={(val) => handleUpdateRole(member.id, val)}
                          options={[
                            { value: 'admin', label: 'ADMIN' },
                            { value: 'member', label: 'MEMBER' },
                            { value: 'viewer', label: 'VIEWER' },
                          ]}
                          size="xs"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-muted uppercase tracking-wider">{member.role}</span>
                    )}

                    {canManage && (
                      <button
                        onClick={() => handleRemoveMember(member.id)}
                        className="text-subtle hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove Member"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              
              {members.length === 0 && (
                <div className="text-center py-8 border border-dashed border-border-subtle rounded">
                  <p className="text-sm text-subtle">No additional members in this project.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
