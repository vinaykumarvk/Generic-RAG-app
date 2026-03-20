import { useState, useCallback, useEffect } from "react";
import { Outlet, useNavigate, useParams, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { GuidedTour } from "@/components/GuidedTour";
import {
  Menu, LayoutDashboard, FileText, Search, GitFork, MoreHorizontal,
} from "lucide-react";

const COLLAPSED_KEY = "intellirag_sidebar_collapsed";

export function AppLayout() {
  // Desktop: collapsed vs expanded (persisted)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "true"
  );
  // Mobile: sidebar overlay
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const navigate = useNavigate();
  const { workspaceId } = useParams();

  // Responsive breakpoint
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
      if (e.matches) setMobileSidebarOpen(false);
    };
    handler(mq);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Listen for "More" tab in bottom nav opening the sidebar
  useEffect(() => {
    const handler = () => setMobileSidebarOpen(true);
    window.addEventListener("open-mobile-sidebar", handler);
    return () => window.removeEventListener("open-mobile-sidebar", handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // Ctrl+B: toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        if (isMobile) {
          setMobileSidebarOpen((prev) => !prev);
        } else {
          toggleCollapse();
        }
        return;
      }

      // Ctrl+N: new conversation
      if ((e.ctrlKey || e.metaKey) && e.key === "n" && !isInput) {
        e.preventDefault();
        if (workspaceId) {
          navigate(`/workspace/${workspaceId}/query`);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, workspaceId, isMobile]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSED_KEY, String(!prev));
      return !prev;
    });
  }, []);

  return (
    <>
      {/* Skip to content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:bg-brand focus:text-on-brand focus:rounded-md focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <div className="min-h-[100dvh] flex bg-surface-secondary">
        {/* Mobile sidebar overlay backdrop */}
        {isMobile && mobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Desktop sidebar — always visible, collapsible */}
        {!isMobile && (
          <div
            className={`sidebar-transition shrink-0 ${collapsed ? "w-16" : "w-64"}`}
          >
            <div className="sticky top-0 h-[100dvh]">
              <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
            </div>
          </div>
        )}

        {/* Mobile sidebar — slide-in overlay */}
        {isMobile && mobileSidebarOpen && (
          <div className="fixed inset-y-0 left-0 z-50 w-64">
            <Sidebar onClose={() => setMobileSidebarOpen(false)} />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <Header
            sidebarToggle={
              isMobile ? (
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="p-2 rounded-lg hover:bg-surface-secondary text-text-secondary transition-colors"
                  aria-label="Open sidebar"
                >
                  <Menu size={18} aria-hidden="true" />
                </button>
              ) : null
            }
          />
          <main
            id="main-content"
            className={`flex-1 p-6 overflow-auto ${
              isMobile ? "pb-[calc(3.25rem+env(safe-area-inset-bottom)+1.5rem)]" : ""
            }`}
          >
            <Outlet />
          </main>
        </div>

        {/* Bottom tab bar — mobile only */}
        {isMobile && <BottomNav workspaceId={workspaceId} />}
      </div>

      <GuidedTour />
    </>
  );
}

/* ── Bottom Navigation (mobile) ── */

interface BottomNavProps {
  workspaceId?: string;
}

function BottomNav({ workspaceId }: BottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = [
    { icon: LayoutDashboard, label: "Home", path: "/" },
    ...(workspaceId
      ? [
          { icon: FileText, label: "Docs", path: `/workspace/${workspaceId}/documents` },
          { icon: Search, label: "Query", path: `/workspace/${workspaceId}/query` },
          { icon: GitFork, label: "Graph", path: `/workspace/${workspaceId}/graph` },
        ]
      : []),
    { icon: MoreHorizontal, label: "More", path: "__more__" },
  ];

  const handleTab = (path: string) => {
    if (path === "__more__") {
      // Open the mobile sidebar for overflow navigation (admin, analytics, etc.)
      // We dispatch a custom event that AppLayout listens to
      window.dispatchEvent(new CustomEvent("open-mobile-sidebar"));
      return;
    }
    navigate(path);
  };

  // Listen for "More" tab to open sidebar
  useEffect(() => {
    // This is handled via the parent's mobileSidebarOpen state
    // The "More" button dispatches a custom event
  }, []);

  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {tabs.map((tab) => {
        const isActive =
          tab.path !== "__more__" &&
          (location.pathname === tab.path ||
            (tab.path !== "/" && location.pathname.startsWith(tab.path)));

        return (
          <button
            key={tab.path}
            type="button"
            onClick={() => handleTab(tab.path)}
            className={`bottom-nav__tab ${isActive ? "bottom-nav__tab--active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            <tab.icon size={20} aria-hidden="true" />
            <span className="bottom-nav__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
