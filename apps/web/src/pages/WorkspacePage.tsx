import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { apiFetch } from "@/lib/api";
import { FileText, Search, GitFork, BarChart3, Settings, Zap, Clock, MessageSquare } from "lucide-react";
import { WorkspaceSettings } from "@/components/admin/WorkspaceSettings";

export function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data: workspace, isLoading } = useWorkspace(workspaceId!);
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);

  // FR-012: KPI data for workspace overview
  const { data: kpi } = useQuery({
    queryKey: ["workspace-kpi", workspaceId],
    queryFn: () =>
      apiFetch<{
        cache: { hit_rate: number; total: number };
        latency: { avg_ms: number };
        period_days: number;
      }>(`/api/v1/workspaces/${workspaceId}/analytics?days=7`),
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  if (!workspace) {
    return <div className="text-center py-12 text-skin-muted">Workspace not found</div>;
  }

  const cards = [
    { icon: FileText, label: "Documents", description: "Upload and manage documents", count: workspace.document_count ?? 0, path: "documents" },
    { icon: Search, label: "Query", description: "Ask questions about your documents", count: null, path: "query" },
    { icon: GitFork, label: "Knowledge Graph", description: "Explore entities and relationships", count: null, path: "graph" },
    { icon: BarChart3, label: "Analytics", description: "Usage metrics and insights", count: null, path: "analytics" },
  ];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-skin-base">{workspace.name}</h2>
          {workspace.description && <p className="text-skin-muted mt-1">{workspace.description}</p>}
          <span className="inline-block mt-2 text-xs badge-success px-2 py-0.5 rounded font-medium">
            {workspace.status}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-lg border transition-colors ${
            showSettings ? "bg-primary-50 border-primary-200 text-primary-600" : "border-skin text-skin-muted hover:bg-surface-alt"
          }`}
        >
          <Settings size={18} />
        </button>
      </div>

      {showSettings && (
        <div className="mb-6 bg-surface border border-skin rounded-xl p-6">
          <h3 className="font-semibold text-lg mb-4">Knowledge Graph Ontology</h3>
          <p className="text-sm text-skin-muted mb-4">
            Configure the entity and relationship types the KG extractor will use for this workspace.
            Choose a domain preset or customize your own.
          </p>
          <WorkspaceSettings workspaceId={workspaceId!} />
        </div>
      )}

      {/* FR-012: KPI cards */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-surface border border-skin rounded-xl p-4">
            <div className="flex items-center gap-2 text-text-tertiary mb-1">
              <FileText size={14} aria-hidden="true" />
              <span className="text-xs font-medium">Documents</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">{workspace.document_count ?? 0}</p>
          </div>
          <div className="bg-surface border border-skin rounded-xl p-4">
            <div className="flex items-center gap-2 text-text-tertiary mb-1">
              <MessageSquare size={14} aria-hidden="true" />
              <span className="text-xs font-medium">Queries (7d)</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">{kpi.cache?.total ?? 0}</p>
          </div>
          <div className="bg-surface border border-skin rounded-xl p-4">
            <div className="flex items-center gap-2 text-text-tertiary mb-1">
              <Zap size={14} aria-hidden="true" />
              <span className="text-xs font-medium">Cache Hit Rate</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">
              {kpi.cache?.hit_rate ? `${(kpi.cache.hit_rate * 100).toFixed(0)}%` : "—"}
            </p>
          </div>
          <div className="bg-surface border border-skin rounded-xl p-4">
            <div className="flex items-center gap-2 text-text-tertiary mb-1">
              <Clock size={14} aria-hidden="true" />
              <span className="text-xs font-medium">Avg Latency</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">
              {kpi.latency?.avg_ms ? `${Math.round(kpi.latency.avg_ms)}ms` : "—"}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map(({ icon: Icon, label, description, count, path }) => (
          <button
            type="button"
            key={label}
            onClick={() => path && navigate(`/workspace/${workspaceId}/${path}`)}
            disabled={!path}
            className={`bg-surface border border-skin rounded-xl p-5 text-left transition-all ${
              path ? "hover:shadow-md hover:border-primary-200 cursor-pointer" : "opacity-60 cursor-not-allowed"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-surface-alt rounded-lg">
                <Icon size={20} className="text-skin-muted" />
              </div>
              <div>
                <h3 className="font-semibold text-skin-base">{label}</h3>
                <p className="text-sm text-skin-muted mt-0.5">{description}</p>
                {count !== null && <p className="text-sm text-skin-muted mt-2">{count} items</p>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
