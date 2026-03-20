import { NavLink, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard, Settings, FolderOpen, Search, GitFork,
  FileText, BarChart3, Users, ClipboardList, Shield,
  MessageSquare, ChevronsLeft, ChevronsRight,
} from "lucide-react";

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onClose?: () => void;
}

export function Sidebar({ collapsed = false, onToggleCollapse, onClose }: SidebarProps) {
  const { isAdmin } = useAuth();
  const { workspaceId } = useParams();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `relative flex items-center ${collapsed ? "justify-center" : "gap-3 px-3"} py-2 rounded-lg text-sm transition-colors ${
      isActive
        ? "bg-sidebar-active-bg/20 text-sidebar-text font-medium"
        : "text-sidebar-text/70 hover:bg-sidebar-hover hover:text-sidebar-text"
    }`;

  return (
    <aside
      className={`${collapsed ? "sidebar-collapsed" : ""} bg-sidebar-bg text-sidebar-text flex flex-col h-full overflow-hidden`}
    >
      {/* Logo */}
      <div className={`${collapsed ? "p-2 flex justify-center" : "p-4"} border-b border-sidebar-border`}>
        <div className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="shrink-0" style={{ color: "var(--color-logo-accent)" }}>
            <path d="M16 2L4 8v8c0 7.73 5.12 14.96 12 16 6.88-1.04 12-8.27 12-16V8L16 2z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="16" cy="14" r="5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <path d="M13.5 14c0-1.38 1.12-2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M16 19v3M12 22h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          {!collapsed && (
            <div>
              <h1 className="text-sm font-bold tracking-tight leading-tight" style={{ fontFamily: "'Poppins', sans-serif" }}>
                <span className="text-[var(--color-logo-accent)]">ADS</span>{" "}
                <span className="text-sidebar-text">Knowledge Agent</span>
              </h1>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className={`flex-1 ${collapsed ? "p-1.5" : "p-3"} space-y-1 overflow-y-auto`} aria-label="Main navigation">
        <NavLink to="/" end data-tooltip="Dashboard" className={linkClass}>
          <LayoutDashboard size={18} className="shrink-0" />
          {!collapsed && "Dashboard"}
        </NavLink>

        {workspaceId && (
          <div className="pt-4 mt-4 border-t border-sidebar-border">
            {!collapsed && (
              <p className="px-3 text-xs font-medium text-sidebar-muted uppercase tracking-wider mb-2">
                Workspace
              </p>
            )}
            <NavLink to={`/workspace/${workspaceId}`} end data-tooltip="Overview" className={linkClass}>
              <FolderOpen size={18} className="shrink-0" />
              {!collapsed && "Overview"}
            </NavLink>
            <NavLink to={`/workspace/${workspaceId}/documents`} data-tooltip="Documents" className={linkClass}>
              <FileText size={18} className="shrink-0" />
              {!collapsed && "Documents"}
            </NavLink>
            <NavLink to={`/workspace/${workspaceId}/query`} data-tour="query-page" data-tooltip="Query" className={linkClass}>
              <Search size={18} className="shrink-0" />
              {!collapsed && "Query"}
            </NavLink>
            <NavLink to={`/workspace/${workspaceId}/graph`} data-tour="graph-explorer" data-tooltip="Graph" className={linkClass}>
              <GitFork size={18} className="shrink-0" />
              {!collapsed && "Graph"}
            </NavLink>
            <NavLink to={`/workspace/${workspaceId}/analytics`} data-tooltip="Analytics" className={linkClass}>
              <BarChart3 size={18} className="shrink-0" />
              {!collapsed && "Analytics"}
            </NavLink>
          </div>
        )}

        {isAdmin && (
          <div className="pt-4 mt-4 border-t border-sidebar-border">
            {!collapsed && (
              <p className="px-3 text-xs font-medium text-sidebar-muted uppercase tracking-wider mb-2">
                Administration
              </p>
            )}
            <NavLink to="/admin" data-tooltip="Settings" className={linkClass}>
              <Settings size={18} className="shrink-0" />
              {!collapsed && "Settings"}
            </NavLink>
            <NavLink to="/admin/users" data-tooltip="Users" className={linkClass}>
              <Users size={18} className="shrink-0" />
              {!collapsed && "Users"}
            </NavLink>
            <NavLink to="/admin/audit" data-tooltip="Audit Logs" className={linkClass}>
              <ClipboardList size={18} className="shrink-0" />
              {!collapsed && "Audit Logs"}
            </NavLink>
            <NavLink to="/admin/review" data-tooltip="Review Queue" className={linkClass}>
              <Shield size={18} className="shrink-0" />
              {!collapsed && "Review Queue"}
            </NavLink>
            <NavLink to="/admin/feedback" data-tooltip="Feedback" className={linkClass}>
              <MessageSquare size={18} className="shrink-0" />
              {!collapsed && "Feedback"}
            </NavLink>
          </div>
        )}
      </nav>

      {/* Collapse toggle (desktop only) */}
      {onToggleCollapse && (
        <div className="p-2 border-t border-sidebar-border">
          <button
            type="button"
            onClick={onToggleCollapse}
            data-tooltip={collapsed ? "Expand" : undefined}
            className="w-full flex items-center justify-center gap-2 p-2 rounded-lg text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-text transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            {!collapsed && <span className="text-xs">Collapse</span>}
          </button>
        </div>
      )}
    </aside>
  );
}
