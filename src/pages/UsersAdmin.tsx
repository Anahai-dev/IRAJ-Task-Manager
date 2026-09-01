import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { User } from '../types';
import { Shield, UserCog, Plus, Edit2, Trash2, X, Save, ChevronDown } from 'lucide-react';
import UserModal from '../components/UserModal';
import UserAvatar from '../components/UserAvatar';
import CustomSelect from '../components/CustomSelect';

export default function UsersAdmin() {
  const { token, user: currentUser } = useAuth();
  const { success, error } = useToast();
  
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users');
  
  const [editingUser, setEditingUser] = useState<User | undefined>(undefined);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Bulk operation states
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulkRole, setBulkRole] = useState<string>('');
  const [updatingBulk, setUpdatingBulk] = useState(false);

  // Role form states
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any | null>(null);
  const [roleForm, setRoleForm] = useState({
    id: '',
    name: '',
    description: '',
    permissions: {
      create_tasks: false,
      edit_all_tasks: false,
      delete_tasks: false,
      manage_projects: false,
      manage_teams: false
    }
  });

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', {
        headers: { }
      });
      if (res.ok) {
        setUsers(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRoles = async () => {
    try {
      const res = await fetch('/api/roles', {
        headers: { }
      });
      if (res.ok) {
        setRoles(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchUsers(), fetchRoles()]);
      setLoading(false);
    };
    const canAccess = currentUser?.permissions?.manage_roles === true || currentUser?.permissions?.manage_users === true || currentUser?.role === 'super_admin';
    if (token && canAccess) {
      loadData();
    }
  }, [token, currentUser?.role, currentUser?.permissions]);

  const handleDeleteUser = async (userToDelete: User) => {
    if (!window.confirm(`Are you sure you want to delete user ${userToDelete.name}?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/users/${userToDelete.id}`, {
        method: 'DELETE',
        headers: { }
      });
      
      if (res.ok) {
        setUsers(users.filter(u => u.id !== userToDelete.id));
        success(`User ${userToDelete.name} deleted successfully.`);
      } else {
        const data = await res.json();
        error(data.error || 'Failed to delete user.');
      }
    } catch (err) {
      console.error(err);
      error('An unexpected error occurred.');
    }
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleForm.name.trim()) {
      error("Role name is required.");
      return;
    }
    try {
      const isEdit = !!editingRole;
      const url = isEdit ? `/api/roles/${editingRole.id}` : '/api/roles';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(roleForm)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save role');

      success(`Role ${isEdit ? 'updated' : 'created'} successfully.`);
      setIsRoleModalOpen(false);
      fetchRoles();
      fetchUsers();
    } catch (err: any) {
      error(err.message);
    }
  };

  const handleDeleteRole = async (roleId: string, roleName: string) => {
    if (!window.confirm(`Are you sure you want to delete the role "${roleName}"? Any users assigned to this role will be reverted to "Developer" default role.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/roles/${roleId}`, {
        method: 'DELETE',
        headers: { }
      });
      if (res.ok) {
        success(`Role "${roleName}" deleted successfully.`);
        fetchRoles();
        fetchUsers();
      } else {
        const data = await res.json();
        error(data.error || 'Failed to delete role.');
      }
    } catch (err) {
      console.error(err);
      error('An unexpected error occurred.');
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedUserIds.length === users.length) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(users.map(u => u.id));
    }
  };

  const handleToggleSelectUser = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleBulkRoleUpdate = async () => {
    if (!bulkRole) {
      error("Please select a role to apply.");
      return;
    }
    if (selectedUserIds.length === 0) {
      error("No users selected.");
      return;
    }

    setUpdatingBulk(true);
    try {
      const res = await fetch('/api/users/bulk/role', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userIds: selectedUserIds,
          role: bulkRole
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update roles.');
      }

      success(data.message || `Successfully updated roles for ${selectedUserIds.length} users.`);
      setSelectedUserIds([]);
      setBulkRole('');
      fetchUsers();
    } catch (err: any) {
      error(err.message);
    } finally {
      setUpdatingBulk(false);
    }
  };

  const getRoleLabel = (user: User) => {
    const r = roles.find(role => role.id === user.role);
    const baseName = r ? r.name : user.role;
    if (user.rolePrefix) {
      return `${user.rolePrefix} ${baseName}`;
    }
    return baseName;
  };

  const getRoleBadgeStyle = (role: string) => {
    switch (role) {
      case 'super_admin':
        return 'bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold';
      case 'admin':
        return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
      case 'manager':
        return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
      case 'developer':
        return 'bg-teal-500/10 text-teal-400 border border-teal-500/20';
      case 'designer':
        return 'bg-pink-500/10 text-pink-400 border border-pink-500/20';
      case 'qa':
        return 'bg-orange-500/10 text-orange-400 border border-orange-500/20';
      case 'product_owner':
        return 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
      case 'scrum_master':
        return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
      case 'viewer':
        return 'bg-slate-500/10 text-slate-400 border border-slate-500/20';
      default:
        return 'bg-surface-accent text-strong border border-border-subtle';
    }
  };

  if (!currentUser?.permissions?.manage_users && !currentUser?.permissions?.manage_roles && currentUser?.role !== 'super_admin') {
    return (
      <div className="flex h-full items-center justify-center p-6 bg-page-bg">
        <div className="text-center space-y-4">
          <Shield className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="text-lg font-semibold">Access Denied</h2>
          <p className="text-sm text-subtle">You must be an administrator to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-page-bg">
      <header className="flex-none flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-surface-dim">
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold text-strong tracking-tight flex items-center gap-2">
            <UserCog size={20} className="text-blue-500" />
            Administration Board
          </h1>
          <p className="text-xs text-muted mt-1">Manage user credentials, roles, and definitions</p>
        </div>
        {activeTab === 'users' ? (
          <button
            onClick={() => { setEditingUser(undefined); setIsModalOpen(true); }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md shadow hover:scale-105 text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2 animate-fade-in"
          >
            <Plus size={16} /> Add User
          </button>
        ) : (
          <button
            onClick={() => {
              setEditingRole(null);
              setRoleForm({
                id: '',
                name: '',
                description: '',
                permissions: {
                  create_tasks: false,
                  edit_all_tasks: false,
                  delete_tasks: false,
                  manage_projects: false,
                  manage_teams: false
                }
              });
              setIsRoleModalOpen(true);
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md shadow hover:scale-105 text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2 animate-fade-in"
          >
            <Plus size={16} /> Create Custom Role
          </button>
        )}
      </header>

      {/* Tab Navigation */}
      <div className="flex px-6 border-b border-border-subtle bg-surface-dim flex-none gap-4">
        <button
          onClick={() => setActiveTab('users')}
          className={`py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all ${
            activeTab === 'users' ? 'border-blue-500 text-blue-500' : 'border-transparent text-muted hover:text-strong'
          }`}
        >
          User Accounts
        </button>
        <button
          onClick={() => setActiveTab('roles')}
          className={`py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all ${
            activeTab === 'roles' ? 'border-blue-500 text-blue-500' : 'border-transparent text-muted hover:text-strong'
          }`}
        >
          Role Definitions
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'users' ? (
          <div className="space-y-6">
            <div className="bg-surface border border-border-subtle rounded-lg p-4 flex flex-col gap-1">
              <h3 className="text-xs font-bold uppercase tracking-widest text-strong">Role Label Customization</h3>
              <p className="text-xs text-muted font-sans leading-relaxed">You can customize the prefix shown before any role on an individual, per-user basis. Click the Edit button next to any user to personalize their exact title prefix.</p>
            </div>

            {selectedUserIds.length > 0 && (
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  <p className="text-xs font-semibold text-strong">
                    {selectedUserIds.length} {selectedUserIds.length === 1 ? 'user' : 'users'} selected for bulk action
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-44">
                    <CustomSelect
                      value={bulkRole}
                      onChange={setBulkRole}
                      options={[
                        { value: '', label: '-- APPLY SPECIFIC ROLE --' },
                        ...roles.map(r => ({ value: r.id, label: r.name.toUpperCase() }))
                      ]}
                      disabled={updatingBulk}
                      size="xs"
                    />
                  </div>
                  <button
                    onClick={handleBulkRoleUpdate}
                    disabled={!bulkRole || updatingBulk}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all"
                  >
                    {updatingBulk ? 'Applying...' : 'Apply Role'}
                  </button>
                  <button
                    onClick={() => setSelectedUserIds([])}
                    disabled={updatingBulk}
                    className="text-subtle hover:text-strong text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="bg-surface border border-border-subtle rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-dim border-b border-border-subtle text-[10px] uppercase tracking-widest text-subtle font-bold">
                    <th className="px-4 py-3 text-center w-12">
                      <input
                        type="checkbox"
                        className="rounded border-border-subtle text-blue-600 focus:ring-blue-500/20 bg-surface-dim cursor-pointer"
                        checked={users.length > 0 && selectedUserIds.length === users.length}
                        onChange={handleToggleSelectAll}
                      />
                    </th>
                    <th className="px-6 py-3 font-medium">User</th>
                    <th className="px-6 py-3 font-medium">Email</th>
                    <th className="px-6 py-3 font-medium">Role</th>
                    <th className="px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {users.map(user => {
                    const isSelected = selectedUserIds.includes(user.id);
                    return (
                      <tr key={user.id} className={`hover:bg-surface-accent/20 transition-colors ${isSelected ? 'bg-blue-500/5' : ''}`}>
                        <td className="px-4 py-4 text-center">
                          <input
                            type="checkbox"
                            className="rounded border-border-subtle text-blue-600 focus:ring-blue-500/20 bg-surface-dim cursor-pointer"
                            checked={isSelected}
                            onChange={() => handleToggleSelectUser(user.id)}
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar user={user} showTooltip={false} />
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-strong">{user.name}</span>
                              {user.status && user.status !== "Available" && (
                                <span className="text-[10px] font-medium text-subtle px-1.5 py-0.5 rounded bg-surface-dim border border-border-subtle">
                                  {user.status}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-muted">{user.email}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getRoleBadgeStyle(user.role)}`}>
                            {getRoleLabel(user)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => { setEditingUser(user); setIsModalOpen(true); }}
                              className="p-1.5 text-blue-500 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-md transition-all flex items-center justify-center"
                              title="Edit User"
                            >
                              <Edit2 size={16} />
                            </button>
                            {user.id !== currentUser?.id && (
                              <button
                                onClick={() => handleDeleteUser(user)}
                                className="p-1.5 text-red-500 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-md transition-all flex items-center justify-center"
                                title="Delete User"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {users.length === 0 && !loading && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-subtle text-sm">
                        No users found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-surface border border-border-subtle rounded-lg p-4 flex flex-col gap-1">
              <h3 className="text-xs font-bold uppercase tracking-widest text-strong">Dynamic Role System</h3>
              <p className="text-xs text-muted font-sans leading-relaxed">Manage system and custom roles. Standard system default roles cannot be edited or deleted to preserve application core features.</p>
            </div>

            <div className="bg-surface border border-border-subtle rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-dim border-b border-border-subtle text-[10px] uppercase tracking-widest text-subtle font-bold">
                    <th className="px-6 py-3 font-medium">Role Key</th>
                    <th className="px-6 py-3 font-medium">Display Name</th>
                    <th className="px-6 py-3 font-medium">Description</th>
                    <th className="px-6 py-3 font-medium">Type</th>
                    <th className="px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {roles.map(role => (
                    <tr key={role.id} className="hover:bg-surface-accent/20 transition-colors">
                      <td className="px-6 py-4">
                        <code className="text-xs font-mono text-blue-400 bg-blue-500/5 px-2 py-1 rounded">
                          {role.id}
                        </code>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getRoleBadgeStyle(role.id)}`}>
                          {role.name}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-muted leading-relaxed max-w-xs truncate" title={role.description}>
                        {role.description || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest ${
                          role.is_custom === 1 ? 'bg-orange-500/10 text-orange-400 border border-orange-500/15' : 'bg-slate-500/10 text-muted'
                        }`}>
                          {role.is_custom === 1 ? 'Custom' : 'System'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingRole(role);
                              let parsedPerms = {
                                create_tasks: false,
                                edit_all_tasks: false,
                                delete_tasks: false,
                                manage_projects: false,
                                manage_teams: false
                              };
                              if (role.permissions) {
                                try {
                                  const parsed = typeof role.permissions === 'string' ? JSON.parse(role.permissions) : role.permissions;
                                  parsedPerms = { ...parsedPerms, ...parsed };
                                } catch (err) {
                                  console.error("Failed to parse permissions", err);
                                }
                              }
                              setRoleForm({
                                id: role.id,
                                name: role.name,
                                description: role.description || '',
                                permissions: parsedPerms
                              });
                              setIsRoleModalOpen(true);
                            }}
                            className="p-1.5 text-blue-500 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-md transition-all flex items-center justify-center"
                            title={role.is_custom === 1 ? "Edit Custom Role & Permissions" : "Customize Role Permissions"}
                          >
                            <Edit2 size={16} />
                          </button>
                          {role.is_custom === 1 ? (
                            <button
                              onClick={() => handleDeleteRole(role.id, role.name)}
                              className="p-1.5 text-red-500 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-md transition-all flex items-center justify-center"
                              title="Delete Custom Role"
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : (
                            <span className="text-[10px] text-muted italic">System Default</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <UserModal
          user={editingUser}
          onClose={() => setIsModalOpen(false)}
          onSave={() => {
            setIsModalOpen(false);
            fetchUsers();
          }}
        />
      )}

      {isRoleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-surface border border-border-subtle rounded-xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            <div className="flex justify-between items-center px-6 py-4 border-b border-border-subtle shrink-0">
              <h2 className="text-sm font-bold tracking-widest text-strong uppercase">
                {editingRole 
                  ? (editingRole.is_custom === 1 ? 'Edit Custom Role' : 'Customize System Role')
                  : 'Create Custom Role'
                }
              </h2>
              <button onClick={() => setIsRoleModalOpen(false)} className="p-1 hover:bg-surface-dim rounded text-muted transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveRole} className="p-6 space-y-4 overflow-y-auto">
              {!editingRole && (
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-subtle uppercase tracking-widest block">Role Key (ID)</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. designer"
                    className="w-full rounded bg-surface-dim border border-border-subtle px-3 py-2 text-sm text-strong focus:border-blue-500 focus:outline-none"
                    value={roleForm.id}
                    onChange={e => setRoleForm(p => ({ ...p, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                  />
                  <p className="text-[10px] text-muted">Lower-case, alphanumeric only. Used internally as the role key.</p>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-subtle uppercase tracking-widest block">Role Name</label>
                <input
                  required
                  type="text"
                  disabled={editingRole && editingRole.is_custom !== 1}
                  placeholder="e.g. UI/UX Designer"
                  className="w-full rounded bg-surface-dim border border-border-subtle px-3 py-2 text-sm text-strong focus:border-blue-500 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  value={roleForm.name}
                  onChange={e => setRoleForm(p => ({ ...p, name: e.target.value }))}
                />
                {editingRole && editingRole.is_custom !== 1 && (
                  <p className="text-[10px] text-muted">System default role names cannot be renamed.</p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-subtle uppercase tracking-widest block">Description</label>
                <textarea
                  placeholder="What is this role responsible for?"
                  className="w-full rounded bg-surface-dim border border-border-subtle px-3 py-2 text-sm text-strong focus:border-blue-500 focus:outline-none min-h-[60px]"
                  value={roleForm.description}
                  onChange={e => setRoleForm(p => ({ ...p, description: e.target.value }))}
                />
              </div>

              {/* Dynamic Permissions Section */}
              <div className="space-y-3 pt-2">
                <label className="text-[9px] font-bold text-subtle uppercase tracking-widest block">Role Permissions</label>
                {editingRole?.id === 'super_admin' && (
                  <p className="text-xs text-amber-500 font-semibold bg-amber-500/10 border border-amber-500/20 p-2.5 rounded">
                    Super Admin permissions are immutable and grant full, unrestricted system control.
                  </p>
                )}
                {editingRole?.id === 'admin' && currentUser?.role !== 'super_admin' && (
                  <p className="text-xs text-amber-500 font-semibold bg-amber-500/10 border border-amber-500/20 p-2.5 rounded">
                    Only Super Admins can customize standard Admin role permissions.
                  </p>
                )}
                <div className="space-y-2.5 bg-surface-dim/50 border border-border-subtle rounded-lg p-3">
                  {[
                    { key: 'create_tasks', label: 'Create Tasks', desc: 'Can create new tasks within projects' },
                    { key: 'edit_all_tasks', label: 'Edit All Tasks', desc: 'Can edit details of any task' },
                    { key: 'delete_tasks', label: 'Delete Tasks', desc: 'Can delete tasks' },
                    { key: 'manage_projects', label: 'Manage Projects', desc: 'Can create, edit, and delete projects' },
                    { key: 'manage_teams', label: 'Manage Teams', desc: 'Can create, edit, and delete teams' },
                    { key: 'manage_users', label: 'Manage Users', desc: 'Can create, edit, assign roles, and manage user accounts' },
                    { key: 'manage_roles', label: 'Manage Roles', desc: 'Can create, edit, and configure custom role permissions' },
                  ].map((perm) => (
                    <label key={perm.key} className="flex items-start gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        disabled={
                          editingRole?.id === 'super_admin' ||
                          (editingRole?.id === 'admin' && currentUser?.role !== 'super_admin')
                        }
                        className="mt-0.5 rounded border-border-subtle text-blue-600 focus:ring-blue-500/20 bg-surface-dim disabled:opacity-50"
                        checked={
                          editingRole?.id === 'super_admin' 
                            ? true 
                            : (roleForm.permissions[perm.key as keyof typeof roleForm.permissions] || false)
                        }
                        onChange={(e) => setRoleForm(prev => ({
                          ...prev,
                          permissions: {
                            ...prev.permissions,
                            [perm.key]: e.target.checked
                          }
                        }))}
                      />
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-strong group-hover:text-blue-400 transition-colors">
                          {perm.label}
                        </span>
                        <span className="text-[10px] text-muted">
                          {perm.desc}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-border-subtle bg-surface-dim -mx-6 -mb-6 p-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsRoleModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-subtle hover:text-strong transition-colors uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2"
                >
                  <Save size={14} /> Save Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
