import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Database } from "lucide-react";

interface CacheStatsResponse {
  total_entries: number;
  most_hit_queries: Array<{ query_text: string; hit_count: number }>;
}

export function CacheStatsCard({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cache-stats", workspaceId],
    queryFn: () =>
      apiFetch<CacheStatsResponse>(
        `/api/v1/workspaces/${workspaceId}/analytics/cache-stats`
      ),
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return (
      <div className="bg-surface border border-skin rounded-xl p-5 animate-pulse">
        <div className="h-4 bg-surface-alt rounded w-32 mb-3" />
        <div className="h-6 bg-surface-alt rounded w-16 mb-4" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-4 bg-surface-alt rounded w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="bg-surface border border-skin rounded-xl p-5">
        <p className="text-sm text-skin-muted">Failed to load cache statistics.</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-surface border border-skin rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Database size={16} className="text-success" aria-hidden="true" />
        <h3 className="font-semibold text-skin-base">Cache Statistics</h3>
      </div>

      <p className="text-2xl font-bold text-skin-base mb-4">
        {data.total_entries}
        <span className="text-sm font-normal text-skin-muted ml-2">cached entries</span>
      </p>

      {data.most_hit_queries.length > 0 ? (
        <div>
          <h4 className="text-xs font-medium text-skin-muted uppercase tracking-wider mb-2">
            Most-Hit Queries
          </h4>
          <div className="space-y-2">
            {data.most_hit_queries.map((q, i) => (
              <div key={i} className="flex items-center justify-between text-sm gap-3">
                <span className="truncate flex-1 text-skin-base">{q.query_text}</span>
                <span className="text-skin-muted shrink-0">{q.hit_count} hits</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-skin-muted">No cached queries yet.</p>
      )}
    </div>
  );
}
