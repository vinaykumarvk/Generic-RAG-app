import { NavLink, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LayoutDashboard, Settings, FolderOpen, Search, GitFork, FileText } from "lucide-react";

export function Sidebar() {
  const { isAdmin } = useAuth();
  const { workspaceId } = useParams();

  return (
    <aside className="w-64 bg-gray-900 text-gray-100 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold tracking-tight">
          <span className="text-primary-400">Intelli</span>RAG
        </h1>
        <p className="text-xs text-gray-400 mt-1">Knowledge Platform</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive ? "bg-primary-600/20 text-primary-300" : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`
          }
        >
          <LayoutDashboard size={18} />
          Dashboard
        </NavLink>

        {workspaceId && (
          <div className="pt-4 mt-4 border-t border-gray-700">
            <p className="px-3 text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Workspace
            </p>
            <NavLink
              to={`/workspace/${workspaceId}`}
              end
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-primary-600/20 text-primary-300" : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`
              }
            >
              <FolderOpen size={18} />
              Overview
            </NavLink>
            <NavLink
              to={`/workspace/${workspaceId}/documents`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-primary-600/20 text-primary-300" : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`
              }
            >
              <FileText size={18} />
              Documents
            </NavLink>
            <NavLink
              to={`/workspace/${workspaceId}/query`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-primary-600/20 text-primary-300" : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`
              }
            >
              <Search size={18} />
              Query
            </NavLink>
            <NavLink
              to={`/workspace/${workspaceId}/graph`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-primary-600/20 text-primary-300" : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`
              }
            >
              <GitFork size={18} />
              Graph
            </NavLink>
          </div>
        )}

        {isAdmin && (
          <div className="pt-4 mt-4 border-t border-gray-700">
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? "bg-primary-600/20 text-primary-300" : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`
              }
            >
              <Settings size={18} />
              Admin
            </NavLink>
          </div>
        )}
      </nav>
    </aside>
  );
}
