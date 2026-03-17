import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspace } from "@/hooks/useWorkspaces";
import { FileText, Search, GitFork, BarChart3, Settings } from "lucide-react";
import { WorkspaceSettings } from "@/components/admin/WorkspaceSettings";

export function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { data: workspace, isLoading } = useWorkspace(workspaceId!);
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  if (!workspace) {
    return <div className="text-center py-12 text-gray-500">Workspace not found</div>;
  }

  const cards = [
    { icon: FileText, label: "Documents", description: "Upload and manage documents", count: workspace.document_count ?? 0, path: "documents" },
    { icon: Search, label: "Query", description: "Ask questions about your documents", count: null, path: "query" },
    { icon: GitFork, label: "Knowledge Graph", description: "Explore entities and relationships", count: null, path: "graph" },
    { icon: BarChart3, label: "Analytics", description: "Usage metrics and insights", count: null, path: null },
  ];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{workspace.name}</h2>
          {workspace.description && <p className="text-gray-500 mt-1">{workspace.description}</p>}
          <span className="inline-block mt-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">
            {workspace.status}
          </span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-lg border transition-colors ${
            showSettings ? "bg-primary-50 border-primary-200 text-primary-600" : "border-gray-200 text-gray-500 hover:bg-gray-50"
          }`}
        >
          <Settings size={18} />
        </button>
      </div>

      {showSettings && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-6">
          <h3 className="font-semibold text-lg mb-4">Knowledge Graph Ontology</h3>
          <p className="text-sm text-gray-500 mb-4">
            Configure the entity and relationship types the KG extractor will use for this workspace.
            Choose a domain preset or customize your own.
          </p>
          <WorkspaceSettings workspaceId={workspaceId!} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map(({ icon: Icon, label, description, count, path }) => (
          <button
            key={label}
            onClick={() => path && navigate(`/workspace/${workspaceId}/${path}`)}
            disabled={!path}
            className={`bg-white border border-gray-200 rounded-xl p-5 text-left transition-all ${
              path ? "hover:shadow-md hover:border-primary-200 cursor-pointer" : "opacity-60 cursor-not-allowed"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-gray-50 rounded-lg">
                <Icon size={20} className="text-gray-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">{label}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{description}</p>
                {count !== null && <p className="text-sm text-gray-400 mt-2">{count} items</p>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
