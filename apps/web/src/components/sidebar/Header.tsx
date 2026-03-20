import { type ReactNode, useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { SettingsDropdown } from "@/components/SettingsDropdown";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { LogOut, Settings, ChevronDown } from "lucide-react";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";

export function Header({ sidebarToggle }: { sidebarToggle?: ReactNode }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setShowThemes(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setShowThemes(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  const initials = (user?.full_name || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="h-14 border-b border-border-primary bg-surface-primary flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        {sidebarToggle}
        <WorkspaceSwitcher />
      </div>

      <div className="flex items-center gap-3">
        <NotificationBell />

        {/* Avatar + dropdown menu */}
        <div ref={menuRef} className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => { setMenuOpen((v) => !v); setShowThemes(false); }}
            className="flex items-center gap-2 p-1 rounded-lg hover:bg-surface-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-expanded={menuOpen}
            aria-haspopup="true"
            aria-label="User menu"
          >
            <span className="w-8 h-8 rounded-full bg-brand text-on-brand flex items-center justify-center text-xs font-semibold shrink-0">
              {initials}
            </span>
            <ChevronDown size={14} className="text-text-tertiary" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-64 rounded-xl shadow-lg border border-border-primary bg-surface-primary z-50 py-1 overflow-hidden"
            >
              {/* User info header */}
              <div className="px-4 py-3 border-b border-border-primary">
                <p className="text-sm font-medium text-text-primary truncate">{user?.full_name}</p>
                <p className="text-xs text-text-tertiary mt-0.5">{user?.email}</p>
                <span className="inline-block mt-1.5 text-xs px-2 py-0.5 rounded bg-surface-secondary text-text-tertiary">
                  {user?.user_type}
                </span>
              </div>

              {/* Settings (theme picker) */}
              <div className="py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setShowThemes((v) => !v)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-secondary transition-colors"
                >
                  <Settings size={16} aria-hidden="true" />
                  <span className="flex-1 text-left">Settings</span>
                  <ChevronDown size={14} className={`text-text-tertiary transition-transform ${showThemes ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {showThemes && (
                  <div className="px-2 pb-1">
                    <SettingsDropdown inline />
                  </div>
                )}
              </div>

              {/* Logout */}
              <div className="border-t border-border-primary py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); void logout(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[rgb(var(--color-danger))] hover:bg-[rgb(var(--color-danger-soft))] transition-colors"
                >
                  <LogOut size={16} aria-hidden="true" />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
