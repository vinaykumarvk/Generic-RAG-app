import { useQuery } from "@tanstack/react-query";
import { Database, Gauge, ListChecks } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface SourcePerformance {
  period_days: number;
  sources: Array<{
    source_name: string | null;
    license_classification: string | null;
    commercial_safe: boolean;
    total_cases: number;
    text_available: number;
    translated: number;
    fetch_failed: number;
  }>;
  queue: Array<{ source_name: string; status: string; count: number }>;
  attempts: Array<{ source_name: string; outcome: string; count: number }>;
  quota: Array<{
    source_name: string;
    period_start: string;
    period_end: string;
    quota_units: number | null;
    used_units: number;
    cost_currency: string | null;
    estimated_cost: number | null;
  }>;
}

function groupCount<T extends { source_name: string | null; count: number }>(rows: T[], sourceName: string | null): number {
  return rows.filter((row) => row.source_name === sourceName).reduce((sum, row) => sum + Number(row.count), 0);
}

function hasActiveQueue(rows?: SourcePerformance["queue"]): boolean {
  return Boolean(rows?.some((row) => ["pending", "processing", "rate_limited"].includes(row.status)));
}

export function DistrictSourceDashboard({ workspaceId, queryString }: { workspaceId: string; queryString: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["district-source-performance", workspaceId, queryString],
    queryFn: () => apiFetch<SourcePerformance>(`/api/v1/workspaces/${workspaceId}/district/analytics/source-performance?${queryString}`),
    enabled: !!workspaceId,
    refetchInterval: (query) => {
      const payload = query.state.data as SourcePerformance | undefined;
      return hasActiveQueue(payload?.queue) ? 5000 : false;
    },
    refetchIntervalInBackground: true,
  });

  if (isLoading) {
    return <div className="bg-surface border border-skin rounded-lg h-72 animate-pulse" />;
  }

  if (error || !data) {
    return (
      <div className="surface-danger-soft border border-danger-soft rounded-lg p-4 text-sm text-danger">
        Failed to load source operations.
      </div>
    );
  }

  return (
    <section className="bg-surface border border-skin rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-skin flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={15} className="text-primary-600" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-skin-base">Source Operations</h3>
        </div>
        <span className="text-xs text-skin-muted">Last {data.period_days} days</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt text-xs text-skin-muted">
            <tr>
              <th scope="col" className="text-left px-4 py-2 font-medium">Source</th>
              <th scope="col" className="text-left px-4 py-2 font-medium">License</th>
              <th scope="col" className="text-right px-4 py-2 font-medium">Cases</th>
              <th scope="col" className="text-right px-4 py-2 font-medium">Text</th>
              <th scope="col" className="text-right px-4 py-2 font-medium">Translated</th>
              <th scope="col" className="text-right px-4 py-2 font-medium">Queue</th>
              <th scope="col" className="text-right px-4 py-2 font-medium">Attempts</th>
              <th scope="col" className="text-right px-4 py-2 font-medium">Failures</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((source, index) => {
              const queueCount = groupCount(data.queue, source.source_name);
              const attemptCount = groupCount(data.attempts, source.source_name);
              return (
                <tr key={`${source.source_name}-${index}`} className="border-t border-skin">
                  <td className="px-4 py-2 text-skin-base">{source.source_name || "unknown"}</td>
                  <td className="px-4 py-2 text-skin-muted">{source.license_classification || "unknown"}</td>
                  <td className="px-4 py-2 text-right text-skin-base">{source.total_cases}</td>
                  <td className="px-4 py-2 text-right text-skin-muted">{source.text_available}</td>
                  <td className="px-4 py-2 text-right text-skin-muted">{source.translated}</td>
                  <td className="px-4 py-2 text-right text-skin-muted">{queueCount}</td>
                  <td className="px-4 py-2 text-right text-skin-muted">{attemptCount}</td>
                  <td className="px-4 py-2 text-right text-danger">{source.fetch_failed}</td>
                </tr>
              );
            })}
            {data.sources.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-skin-muted">
                  No source aggregate data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.quota.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 border-t border-skin">
          {data.quota.slice(0, 4).map((row) => (
            <div key={`${row.source_name}-${row.period_start}`} className="border border-skin rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-skin-base">
                <Gauge size={13} className="text-primary-600" aria-hidden="true" />
                {row.source_name}
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-skin-muted">
                <span>{Number(row.used_units || 0)} used</span>
                {row.quota_units != null && <span>{Number(row.quota_units)} quota</span>}
                {row.estimated_cost != null && <span>{row.cost_currency || ""} {Number(row.estimated_cost).toFixed(2)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {data.queue.length > 0 && (
        <div className="p-4 border-t border-skin">
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-skin-base">
            <ListChecks size={13} className="text-primary-600" aria-hidden="true" />
            Queue Status
          </div>
          <div className="flex flex-wrap gap-2">
            {data.queue.map((row) => (
              <span key={`${row.source_name}-${row.status}`} className="px-2 py-1 rounded bg-surface-alt text-xs text-skin-muted">
                {row.source_name}: {row.status} {row.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
