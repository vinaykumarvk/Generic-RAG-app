import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LoginPage } from "@/pages/LoginPage";
import { AppLayout } from "@/components/sidebar/AppLayout";

const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const WorkspacePage = lazy(() => import("@/pages/WorkspacePage").then((m) => ({ default: m.WorkspacePage })));
const DocumentsPage = lazy(() => import("@/pages/DocumentsPage").then((m) => ({ default: m.DocumentsPage })));
const QueryPage = lazy(() => import("@/pages/QueryPage").then((m) => ({ default: m.QueryPage })));
const GraphExplorerPage = lazy(() => import("@/pages/GraphExplorerPage").then((m) => ({ default: m.GraphExplorerPage })));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })));
const AdminPage = lazy(() => import("@/pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const DocumentDetailPage = lazy(() => import("@/pages/DocumentDetailPage").then((m) => ({ default: m.DocumentDetailPage })));
const FeedbackDashboardPage = lazy(() => import("@/pages/FeedbackDashboardPage").then((m) => ({ default: m.FeedbackDashboardPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" role="status" aria-label="Loading page" />
    </div>
  );
}

export function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" role="status" aria-label="Loading application" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
        <Route path="/workspace/:workspaceId" element={<Suspense fallback={<PageLoader />}><WorkspacePage /></Suspense>} />
        <Route path="/workspace/:workspaceId/documents" element={<Suspense fallback={<PageLoader />}><DocumentsPage /></Suspense>} />
        <Route path="/workspace/:workspaceId/documents/:documentId" element={<Suspense fallback={<PageLoader />}><DocumentDetailPage /></Suspense>} />
        <Route path="/workspace/:workspaceId/query" element={<Suspense fallback={<PageLoader />}><QueryPage /></Suspense>} />
        <Route path="/workspace/:workspaceId/graph" element={<Suspense fallback={<PageLoader />}><GraphExplorerPage /></Suspense>} />
        <Route path="/workspace/:workspaceId/analytics" element={<Suspense fallback={<PageLoader />}><AnalyticsPage /></Suspense>} />
        <Route path="/admin" element={<Suspense fallback={<PageLoader />}><AdminPage /></Suspense>} />
        <Route path="/admin/users" element={<Suspense fallback={<PageLoader />}><AdminPage /></Suspense>} />
        <Route path="/admin/audit" element={<Suspense fallback={<PageLoader />}><AdminPage /></Suspense>} />
        <Route path="/admin/review" element={<Suspense fallback={<PageLoader />}><AdminPage /></Suspense>} />
        <Route path="/admin/feedback" element={<Suspense fallback={<PageLoader />}><FeedbackDashboardPage /></Suspense>} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
