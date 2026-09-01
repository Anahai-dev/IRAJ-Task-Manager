import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGitFeature } from '../contexts/GitFeatureContext';
import { LayoutDashboard, KanbanSquare, LogOut, Users, Calendar, FolderKanban, FileText, Map, Sun, Moon, Shield, PanelLeftClose, PanelLeft, Workflow, Settings, ChevronUp, ChevronDown, ChevronRight, Menu, X, GitBranch, Github, Gitlab } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

import NotificationsDropdown from './NotificationsDropdown';

import { Tooltip } from './Tooltip';
import UserAvatar from './UserAvatar';
import WelcomeModal from './WelcomeModal';
import GlobalSearch from './GlobalSearch';

export default function Layout() {
  const { user, token, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { gitEnabled, setGitEnabled } = useGitFeature();
  const location = useLocation();
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [integrationsStatus, setIntegrationsStatus] = useState<any>(null);
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({
    Management: false,
    Tasks: false,
  });
  const [unreadNotifications, setUnreadNotifications] = useState<number>(() => (window as any).__unreadCount || 0);

  React.useEffect(() => {
    const handleUnreadChange = (e: Event) => {
      setUnreadNotifications((e as CustomEvent).detail || 0);
    };
    window.addEventListener('unread-notifications-changed', handleUnreadChange);
    if ((window as any).__unreadCount !== undefined) {
      setUnreadNotifications((window as any).__unreadCount);
    }
    return () => {
      window.removeEventListener('unread-notifications-changed', handleUnreadChange);
    };
  }, []);

  React.useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/integrations/status', {
          headers: { }
        });
        if (res.ok) {
          const data = await res.json();
          setIntegrationsStatus(data);
        }
      } catch (err) {
        console.error('Failed to fetch integration status:', err);
      }
    };
    if (token) fetchStatus();
  }, [token, location.pathname]);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close mobile drawer automatically when changing routes
  React.useEffect(() => {
    setIsMobileOpen(false);
  }, [location.pathname]);

  const toggleMenu = (name: string) => {
    if (!isExpanded && !isMobile) {
      setIsExpanded(true);
      setOpenMenus(prev => ({ ...prev, [name]: true }));
    } else {
      setOpenMenus(prev => ({ ...prev, [name]: !prev[name] }));
    }
  };

  const navItems = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { 
      name: 'Management', 
      icon: FolderKanban, 
      children: [
        { name: 'Projects', href: '/projects', icon: FolderKanban },
        ...(gitEnabled ? [{ name: 'Git Repositories', href: '/git', icon: GitBranch }] : []),
        { name: 'Planning', href: '/planning', icon: Map },
        { name: 'Documents', href: '/documents', icon: FileText },
      ]
    },
    { 
      name: 'Tasks', 
      icon: KanbanSquare, 
      children: [
        { name: 'Task Board', href: '/board', icon: KanbanSquare },
        { name: 'Task Graph', href: '/graph', icon: Workflow },
        { name: 'Calendar', href: '/calendar', icon: Calendar },
      ]
    },
    { name: 'Teams', href: '/teams', icon: Users },
  ];

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (
         target.tagName === 'INPUT' ||
         target.tagName === 'TEXTAREA' ||
         target.tagName === 'SELECT' ||
         target.isContentEditable
      ) {
        return;
      }

      if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // We shouldn't preventDefault so easily, but here it's fine for simple shortcuts if not inside input
        e.preventDefault();
        toggleTheme();
      } else if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('open-new-task-modal'));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTheme]);

  if (user?.permissions?.manage_roles === true || user?.permissions?.manage_users === true || user?.role === 'super_admin') {
    navItems.push({ name: 'Admin', href: '/admin/users', icon: Shield });
  }

  const showExpanded = isMobile ? true : isExpanded;

  return (
    <div 
      className="flex h-screen bg-page-bg text-primary font-sans overflow-hidden transition-colors duration-200 relative"
      style={{ '--sidebar-width': showExpanded ? '256px' : '80px' } as React.CSSProperties}
    >
      <WelcomeModal />

      {/* Mobile Sidebar Overlay Backdrop */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileOpen(false)}
            className="fixed inset-0 bg-black/60 md:hidden z-40"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside 
        className={cn(
          "tour-sidebar flex flex-col py-6 border-r border-border-subtle bg-surface-dim transition-all duration-300 z-50 shrink-0 overflow-visible",
          // Layout constraints across screens
          "fixed inset-y-0 left-0 md:relative md:translate-x-0 md:flex",
          isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          showExpanded ? "w-64 px-3" : "w-20 px-3.5"
        )}
      >
        <div className="flex flex-col w-full mb-8 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className={cn("bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold transition-all shrink-0 text-center", showExpanded ? "h-10 w-full text-sm leading-tight px-1" : "w-10 h-10 mx-auto")}>
              {showExpanded ? "IRAJ" : "Σ"}
            </div>
            {isMobileOpen && (
              <button
                onClick={() => setIsMobileOpen(false)}
                className="md:hidden p-1.5 text-subtle hover:text-strong hover:bg-surface-accent rounded-md transition-colors ml-2"
                title="Close Menu"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <Tooltip content={isExpanded ? "Collapse Sidebar" : "Expand Sidebar"} position="right">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="hidden md:flex w-10 h-10 shrink-0 text-subtle hover:text-strong hover:bg-surface-accent rounded-md transition-colors items-center justify-center mx-auto"
            >
              {isExpanded ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
            </button>
          </Tooltip>
        </div>

        <nav className="flex-1 min-h-0 flex flex-col space-y-1 w-full overflow-y-auto overflow-x-hidden custom-scrollbar pr-0.5">
          {navItems.map((item) => {
            if (item.children) {
              const Icon = item.icon;
              const isOpen = openMenus[item.name];
              const isAnyChildActive = item.children.some(child => location.pathname === child.href);

              return (
                <div key={item.name} className="flex flex-col space-y-1 w-full relative shrink-0">
                  <Tooltip content={showExpanded ? undefined : item.name} position="right">
                    <button
                      onClick={() => toggleMenu(item.name)}
                      className={cn(
                        'flex items-center rounded-md transition-all duration-300 cursor-pointer w-full h-10 relative',
                        !showExpanded && isAnyChildActive 
                          ? 'text-blue-500 bg-blue-500/10 font-medium' 
                          : 'text-subtle hover:text-strong hover:bg-surface-accent/30',
                        showExpanded && isOpen && 'text-strong font-medium'
                      )}
                    >
                      <div className="flex items-center justify-center w-10 h-10 shrink-0">
                        <Icon className={cn("w-5 h-5", isAnyChildActive && !showExpanded && "text-blue-500")} />
                      </div>
                      {!showExpanded && (
                        <ChevronRight size={14} className="absolute -right-1 top-1/2 -translate-y-1/2 text-muted" />
                      )}
                      <span 
                        className={cn(
                          "text-sm truncate transition-all duration-300 whitespace-nowrap flex-1 text-left", 
                          showExpanded ? "opacity-100 max-w-full" : "opacity-0 max-w-0"
                        )}
                      >
                        {item.name}
                      </span>
                      <div className={cn("flex items-center justify-center shrink-0 transition-all duration-300 overflow-hidden", showExpanded ? "opacity-100 w-8" : "opacity-0 w-0")}>
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </div>
                    </button>
                  </Tooltip>
                  
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ 
                          height: showExpanded ? 'auto' : 0, 
                          opacity: showExpanded ? 1 : 0 
                        }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="flex flex-col space-y-1 overflow-hidden"
                      >
                        {item.children.map(child => {
                          const ChildIcon = child.icon;
                          const isChildActive = location.pathname === child.href;
                          return (
                            <Link
                              key={child.name}
                              to={child.href}
                              className={cn(
                                'flex items-center rounded-md transition-all duration-300 cursor-pointer overflow-hidden w-full h-9 pl-4 shrink-0',
                                isChildActive
                                  ? 'text-blue-500 bg-blue-500/10 font-medium'
                                  : 'text-subtle hover:text-strong hover:bg-surface-accent/30'
                              )}
                            >
                              <div className="flex items-center justify-center w-8 h-8 shrink-0 mr-2">
                                <ChildIcon className="w-4 h-4" />
                              </div>
                              <span className={cn(
                                "text-sm truncate whitespace-nowrap transition-all duration-300 flex-1 text-left",
                                showExpanded ? "opacity-100 max-w-full" : "opacity-0 max-w-0"
                              )}>
                                {child.name}
                              </span>
                              {child.name === 'Git Repositories' && integrationsStatus && (
                                <div className={cn(
                                  "ml-auto mr-2 flex items-center space-x-1.5 shrink-0 transition-all duration-300 overflow-hidden",
                                  showExpanded ? "opacity-100 max-w-[120px] scale-100" : "opacity-0 max-w-0 scale-90"
                                )}>
                                  <span
                                    title={`GitHub Integration: ${integrationsStatus.github?.label} (${integrationsStatus.github?.details})`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      navigate('/git');
                                    }}
                                    className={cn(
                                      "relative inline-flex items-center justify-center p-1.5 rounded-md border transition-all duration-200 cursor-pointer hover:scale-110 hover:shadow-md active:scale-95",
                                      integrationsStatus.github?.color === 'emerald'
                                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20"
                                        : integrationsStatus.github?.color === 'amber'
                                        ? "bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20"
                                        : "bg-slate-500/10 text-slate-400 border-slate-500/20 hover:bg-slate-500/20"
                                    )}
                                  >
                                    <Github size={12} className="shrink-0" />
                                    <span className={cn(
                                      "absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-surface-dim shrink-0",
                                      integrationsStatus.github?.color === 'emerald' ? "bg-emerald-500 animate-pulse" : (integrationsStatus.github?.color === 'amber' ? "bg-amber-500 animate-pulse" : "bg-slate-400")
                                    )} />
                                  </span>

                                  <span
                                    title={`GitLab Integration: ${integrationsStatus.gitlab?.label} (${integrationsStatus.gitlab?.details})`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      navigate('/git');
                                    }}
                                    className={cn(
                                      "relative inline-flex items-center justify-center p-1.5 rounded-md border transition-all duration-200 cursor-pointer hover:scale-110 hover:shadow-md active:scale-95",
                                      integrationsStatus.gitlab?.color === 'emerald'
                                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20"
                                        : integrationsStatus.gitlab?.color === 'amber'
                                        ? "bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20"
                                        : "bg-slate-500/10 text-slate-400 border-slate-500/20 hover:bg-slate-500/20"
                                    )}
                                  >
                                    <Gitlab size={12} className="shrink-0" />
                                    <span className={cn(
                                      "absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-surface-dim shrink-0",
                                      integrationsStatus.gitlab?.color === 'emerald' ? "bg-emerald-500 animate-pulse" : (integrationsStatus.gitlab?.color === 'amber' ? "bg-amber-500 animate-pulse" : "bg-slate-400")
                                    )} />
                                  </span>
                                </div>
                              )}
                            </Link>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }

            const isActive = location.pathname === item.href;
            const Icon = item.icon;
            return (
              <Tooltip key={item.name} content={showExpanded ? undefined : item.name} position="right">
                <Link
                  to={item.href}
                  className={cn(
                    'flex items-center rounded-md transition-all duration-300 cursor-pointer overflow-hidden w-full h-10 shrink-0',
                    isActive
                      ? 'text-blue-500 bg-blue-500/10 font-medium'
                      : 'text-subtle hover:text-strong hover:bg-surface-accent/30'
                  )}
                >
                  <div className="flex items-center justify-center w-10 h-10 shrink-0">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span 
                    className={cn(
                      "text-sm truncate transition-all duration-300 whitespace-nowrap", 
                      showExpanded ? "opacity-100 max-w-full" : "opacity-0 max-w-0"
                    )}
                  >
                    {item.name}
                  </span>
                </Link>
              </Tooltip>
            );
          })}
        </nav>

        <div className="mt-auto pt-4 flex flex-col space-y-1 w-full border-t border-border-subtle/50 shrink-0">
          <AnimatePresence>
            {isSettingsExpanded && (
              <motion.div 
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: showExpanded ? 4 : 8 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className={cn("flex w-full overflow-hidden flex-col shrink-0", showExpanded ? "bg-surface/50 border border-border-subtle/30 rounded-lg p-1 space-y-1" : "space-y-2")}
              >
                 <Tooltip content={showExpanded ? undefined : `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} position="right">
                   <button
                     onClick={toggleTheme}
                     className={cn("tour-theme-toggle flex items-center text-subtle hover:text-strong rounded-md transition-all duration-300 hover:bg-surface-accent/50 overflow-hidden w-full h-10 shrink-0")}
                   >
                     <div className="flex items-center justify-center w-10 h-10 shrink-0">
                       {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                     </div>
                     <span className={cn("text-sm transition-all duration-300 whitespace-nowrap", showExpanded ? "opacity-100 max-w-full" : "opacity-0 max-w-0")}>Theme</span>
                   </button>
                 </Tooltip>

                 <Tooltip content={showExpanded ? undefined : `Git: ${gitEnabled ? 'ON' : 'OFF'}`} position="right">
                   <button
                     onClick={() => setGitEnabled(!gitEnabled)}
                     className={cn("flex items-center text-subtle hover:text-strong rounded-md transition-all duration-300 hover:bg-surface-accent/50 overflow-hidden w-full h-10 shrink-0")}
                   >
                     <div className="flex items-center justify-center w-10 h-10 shrink-0 relative">
                       <GitBranch size={18} className={cn(gitEnabled ? "text-blue-500" : "text-muted")} />
                       <span className={cn(
                         "absolute bottom-2.5 right-2.5 w-1.5 h-1.5 rounded-full border border-surface-dim",
                         gitEnabled ? "bg-emerald-500" : "bg-red-500"
                       )} />
                     </div>
                     <span className={cn("text-sm transition-all duration-300 whitespace-nowrap flex-1 text-left", showExpanded ? "opacity-100 max-w-full" : "opacity-0 max-w-0")}>Git Integration</span>
                     {showExpanded && (
                       <span className={cn(
                         "text-[9px] px-1.5 py-0.5 rounded font-bold mr-2 select-none",
                         gitEnabled ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-400"
                       )}>
                         {gitEnabled ? 'ON' : 'OFF'}
                       </span>
                     )}
                   </button>
                 </Tooltip>
                 
                 <Tooltip content={showExpanded ? undefined : "Logout"} position="right">
                   <button
                     onClick={logout}
                     className={cn("flex items-center text-subtle hover:text-red-500 rounded-md transition-all duration-300 hover:bg-red-500/10 overflow-hidden w-full h-10 shrink-0")}
                   >
                     <div className="flex items-center justify-center w-10 h-10 shrink-0">
                       <LogOut size={18} />
                     </div>
                     <span className={cn("text-sm transition-all duration-300 whitespace-nowrap", showExpanded ? "opacity-100 max-w-full" : "opacity-0 max-w-0")}>Logout</span>
                   </button>
                 </Tooltip>
              </motion.div>
            )}
          </AnimatePresence>

          <Tooltip content={showExpanded ? undefined : (isSettingsExpanded ? "Close Settings" : "Settings")} position="right">
            <button
              onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
              className={cn("flex items-center text-subtle hover:text-strong rounded-md transition-all duration-300 hover:bg-surface-accent/30 overflow-hidden w-full h-10 shrink-0")}
            >
              <div className="flex items-center justify-center w-10 h-10 shrink-0">
                <Settings size={20} className={cn("transition-transform duration-300", isSettingsExpanded && "rotate-90")} />
              </div>
              <span className={cn("text-sm font-medium transition-all duration-300 whitespace-nowrap truncate", showExpanded ? "opacity-100 max-w-full flex-1 text-left" : "opacity-0 max-w-0")}>Settings</span>
              <div className={cn("flex items-center justify-center shrink-0 transition-all duration-300 overflow-hidden", showExpanded ? "opacity-100 w-8" : "opacity-0 w-0")}>
                {isSettingsExpanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronUp size={16} className="text-muted" />}
              </div>
            </button>
          </Tooltip>

          <div className="flex w-full pt-2 transition-all duration-300 shrink-0">
             <Tooltip content={showExpanded ? undefined : "Profile & Integrations"} position="right">
                <Link 
                  to="/profile"
                  className={cn("tour-user-dropdown hover:opacity-90 transition-all duration-300 flex items-center w-full", showExpanded ? "p-2 bg-surface border border-border-subtle rounded-lg shadow-sm overflow-hidden" : "h-10 rounded-full overflow-visible")} 
                >
                  <div className="flex items-center justify-center w-10 h-10 shrink-0 relative">
                     <UserAvatar user={user} showTooltip={!showExpanded} />
                     {!showExpanded && unreadNotifications > 0 && (
                       <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white font-semibold text-[9px] rounded-full border-2 border-surface-dim flex items-center justify-center shadow-md select-none pointer-events-none animate-pulse">
                         {unreadNotifications}
                       </span>
                     )}
                  </div>
                  <div className={cn("flex flex-col min-w-0 transition-all duration-300 overflow-hidden ml-2 flex-1", showExpanded ? "opacity-100 max-w-full" : "opacity-0 max-w-0")}>
                    <div className="flex items-center justify-between min-w-0 mb-0.5">
                      <span className="text-sm font-bold text-strong truncate mr-2">{user?.name}</span>
                      <div className="flex items-center space-x-1.5 shrink-0" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                        <div className="tour-notifications">
                          <NotificationsDropdown compact={true} />
                        </div>
                        {integrationsStatus && gitEnabled && (
                          <div className="flex items-center space-x-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                navigate('/git');
                              }}
                              title={`GitHub: ${integrationsStatus.github?.label}`}
                              className={cn(
                                "relative inline-flex items-center justify-center p-1 rounded-md border transition-all duration-200 cursor-pointer hover:scale-110 hover:shadow-md active:scale-95",
                                integrationsStatus.github?.color === 'emerald'
                                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20"
                                  : integrationsStatus.github?.color === 'amber'
                                  ? "bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20"
                                  : "bg-slate-500/10 text-slate-400 border-slate-500/20 hover:bg-slate-500/20"
                              )}
                            >
                              <Github size={11} className="shrink-0" />
                              <span className={cn(
                                "absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-surface-dim shrink-0",
                                integrationsStatus.github?.color === 'emerald' ? "bg-emerald-500 animate-pulse" : (integrationsStatus.github?.color === 'amber' ? "bg-amber-500 animate-pulse" : "bg-slate-400")
                              )} />
                            </button>

                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                navigate('/git');
                              }}
                              title={`GitLab: ${integrationsStatus.gitlab?.label}`}
                              className={cn(
                                "relative inline-flex items-center justify-center p-1 rounded-md border transition-all duration-200 cursor-pointer hover:scale-110 hover:shadow-md active:scale-95",
                                integrationsStatus.gitlab?.color === 'emerald'
                                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20"
                                  : integrationsStatus.gitlab?.color === 'amber'
                                  ? "bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20"
                                  : "bg-slate-500/10 text-slate-400 border-slate-500/20 hover:bg-slate-500/20"
                              )}
                            >
                              <Gitlab size={11} className="shrink-0" />
                              <span className={cn(
                                "absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-surface-dim shrink-0",
                                integrationsStatus.gitlab?.color === 'emerald' ? "bg-emerald-500 animate-pulse" : (integrationsStatus.gitlab?.color === 'amber' ? "bg-amber-500 animate-pulse" : "bg-slate-400")
                              )} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted truncate">{user?.email}</span>
                  </div>
                </Link>
             </Tooltip>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden min-w-0 bg-page-bg transition-colors duration-200 relative">
        <header className="h-14 border-b border-border-subtle bg-surface flex items-center px-4 shrink-0 shadow-sm relative z-20 gap-2">
          <button
            onClick={() => setIsMobileOpen(true)}
            className="md:hidden p-2 -ml-2 text-subtle hover:text-strong hover:bg-surface-accent rounded-md transition-colors"
            title="Open Menu"
          >
            <Menu size={20} />
          </button>
          <GlobalSearch />

          {/* Visual Integration Status Badges */}
          {integrationsStatus && gitEnabled && (
            <div className="hidden sm:flex items-center space-x-2 ml-auto shrink-0">
              <Link
                to="/git"
                title={`GitHub: ${integrationsStatus.github?.label} (${integrationsStatus.github?.details})`}
                className={cn(
                  "flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all hover:scale-105 shadow-sm",
                  integrationsStatus.github?.color === 'emerald'
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                    : integrationsStatus.github?.color === 'amber'
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                    : "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30 hover:bg-slate-500/20"
                )}
              >
                <Github size={13} className="shrink-0" />
                <span className="font-mono text-[11px] font-bold">GitHub:</span>
                <span className="text-[11px] font-bold">{integrationsStatus.github?.label}</span>
                <span className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  integrationsStatus.github?.color === 'emerald'
                    ? "bg-emerald-500 animate-pulse"
                    : integrationsStatus.github?.color === 'amber'
                    ? "bg-amber-500 animate-pulse"
                    : "bg-slate-400"
                )} />
              </Link>

              <Link
                to="/git"
                title={`GitLab: ${integrationsStatus.gitlab?.label} (${integrationsStatus.gitlab?.details})`}
                className={cn(
                  "flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all hover:scale-105 shadow-sm",
                  integrationsStatus.gitlab?.color === 'emerald'
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                    : integrationsStatus.gitlab?.color === 'amber'
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                    : "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30 hover:bg-slate-500/20"
                )}
              >
                <Gitlab size={13} className="shrink-0" />
                <span className="font-mono text-[11px] font-bold">GitLab:</span>
                <span className="text-[11px] font-bold">{integrationsStatus.gitlab?.label}</span>
                <span className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  integrationsStatus.gitlab?.color === 'emerald'
                    ? "bg-emerald-500 animate-pulse"
                    : integrationsStatus.gitlab?.color === 'amber'
                    ? "bg-amber-500 animate-pulse"
                    : "bg-slate-400"
                )} />
              </Link>
            </div>
          )}
        </header>
        <div className="flex-1 overflow-y-auto w-full flex flex-col min-h-0 relative overflow-x-auto custom-scrollbar">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
