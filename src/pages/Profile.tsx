import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useToast } from "../contexts/ToastContext";
import { useGitFeature } from "../contexts/GitFeatureContext";
import { cn, getUserColor, getUserGradient, safeFormatDistanceToNow } from "../lib/utils";
import { hasFlag } from "../lib/permissions";
import {
  User as UserIcon,
  Save,
  Moon,
  Sun,
  Settings,
  Monitor,
  Activity,
  Shield,
  Key,
  Clock,
  LogOut,
  Smartphone,
  Globe,
  Code,
  X,
  Plus,
  Briefcase,
  Eye,
  Calendar as CalendarIcon,
  Database,
  Download,
  Upload,
  FileJson,
  AlertTriangle,
  Github,
  Gitlab,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown
} from "lucide-react";
import UserAvatar from "../components/UserAvatar";
import CustomSelect from "../components/CustomSelect";

export const STATUS_OPTIONS = [
  { value: "Available", label: "Available", color: "bg-green-500", text: "text-green-500" },
  { value: "Busy", label: "Busy", color: "bg-red-500", text: "text-red-500" },
  { value: "Away", label: "Away", color: "bg-yellow-500", text: "text-yellow-500" },
  { value: "Offline", label: "Offline", color: "bg-gray-500", text: "text-gray-500" },
  { value: "In a Meeting", label: "In a Meeting", color: "bg-purple-500", text: "text-purple-500" },
  { value: "On Vacation", label: "On Vacation", color: "bg-blue-500", text: "text-blue-500" },
];

