import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/lib/api";
import { Loader2, Share2, RefreshCw } from "lucide-react";

interface GraphStats {
  total_nodes: number;
  total_edges: number;
  node_types: Array<{ node_type: string; count: string }>;
  subtype_distribution: Array<{ node_type: string; subtype: string; count: string }>;
}

export function GraphStatsCard({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const [reindexing, setReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState<{ reindexed_nodes: number } | null>(null);

  const handleReindex = async () => {
    setReindexing(true);
    setReindexResult(null);
    try {
      const result = await apiPost<{ reindexed_nodes: number; total_nodes: number }>(
        `/api/v1/workspaces/${workspaceId}/graph/reindex`, {}
      );
      setReindexResult(result);
      qc.invalidateQueries({ queryKey: ["graph-stats", workspaceId] });
    } catch {
      // Non-critical
    } finally {
      setReindexing(false);
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["graph-stats", workspaceId],
    queryFn: () => apiFetch<GraphStats>(
      `/api/v1/workspaces/${workspaceId}/graph/stats`
    ),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="bg-surface-primary border border-border-primary rounded-xl p-6">
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-text-tertiary" size={20} aria-hidden="true" />
          <span className="sr-only">Loading graph statistics</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface-primary border border-border-primary rounded-xl p-6">
        <p className="text-sm text-danger" role="alert">Failed to load graph statistics</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-surface-primary border border-border-primary rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2 text-text-primary">
          <Share2 size={18} className="text-primary-500" aria-hidden="true" />
          Knowledge Graph
        </h3>
        {/* FR-011/AC-04: Rebuild KG Index button */}
        <button
          type="button"
          onClick={handleReindex}
          disabled={reindexing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-300 rounded-lg hover-surface-brand-soft transition-colors disabled:opacity-50"
          aria-label="Rebuild knowledge graph index"
        >
          <RefreshCw size={12} className={reindexing ? "animate-spin" : ""} aria-hidden="true" />
          {reindexing ? "Reindexing..." : "Rebuild Index"}
        </button>
      </div>
      {reindexResult && (
        <p className="text-xs text-success">Reindexed {reindexResult.reindexed_nodes} node(s)</p>
      )}

      {/* Summary counters */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface-secondary rounded-lg p-3">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Nodes</span>
          <p className="text-2xl font-bold text-text-primary mt-0.5">{data.total_nodes.toLocaleString()}</p>
        </div>
        <div className="bg-surface-secondary rounded-lg p-3">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Edges</span>
          <p className="text-2xl font-bold text-text-primary mt-0.5">{data.total_edges.toLocaleString()}</p>
        </div>
      </div>

      {/* Node type distribution */}
      {data.node_types.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Type Distribution
          </h4>
          <div className="space-y-1.5">
            {data.node_types.map((nt) => {
              const count = parseInt(nt.count, 10);
              const pct = data.total_nodes > 0 ? (count / data.total_nodes) * 100 : 0;
              return (
                <div key={nt.node_type} className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary w-28 truncate capitalize" title={nt.node_type}>
                    {nt.node_type.replace(/_/g, " ")}
                  </span>
                  <div className="flex-1 h-2 bg-surface-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-text-tertiary w-12 text-right">
                    {count.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.total_nodes === 0 && data.total_edges === 0 && (
        <p className="text-sm text-text-tertiary text-center py-2">
          No graph data yet. Upload and process documents to build the knowledge graph.
        </p>
      )}
    </div>
  );
}
