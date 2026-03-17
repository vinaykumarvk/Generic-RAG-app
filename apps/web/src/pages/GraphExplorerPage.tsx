import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { NodeDetailPanel } from "@/components/graph/NodeDetailPanel";
import { GraphFilters } from "@/components/graph/GraphFilters";
import { GitFork, Loader2 } from "lucide-react";

interface GraphStats {
  total_nodes: number;
  total_edges: number;
  node_types: Array<{ node_type: string; count: number }>;
}

export function GraphExplorerPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["graph-stats", workspaceId],
    queryFn: () => apiFetch<GraphStats>(`/api/v1/workspaces/${workspaceId}/graph/stats`),
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <GitFork size={24} />
            Knowledge Graph
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            {stats?.total_nodes || 0} nodes, {stats?.total_edges || 0} edges
          </p>
        </div>
        <GraphFilters
          nodeTypes={stats?.node_types || []}
          selectedType={typeFilter}
          onTypeChange={setTypeFilter}
        />
      </div>

      <div className="flex gap-4 h-[calc(100vh-14rem)]">
        <div className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden">
          {stats && stats.total_nodes > 0 ? (
            <GraphCanvas
              workspaceId={workspaceId!}
              typeFilter={typeFilter}
              onNodeSelect={setSelectedNodeId}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <GitFork size={48} className="mx-auto mb-4" />
                <p>No knowledge graph data yet.</p>
                <p className="text-sm mt-1">Upload documents and wait for KG extraction to complete.</p>
              </div>
            </div>
          )}
        </div>

        {selectedNodeId && (
          <NodeDetailPanel
            workspaceId={workspaceId!}
            nodeId={selectedNodeId}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}
