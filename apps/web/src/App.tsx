import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { WorkspacePage } from "@/pages/WorkspacePage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { QueryPage } from "@/pages/QueryPage";
import { GraphExplorerPage } from "@/pages/GraphExplorerPage";
import { AdminPage } from "@/pages/AdminPage";
import { AppLayout } from "@/components/sidebar/AppLayout";

export function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
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
        <Route path="/" element={<DashboardPage />} />
        <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
        <Route path="/workspace/:workspaceId/documents" element={<DocumentsPage />} />
        <Route path="/workspace/:workspaceId/query" element={<QueryPage />} />
        <Route path="/workspace/:workspaceId/graph" element={<GraphExplorerPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