export default function Profile() {
  const { user, token, updateUser, login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { success, error } = useToast();
  const { gitEnabled } = useGitFeature();

  const [name, setName] = useState(user?.name || "");
  const [statusText, setStatusText] = useState(user?.status || "Available");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  const tabsRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDistance, setDragDistance] = useState(0);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!tabsRef.current) return;
    setIsDragging(true);
    setDragDistance(0);
    setStartX(e.pageX - tabsRef.current.offsetLeft);
    setScrollLeft(tabsRef.current.scrollLeft);
  };

  const handleMouseLeaveOrUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !tabsRef.current) return;
    const x = e.pageX - tabsRef.current.offsetLeft;
    const dist = Math.abs(x - startX);
    setDragDistance(dist);
    if (dist > 3) {
      e.preventDefault();
      const walk = (x - startX) * 1.5;
      tabsRef.current.scrollLeft = scrollLeft - walk;
    }
  };

  const isManagerOrAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'manager';

  const profileTabs = [
    { id: 'general', label: 'General Settings', icon: Settings },
    { id: 'activity', label: 'Recent Activity', icon: Activity },
    { id: 'security', label: 'Security Log', icon: Shield },
    { id: 'skills', label: 'Skills & Expertise', icon: Code },
    ...(isManagerOrAdmin && gitEnabled ? [{ id: 'integrations', label: 'Integrations', icon: GitBranch }] : []),
    ...((user?.role === 'admin' || user?.role === 'super_admin' || hasFlag(user, 'reset_database')) ? [{ id: 'backup', label: 'Backup & Restore', icon: Database }] : []),
  ];

  const handleNextTab = () => {
    const currentIndex = profileTabs.findIndex(t => t.id === activeTab);
    const nextIndex = (currentIndex + 1) % profileTabs.length;
    const nextTab = profileTabs[nextIndex];
    if (nextTab) {
      setActiveTab(nextTab.id);
      scrollTabIntoView(nextTab.id);
    }
  };

  const handlePrevTab = () => {
    const currentIndex = profileTabs.findIndex(t => t.id === activeTab);
    const prevIndex = (currentIndex - 1 + profileTabs.length) % profileTabs.length;
    const prevTab = profileTabs[prevIndex];
    if (prevTab) {
      setActiveTab(prevTab.id);
      scrollTabIntoView(prevTab.id);
    }
  };

  const scrollTabIntoView = (tabId: string) => {
    setTimeout(() => {
      if (tabsRef.current) {
        const tabElement = tabsRef.current.querySelector(`[data-tab-id="${tabId}"]`);
        if (tabElement) {
          tabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }
    }, 50);
  };

  const [skills, setSkills] = useState<{ id: string, name: string }[]>([]);
  const [newSkill, setNewSkill] = useState("");

  const [stats, setStats] = useState({ tasks: 0, projects: 0 });
  const [activities, setActivities] = useState<any[]>([]);
  
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordData, setPasswordData] = useState({ currentPassword: '', newPassword: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Backup & Restore states
  const [dbInfo, setDbInfo] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Git Integrations Connectivity State
  const [integrationsStatus, setIntegrationsStatus] = useState<any>(null);

  useEffect(() => {
    const fetchIntegrationsStatus = async () => {
      try {
        const res = await fetch("/api/integrations/status", {
          headers: { }
        });
        if (res.ok) {
          const data = await res.json();
          setIntegrationsStatus(data);
        }
      } catch (e) {
        console.error("Failed to fetch integrations status:", e);
      }
    };
    if (token) fetchIntegrationsStatus();
  }, [token]);

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setStatusText(user.status || "Available");
    }
  }, [user]);

  useEffect(() => {
    if (user?.skills) {
      setSkills(user.skills.map((s, i) => ({ id: i.toString(), name: s })));
    }
  }, [user?.skills]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/users/me/stats", {
          headers: { }
        });
        if (res.ok) {
          const data = await res.json();
          setStats({ tasks: data.tasks, projects: data.projects });
          setActivities(data.recentActivity || []);
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (token) fetchStats();
  }, [token]);

  /**
   * Fetches database engine details and record statistics from the server.
   * Maps results to local component state `dbInfo` to power status visualizers.
   */
  const fetchDbInfo = async () => {
    setLoadingInfo(true);
    try {
      const res = await fetch("/api/backup/info", {
        headers: { }
      });
      if (res.ok) {
        const data = await res.json();
        setDbInfo(data);
      }
    } catch (e) {
      console.error("Failed to fetch database information:", e);
    } finally {
      setLoadingInfo(false);
    }
  };

  // Automatically trigger database metadata fetch when user switches to the Backup tab
  useEffect(() => {
    if (activeTab === 'backup' && token) {
      fetchDbInfo();
    }
  }, [activeTab, token]);

  /**
   * Exports all database tables as a metadata-only JSON file.
   * Password hashes and Git PATs are redacted; use the CLI for secrets-preserving snapshots.
   */
  const handleJsonDownload = async () => {
    try {
      const res = await fetch("/api/backup/export-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "workspace-backup.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        success("JSON database backup downloaded successfully!");
      } else {
        const err = await res.json();
        error(err.error || "Failed to download JSON backup.");
      }
    } catch (e: any) {
      error(`Download failed: ${e.message}`);
    }
  };

  /**
   * Handles portable `.json` database restoration.
   * Parses the file content, structures the payload, and sends a transaction-backed import request.
   * Reloads the page in 2 seconds to force a clean reload of all layout states.
   * 
   * @param {File} file - Selected JSON backup file.
   */
  const handleJsonRestore = async (file: File) => {
    if (!window.confirm("Are you absolutely sure you want to restore from this JSON backup? ALL current tables will be cleared and replaced with backup data.")) {
      return;
    }
    
    setRestoring(true);
    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);
      
      const res = await fetch("/api/backup/restore-json", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ...jsonData, confirm: true })
      });
      
      if (res.ok) {
        success("Database restored successfully from JSON backup! Page will reload in 2 seconds.");
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        const errData = await res.json();
        error(errData.error || "Failed to restore JSON database.");
      }
    } catch (e: any) {
      error(`Error: ${e.message}`);
    } finally {
      setRestoring(false);
    }
  };

  const saveSkills = async (newSkillsList: { id: string, name: string }[]) => {
    try {
      const stringSkills = newSkillsList.map(s => s.name);
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: user?.name, skills: stringSkills }),
      });
      if (res.ok) {
        const updatedUser = await res.json();
        updateUser(updatedUser);
      }
    } catch(err) {
      error("Failed to save skills");
    }
  };

  const handleAddSkill = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSkill.trim() && !skills.some(s => s.name.toLowerCase() === newSkill.trim().toLowerCase())) {
      const newSkillsList = [...skills, { id: Date.now().toString(), name: newSkill.trim() }];
      setSkills(newSkillsList);
      saveSkills(newSkillsList);
      setNewSkill("");
    }
  };

  const handleRemoveSkill = (id: string) => {
    const newSkillsList = skills.filter(s => s.id !== id);
    setSkills(newSkillsList);
    saveSkills(newSkillsList);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordData.currentPassword || !passwordData.newPassword) return;

    setPasswordSaving(true);
    try {
      const res = await fetch("/api/users/me/password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(passwordData),
      });

      if (res.ok) {
        const data = await res.json();
        if (user && login) {
          login(undefined, user);
        }
        success("Password changed successfully.");
        setIsChangingPassword(false);
        setPasswordData({ currentPassword: '', newPassword: '' });
      } else {
        const data = await res.json();
        error(data.error || "Failed to change password.");
      }
    } catch (err) {
      error("An unexpected error occurred.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const roleInfo = (() => {
    switch (user?.role) {
      case 'super_admin': return { label: 'Super Admin', icon: Shield, color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
      case 'admin': return { label: 'Administrator', icon: Shield, color: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/20' };
      case 'manager': return { label: `${user?.rolePrefix || 'Engineering'} Manager`, icon: Briefcase, color: 'text-indigo-500', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' };
      case 'developer': return { label: `${user?.rolePrefix || 'Lead'} Developer`, icon: Code, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' };
      case 'viewer': return { label: 'QA Analyst', icon: Eye, color: 'text-teal-500', bg: 'bg-teal-500/10', border: 'border-teal-500/20' };
      default: return { label: 'Team Member', icon: UserIcon, color: 'text-slate-500', bg: 'bg-slate-500/10', border: 'border-slate-500/20' };
    }
  })();
  const RoleIcon = roleInfo.icon;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !name.trim()) {
      error("Name is required and cannot be empty.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, status: statusText }),
      });

      if (res.ok) {
        const updatedUser = await res.json();
        updateUser(updatedUser);
        success("Profile updated successfully.");
      } else {
        const data = await res.json();
        error(data.error || "Failed to update profile.");
      }
    } catch (err) {
      console.error(err);
      error("An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 w-full min-w-0 flex flex-col bg-page-bg">
      {/* Cover and header */}
      <div className={`w-full relative h-48 shrink-0 transition-all duration-300 ${getUserGradient(user?.name)}`}>
        <div className="absolute inset-0 bg-black/20" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-12 -mt-16 relative z-10 w-full min-w-0">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 min-w-0">
          {/* Left Column: Avatar & Quick Info */}
          <div className="w-full lg:w-80 shrink-0 min-w-0">
            <div className="bg-surface border border-border-subtle rounded-xl p-6 shadow-xl flex flex-col items-center text-center">
              <div className="p-2 bg-surface rounded-full shadow-lg -mt-16 mb-4">
                <UserAvatar
                  user={user}
                  className="w-24 h-24 text-4xl shadow-inner"
                  showTooltip={false}
                />
              </div>
              <h2 className="text-xl font-bold text-strong">{user?.name}</h2>
              <p className="text-sm text-muted mb-2">{user?.email}</p>

              <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-surface-dim border-border-subtle mb-4 shadow-sm">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  STATUS_OPTIONS.find(o => o.value === user?.status)?.color || "bg-green-500"
                )} />
                <span className="text-subtle font-medium">{user?.status || "Available"}</span>
              </div>

              <div className={`w-full flex items-center justify-center space-x-2 border rounded py-2 text-xs font-bold uppercase tracking-wider ${skills.length > 0 ? 'mb-4' : 'mb-6'} ${roleInfo.bg} ${roleInfo.border} ${roleInfo.color}`}>
                <RoleIcon size={14} />
                <span>{roleInfo.label}</span>
              </div>

              {skills.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5 mb-6">
                  {skills.map(skill => (
                    <span key={skill.id} className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-surface-dim border border-border-subtle rounded text-subtle">
                      {skill.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="w-full grid grid-cols-2 gap-4 border-t border-border-subtle pt-6">
                <div className="flex flex-col items-center">
                  <span className="text-2xl font-bold text-strong">{stats.tasks}</span>
                  <span className="text-[10px] text-muted uppercase tracking-widest mt-1">Tasks</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-2xl font-bold text-strong">{stats.projects}</span>
                  <span className="text-[10px] text-muted uppercase tracking-widest mt-1">Projects</span>
                </div>
              </div>

              {/* Git Integrations Status Card */}
              {isManagerOrAdmin && integrationsStatus && gitEnabled && (
                <div className="w-full border-t border-border-subtle pt-4 mt-4 flex flex-col space-y-2">
                  <div className="flex items-center justify-between text-left px-1">
                    <span className="text-[10px] font-bold text-muted uppercase tracking-widest flex items-center space-x-1">
                      <GitBranch size={12} className="text-blue-500" />
                      <span>Git Connectivity</span>
                    </span>
                    <Link to="/git" className="text-[10px] text-blue-500 hover:underline font-semibold flex items-center space-x-0.5">
                      <span>Manage</span>
                      <ExternalLink size={10} />
                    </Link>
                  </div>

                  {/* GitHub Status Badge */}
                  <div className={cn(
                    "flex items-center justify-between p-2.5 rounded-lg border text-xs transition-all",
                    integrationsStatus.github?.color === 'emerald'
                      ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                      : integrationsStatus.github?.color === 'amber'
                      ? "bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400"
                      : "bg-slate-500/5 border-slate-500/20 text-slate-500 dark:text-slate-400"
                  )}>
                    <div className="flex items-center space-x-2 min-w-0">
                      <Github size={16} className="shrink-0" />
                      <div className="flex flex-col text-left truncate">
                        <span className="font-bold truncate text-[11px]">GitHub</span>
                        <span className="text-[9px] opacity-80 truncate">{integrationsStatus.github?.details}</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0 ml-2">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border inline-flex items-center space-x-1 shadow-sm",
                        integrationsStatus.github?.color === 'emerald'
                          ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30"
                          : integrationsStatus.github?.color === 'amber'
                          ? "bg-amber-500/20 text-amber-500 border-amber-500/30"
                          : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", integrationsStatus.github?.color === 'emerald' ? "bg-emerald-500 animate-pulse" : (integrationsStatus.github?.color === 'amber' ? "bg-amber-500 animate-pulse" : "bg-slate-400"))} />
                        <span>{integrationsStatus.github?.label}</span>
                      </span>
                    </div>
                  </div>

                  {/* GitLab Status Badge */}
                  <div className={cn(
                    "flex items-center justify-between p-2.5 rounded-lg border text-xs transition-all",
                    integrationsStatus.gitlab?.color === 'emerald'
                      ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                      : integrationsStatus.gitlab?.color === 'amber'
                      ? "bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400"
                      : "bg-slate-500/5 border-slate-500/20 text-slate-500 dark:text-slate-400"
                  )}>
                    <div className="flex items-center space-x-2 min-w-0">
                      <Gitlab size={16} className="shrink-0" />
                      <div className="flex flex-col text-left truncate">
                        <span className="font-bold truncate text-[11px]">GitLab</span>
                        <span className="text-[9px] opacity-80 truncate">{integrationsStatus.gitlab?.details}</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0 ml-2">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border inline-flex items-center space-x-1 shadow-sm",
                        integrationsStatus.gitlab?.color === 'emerald'
                          ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30"
                          : integrationsStatus.gitlab?.color === 'amber'
                          ? "bg-amber-500/20 text-amber-500 border-amber-500/30"
                          : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", integrationsStatus.gitlab?.color === 'emerald' ? "bg-emerald-500 animate-pulse" : (integrationsStatus.gitlab?.color === 'amber' ? "bg-amber-500 animate-pulse" : "bg-slate-400"))} />
                        <span>{integrationsStatus.gitlab?.label}</span>
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Settings Carousel */}
          <div className="flex-1 min-w-0">
            {/* Grabbable Carousel Tabs Header */}
            <div className="relative border-b border-border-subtle mb-8 pt-2">
              <div className="flex items-center">
                {/* Left Carousel Arrow */}
                <button
                  type="button"
                  onClick={handlePrevTab}
                  className="shrink-0 p-2 text-subtle hover:text-strong hover:bg-surface-accent/60 rounded-lg transition-colors mr-1 cursor-pointer active:scale-95"
                  title="Previous Tab"
                  aria-label="Previous Tab"
                >
                  <ChevronLeft size={16} />
                </button>

                {/* Grabbable Tab Carousel Track */}
                <div
                  ref={tabsRef}
                  onMouseDown={handleMouseDown}
                  onMouseLeave={handleMouseLeaveOrUp}
                  onMouseUp={handleMouseLeaveOrUp}
                  onMouseMove={handleMouseMove}
                  className={cn(
                    "flex space-x-1 overflow-x-auto no-scrollbar scroll-smooth min-w-0 flex-1 select-none pb-0.5",
                    isDragging ? "cursor-grabbing" : "cursor-grab"
                  )}
                >
                  {profileTabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        data-tab-id={tab.id}
                        type="button"
                        onClick={() => {
                          if (dragDistance > 5) return;
                          setActiveTab(tab.id);
                          scrollTabIntoView(tab.id);
                        }}
                        className={`shrink-0 py-3 px-4 sm:px-6 text-xs font-bold uppercase tracking-wider relative transition-colors ${
                          isActive
                            ? 'text-blue-500'
                            : 'text-subtle hover:text-strong hover:bg-surface-accent/30'
                        }`}
                      >
                        <span className="whitespace-nowrap">{tab.label}</span>
                        {isActive && (
                          <motion.div
                            layoutId="activeTabUnderline"
                            className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full"
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Right Carousel Arrow */}
                <button
                  type="button"
                  onClick={handleNextTab}
                  className="shrink-0 p-2 text-subtle hover:text-strong hover:bg-surface-accent/60 rounded-lg transition-colors ml-1 cursor-pointer active:scale-95"
                  title="Next Tab"
                  aria-label="Next Tab"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Slide Content with Carousel Animation */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="space-y-6 pt-2"
              >
              {activeTab === 'general' && (
                <>
                  {/* Personal Information */}
                  <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center gap-2">

                <Settings size={18} className="text-subtle" />
                <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                  Personal Information
                </h3>
              </div>
              <div className="p-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-surface-dim border border-border-subtle rounded px-4 py-2 text-strong focus:outline-none focus:border-blue-500 transition-colors"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block mb-2">
                      Active Status Tag
                    </label>
                    <CustomSelect
                      value={statusText}
                      onChange={setStatusText}
                      options={STATUS_OPTIONS.map((opt) => ({
                        value: opt.value,
                        label: opt.label.toUpperCase(),
                        icon: (
                          <span className={cn(
                            "w-2.5 h-2.5 rounded-full ring-2 ring-surface shrink-0 inline-block",
                            opt.color
                          )} />
                        )
                      }))}
                      size="md"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block mb-2">
                      Role
                    </label>
                    <input
                      type="text"
                      value={user?.role?.toUpperCase() || ""}
                      disabled
                      readOnly
                      className="w-full bg-surface-dim/30 border border-border-subtle rounded px-4 py-2 text-strong opacity-70 cursor-not-allowed"
                    />
                    <p className="text-[10px] text-muted mt-2">
                      Roles are managed by workspace administrators.
                    </p>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-subtle uppercase tracking-widest block mb-2">
                      Email Address
                    </label>
                    <input
                      type="text"
                      value={user?.email || ""}
                      readOnly
                      className="w-full bg-surface-dim/30 border border-border-subtle rounded px-4 py-2 text-muted cursor-not-allowed"
                    />
                    <p className="text-[10px] text-muted mt-2">
                      Email address forms your unique identity.
                    </p>
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:text-strong/50 text-strong px-6 py-2 rounded font-bold uppercase text-[10px] tracking-widest transition-colors"
                    >
                      {saving ? (
                        <span>Saving...</span>
                      ) : (
                        <>
                          <Save size={14} />
                          <span>Save Changes</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Preferences */}
            <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center gap-2">
                <Monitor size={18} className="text-subtle" />
                <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                  Preferences
                </h3>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-strong">
                      Application Theme
                    </h4>
                    <p className="text-xs text-muted mt-1">
                      Switch between light and dark visual modes.
                    </p>
                  </div>
                  <button
                    onClick={toggleTheme}
                    className="flex items-center space-x-2 bg-surface-dim border border-border-subtle hover:border-blue-500/50 px-4 py-2 rounded transition-colors"
                  >
                    {theme === "dark" ? (
                      <>
                        <Sun size={16} className="text-yellow-500" />
                        <span className="text-xs font-bold uppercase tracking-wider text-strong">
                          Light Mode
                        </span>
                      </>
                    ) : (
                      <>
                        <Moon size={16} className="text-blue-500" />
                        <span className="text-xs font-bold uppercase tracking-wider text-strong">
                          Dark Mode
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
                </>
              )}

              {activeTab === 'activity' && (
                <div className="space-y-4">
                  <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center gap-2">
                      <Activity size={18} className="text-subtle" />
                      <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                        Recent Activity
                      </h3>
                    </div>
                    <div className="p-0">
                      {activities.length > 0 ? activities.map((activity, i) => (
                        <div key={i} className="p-4 border-b border-border-subtle/50 last:border-0 flex items-start space-x-4 hover:bg-surface-dim/20 transition-colors">
                          <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg shrink-0 mt-1">
                            <Activity size={16} />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-strong leading-tight">{activity.taskTitle || "Task"}</h4>
                            <p className="text-xs text-muted mt-1 capitalize">{activity.action}</p>
                            <span className="text-[10px] text-subtle uppercase tracking-wider font-bold mt-2 block">
                              {safeFormatDistanceToNow(activity.createdAt, { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                      )) : (
                        <div className="p-6 text-center text-sm text-muted">
                          No recent activity found.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'security' && (
                <div className="space-y-6">
                  <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center gap-2">
                      <Shield size={18} className="text-subtle" />
                      <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                        Security Overview
                      </h3>
                    </div>
                    <div className="p-6">
                        <div className="flex flex-col space-y-4">
                          {!isChangingPassword ? (
                            <div className="flex items-center justify-between p-4 border border-border-subtle rounded-lg bg-surface-dim/20">
                              <div className="flex items-center space-x-4">
                                <div className="p-2 bg-green-500/10 text-green-500 rounded-full">
                                  <Key size={18} />
                                </div>
                                <div>
                                  <h4 className="text-sm font-bold text-strong">Password</h4>
                                  <p className="text-xs text-muted mt-1">Manage your account password</p>
                                </div>
                              </div>
                              <button 
                                onClick={() => setIsChangingPassword(true)}
                                className="px-4 py-2 border border-border-subtle rounded hover:border-blue-500 text-xs font-bold tracking-wider uppercase transition-colors"
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <div className="p-4 border border-border-subtle rounded-lg bg-surface-dim/30">
                              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                                <div>
                                  <label className="block text-xs font-bold text-strong mb-1 uppercase tracking-wider">Current Password</label>
                                  <input 
                                    type="password" 
                                    value={passwordData.currentPassword}
                                    onChange={e => setPasswordData({...passwordData, currentPassword: e.target.value})}
                                    className="w-full bg-surface-dim border border-border-subtle rounded p-2 text-sm text-strong focus:outline-none focus:border-blue-500 transition-colors"
                                    required
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold text-strong mb-1 uppercase tracking-wider">New Password</label>
                                  <input 
                                    type="password" 
                                    value={passwordData.newPassword}
                                    onChange={e => setPasswordData({...passwordData, newPassword: e.target.value})}
                                    className="w-full bg-surface-dim border border-border-subtle rounded p-2 text-sm text-strong focus:outline-none focus:border-blue-500 transition-colors"
                                    required
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <button 
                                    type="button"
                                    onClick={() => {
                                      setIsChangingPassword(false);
                                      setPasswordData({ currentPassword: '', newPassword: '' });
                                    }}
                                    className="flex-1 py-2 text-xs font-bold tracking-wider uppercase border border-border-subtle rounded hover:bg-surface-accent/50 transition-colors text-strong"
                                  >
                                    Cancel
                                  </button>
                                  <button 
                                    type="submit" 
                                    disabled={passwordSaving}
                                    className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-bold tracking-wider uppercase transition-colors disabled:opacity-50"
                                  >
                                    {passwordSaving ? "Saving..." : "Save"}
                                  </button>
                                </div>
                              </form>
                            </div>
                          )}

                          <div className="flex items-center justify-between p-4 border border-border-subtle rounded-lg bg-surface-dim/20">
                            <div className="flex items-center space-x-4">
                              <div className="p-2 bg-blue-500/10 text-blue-500 rounded-full">
                                <Smartphone size={18} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-strong">Two-Factor Authentication</h4>
                                <p className="text-xs text-muted mt-1">Protect your account with 2FA.</p>
                              </div>
                            </div>
                            <button className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-bold tracking-wider uppercase transition-colors">
                              Enable
                            </button>
                          </div>
                        </div>
                    </div>
                  </div>

                  <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center gap-2">
                      <Clock size={18} className="text-subtle" />
                      <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                        Active Sessions
                      </h3>
                    </div>
                    <div className="p-0">
                      <div className="p-4 flex items-center justify-between hover:bg-surface-dim/20 transition-colors">
                        <div className="flex items-center space-x-4">
                          <Globe size={24} className="text-subtle" />
                          <div>
                            <h4 className="text-sm font-bold text-strong">Chrome on macOS</h4>
                            <p className="text-xs text-muted">Zurich, Switzerland • Current Session</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest bg-green-500/10 px-2 py-1 rounded">Active Now</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'skills' && (
                <div className="space-y-6">
                  <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Code size={18} className="text-subtle" />
                        <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                          Skills & Expertise
                        </h3>
                      </div>
                    </div>
                    <div className="p-6">
                      <form onSubmit={handleAddSkill} className="flex gap-2 mb-6">
                        <input
                          type="text"
                          value={newSkill}
                          onChange={(e) => setNewSkill(e.target.value)}
                          placeholder="Add a new skill (e.g., GraphQL)"
                          className="flex-1 bg-surface-dim border border-border-subtle rounded p-2 text-sm text-strong focus:outline-none focus:border-blue-500 transition-colors"
                        />
                        <button
                          type="submit"
                          disabled={!newSkill.trim()}
                          className="bg-blue-600 text-white p-2 rounded-md shadow hover:bg-blue-500 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          <Plus size={20} />
                        </button>
                      </form>

                      <div className="flex flex-wrap gap-2">
                        {skills.map(skill => (
                          <div 
                            key={skill.id} 
                            className="flex items-center space-x-2 bg-surface-dim border border-border-subtle rounded-full px-4 py-2"
                          >
                            <span className="text-sm font-bold text-strong leading-none mt-[2px]">{skill.name}</span>
                            <button
                              onClick={() => handleRemoveSkill(skill.id)}
                              className="text-subtle hover:text-red-500 focus:outline-none bg-surface-accent/20 hover:bg-red-500/10 rounded-full p-0.5 ml-1 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        {skills.length === 0 && (
                          <div className="w-full text-center py-6 text-sm text-muted">
                            No skills added yet. Add your technical expertise above.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'backup' && (user?.role === 'admin' || user?.role === 'super_admin' || hasFlag(user, 'reset_database')) && (
                <div className="space-y-6 animate-fade-in">
                  {/* Database Info Card */}
                  <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm animate-slide-up">
                    <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center gap-2">
                      <Database size={18} className="text-subtle" />
                      <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                        Database Engine Status
                      </h3>
                    </div>
                    <div className="p-6">
                      {loadingInfo ? (
                        <div className="animate-pulse space-y-4">
                          <div className="h-4 bg-border-subtle/50 rounded w-1/4"></div>
                          <div className="h-10 bg-border-subtle/30 rounded w-full"></div>
                        </div>
                      ) : dbInfo ? (
                        <div className="space-y-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 border border-border-subtle rounded-lg bg-surface-dim/20">
                              <span className="text-[10px] text-muted uppercase tracking-widest block mb-1">
                                Database Engine
                              </span>
                              <span className="text-lg font-bold text-strong">
                                {dbInfo.dbType}
                              </span>
                            </div>
                            {dbInfo.dbType === "SQLite" && (
                              <div className="p-4 border border-border-subtle rounded-lg bg-surface-dim/20">
                                <span className="text-[10px] text-muted uppercase tracking-widest block mb-1">
                                  SQLite File Size
                                </span>
                                <span className="text-lg font-bold text-strong">
                                  {(dbInfo.sqliteSize / (1024 * 1024)).toFixed(2)} MB
                                </span>
                              </div>
                            )}
                          </div>

                          <div>
                            <h4 className="text-[10px] text-muted uppercase tracking-widest mb-3">
                              Record Statistics
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                              <div className="p-3 border border-border-subtle/50 rounded-lg text-center bg-surface-dim/10">
                                <span className="text-xl font-bold text-strong">{dbInfo.stats?.users || 0}</span>
                                <span className="text-[9px] text-muted uppercase tracking-wider block mt-1">Users</span>
                              </div>
                              <div className="p-3 border border-border-subtle/50 rounded-lg text-center bg-surface-dim/10">
                                <span className="text-xl font-bold text-strong">{dbInfo.stats?.tasks || 0}</span>
                                <span className="text-[9px] text-muted uppercase tracking-wider block mt-1">Tasks</span>
                              </div>
                              <div className="p-3 border border-border-subtle/50 rounded-lg text-center bg-surface-dim/10">
                                <span className="text-xl font-bold text-strong">{dbInfo.stats?.projects || 0}</span>
                                <span className="text-[9px] text-muted uppercase tracking-wider block mt-1">Projects</span>
                              </div>
                              <div className="p-3 border border-border-subtle/50 rounded-lg text-center bg-surface-dim/10">
                                <span className="text-xl font-bold text-strong">{dbInfo.stats?.teams || 0}</span>
                                <span className="text-[9px] text-muted uppercase tracking-wider block mt-1">Teams</span>
                              </div>
                              <div className="p-3 border border-border-subtle/50 rounded-lg text-center bg-surface-dim/10">
                                <span className="text-xl font-bold text-strong">{dbInfo.stats?.documents || 0}</span>
                                <span className="text-[9px] text-muted uppercase tracking-wider block mt-1">Docs</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-4 text-sm text-muted">
                          Failed to load database stats.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Backup Utilities */}
                  <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center gap-2">
                      <Download size={18} className="text-subtle" />
                      <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                        Export Database Backups
                      </h3>
                    </div>
                    <div className="p-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Option 2: JSON Backup */}
                        <div className="p-5 border border-border-subtle rounded-lg bg-surface-dim/10 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center gap-2 text-strong font-bold text-sm mb-2">
                              <FileJson size={16} className="text-green-500" />
                              Portable JSON Schema (.json)
                            </div>
                            <p className="text-xs text-muted mb-4 leading-relaxed">
                              Export a metadata JSON dump of workspace tables. Password hashes and Git PATs are redacted, so this file cannot be restored in-app. Use the CLI for a secrets-preserving snapshot.
                            </p>
                          </div>
                          <button
                            onClick={handleJsonDownload}
                            className="w-full py-2.5 bg-green-500 hover:bg-green-600 text-white text-xs font-bold uppercase tracking-wider rounded transition-colors flex items-center justify-center gap-2 shadow-sm"
                          >
                            <Download size={14} />
                            Download JSON File
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {user?.role === 'super_admin' && (
                  <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center gap-2">
                      <Upload size={18} className="text-subtle" />
                      <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                        Restore Database Backups
                      </h3>
                    </div>
                    <div className="p-6 space-y-6">
                      <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-lg flex items-start gap-3">
                        <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider">Critical Warning</h4>
                          <p className="text-xs mt-1 leading-relaxed">
                            Restoring a database replaces ALL current records with the contents of the uploaded file. Active sessions will be terminated and you may be logged out. Make sure you have exported a backup first.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Restore JSON */}
                        <div className="p-5 border border-border-subtle rounded-lg bg-surface-dim/10">
                          <div className="flex items-center gap-2 text-strong font-bold text-sm mb-2">
                            <FileJson size={16} className="text-green-500" />
                            Restore JSON File
                          </div>
                          <p className="text-xs text-muted mb-4 leading-relaxed">
                            Upload a CLI JSON export that includes live password hashes and Git PATs. In-app redacted exports are refused. This wipes existing tables.
                          </p>
                          <label className="block w-full">
                            <div className="w-full py-2.5 border border-dashed border-border-subtle hover:border-green-500 rounded text-center cursor-pointer transition-colors flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider text-strong">
                              <Upload size={14} />
                              {restoring ? "Uploading..." : "Select File"}
                            </div>
                            <input
                              type="file"
                              accept=".json"
                              disabled={restoring}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleJsonRestore(file);
                              }}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                  )}
                </div>
              )}

              {activeTab === 'integrations' && (
                <div className="space-y-6">
                  <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-border-subtle bg-surface-dim/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GitBranch size={18} className="text-blue-500" />
                        <h3 className="text-xs font-bold text-strong uppercase tracking-widest">
                          Git & Service Integrations Health
                        </h3>
                      </div>
                      <Link
                        to="/git"
                        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center space-x-1"
                      >
                        <span>Manage Repositories</span>
                        <ExternalLink size={12} />
                      </Link>
                    </div>

                    <div className="p-6 space-y-6">
                      <p className="text-xs text-subtle leading-relaxed">
                        Visual connectivity badges communicate integration health across linked GitHub and GitLab projects. "Connected" indicates a linked repo with valid token configuration. "Action Required" indicates missing or unverified API tokens.
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* GitHub Integration Details */}
                        <div className="border border-border-subtle rounded-xl p-5 bg-surface-dim/20 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="p-2.5 bg-zinc-900 text-white rounded-lg">
                                <Github size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-strong">GitHub Integration</h4>
                                <p className="text-xs text-muted">Cloud & Enterprise Repositories</p>
                              </div>
                            </div>
                            {integrationsStatus?.github && (
                              <span className={cn(
                                "px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border inline-flex items-center space-x-1.5 shadow-sm",
                                integrationsStatus.github.color === 'emerald'
                                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                  : integrationsStatus.github.color === 'amber'
                                  ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                  : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                              )}>
                                <span className={cn("w-2 h-2 rounded-full", integrationsStatus.github.color === 'emerald' ? "bg-emerald-500 animate-pulse" : (integrationsStatus.github.color === 'amber' ? "bg-amber-500 animate-pulse" : "bg-slate-400"))} />
                                <span>{integrationsStatus.github.label}</span>
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-subtle space-y-2 bg-surface p-3.5 rounded-lg border border-border-subtle/60">
                            <div className="flex justify-between items-center">
                              <span className="text-muted">Linked Repositories:</span>
                              <span className="font-bold text-strong">{integrationsStatus?.github?.repoCount || 0} Projects</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted">Personal Access Token:</span>
                              <span className={cn("font-semibold", integrationsStatus?.github?.hasToken ? "text-emerald-500" : "text-slate-400")}>
                                {integrationsStatus?.github?.hasToken ? "Configured & Active" : "Not Linked (Optional)"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center pt-1.5 border-t border-border-subtle/30">
                              <span className="text-muted">Health Details:</span>
                              <span className="font-medium text-strong">{integrationsStatus?.github?.details}</span>
                            </div>
                          </div>

                          <Link
                            to="/git"
                            className="w-full py-2 px-4 bg-surface hover:bg-surface-accent border border-border-subtle rounded-lg text-xs font-semibold text-strong flex items-center justify-center space-x-1.5 transition-colors"
                          >
                            <Settings size={14} />
                            <span>Configure GitHub Settings</span>
                          </Link>
                        </div>

                        {/* GitLab Integration Details */}
                        <div className="border border-border-subtle rounded-xl p-5 bg-surface-dim/20 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="p-2.5 bg-orange-600 text-white rounded-lg">
                                <Gitlab size={20} />
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-strong">GitLab Integration</h4>
                                <p className="text-xs text-muted">Self-Hosted & GitLab SaaS</p>
                              </div>
                            </div>
                            {integrationsStatus?.gitlab && (
                              <span className={cn(
                                "px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider border inline-flex items-center space-x-1.5 shadow-sm",
                                integrationsStatus.gitlab.color === 'emerald'
                                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                  : integrationsStatus.gitlab.color === 'amber'
                                  ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                  : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                              )}>
                                <span className={cn("w-2 h-2 rounded-full", integrationsStatus.gitlab.color === 'emerald' ? "bg-emerald-500 animate-pulse" : (integrationsStatus.gitlab.color === 'amber' ? "bg-amber-500 animate-pulse" : "bg-slate-400"))} />
                                <span>{integrationsStatus.gitlab.label}</span>
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-subtle space-y-2 bg-surface p-3.5 rounded-lg border border-border-subtle/60">
                            <div className="flex justify-between items-center">
                              <span className="text-muted">Linked Repositories:</span>
                              <span className="font-bold text-strong">{integrationsStatus?.gitlab?.repoCount || 0} Projects</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted">Personal Access Token:</span>
                              <span className={cn("font-semibold", integrationsStatus?.gitlab?.hasToken ? "text-emerald-500" : "text-slate-400")}>
                                {integrationsStatus?.gitlab?.hasToken ? "Configured & Active" : "Not Linked"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center pt-1.5 border-t border-border-subtle/30">
                              <span className="text-muted">Health Details:</span>
                              <span className="font-medium text-strong">{integrationsStatus?.gitlab?.details}</span>
                            </div>
                          </div>

                          <Link
                            to="/git"
                            className="w-full py-2 px-4 bg-surface hover:bg-surface-accent border border-border-subtle rounded-lg text-xs font-semibold text-strong flex items-center justify-center space-x-1.5 transition-colors"
                          >
                            <Settings size={14} />
                            <span>Configure GitLab Settings</span>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
