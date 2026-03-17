import { useAuth } from "@/hooks/useAuth";
import { LogOut, User } from "lucide-react";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-6">
      <WorkspaceSwitcher />

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <User size={16} />
          <span>{user?.full_name}</span>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
            {user?.user_type}
          </span>
        </div>
        <button
          onClick={logout}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="Logout"
          aria-label="Logout"
        >
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
