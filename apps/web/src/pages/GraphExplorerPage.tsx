import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { NodeDetailPanel } from "@/components/graph/NodeDetailPanel";
import { GraphFilters } from "@/components/graph/GraphFilters";
import { GitFork, Loader2, Search } from "lucide-react";

interface GraphStats {
  total_nodes: number;
  total_edges: number;
  node_types: Array<{ node_type: string; count: number }>;
}

export function GraphExplorerPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [hops, setHops] = useState(1);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["graph-stats", workspaceId],
    queryFn: () => apiFetch<GraphStats>(`/api/v1/workspaces/${workspaceId}/graph/stats`),
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-skin-muted" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-skin-base flex items-center gap-2">
            <GitFork size={24} />
            Knowledge Graph
          </h2>
          <p className="text-skin-muted text-sm mt-1">
            {stats?.total_nodes || 0} nodes, {stats?.total_edges || 0} edges
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* FR-012: Node search input */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-skin-muted" aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search nodes..."
              className="pl-8 pr-3 py-1.5 text-xs border border-skin rounded-lg bg-surface text-skin-base focus:ring-1 focus:ring-primary-500 outline-none w-48"
            />
          </div>
          {/* FR-012: Depth selector */}
          <select
            value={hops}
            onChange={(e) => setHops(parseInt(e.target.value, 10))}
            className="text-xs px-2 py-1.5 border border-skin rounded-lg bg-surface text-skin-base"
            aria-label="Exploration depth"
          >
            <option value={1}>1 hop</option>
            <option value={2}>2 hops</option>
            <option value={3}>3 hops</option>
          </select>
          <GraphFilters
            nodeTypes={stats?.node_types || []}
            selectedType={typeFilter}
            onTypeChange={setTypeFilter}
          />
        </div>
      </div>

      <div className="flex gap-4 h-[calc(100dvh-14rem)]">
        <div className="flex-1 bg-surface border border-skin rounded-xl overflow-hidden">
          {stats && stats.total_nodes > 0 ? (
            <GraphCanvas
              workspaceId={workspaceId!}
              typeFilter={typeFilter}
              onNodeSelect={setSelectedNodeId}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-skin-muted">
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
