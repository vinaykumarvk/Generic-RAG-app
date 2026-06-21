import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "@/lib/api";

interface OutcomesResponse {
  outcomes: Array<{
    disposition: string;
    total_cases: number;
    criminal_targets: number;
    text_available: number;
    avg_delay_days: number | null;
  }>;
}

export function DistrictOutcomeChart({ workspaceId, queryString }: { workspaceId: string; queryString: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["district-analytics-outcomes", workspaceId, queryString],
    queryFn: () => apiFetch<OutcomesResponse>(`/api/v1/workspaces/${workspaceId}/district/analytics/outcomes?${queryString}`),
    enabled: !!workspaceId,
  });

  const rows = data?.outcomes || [];

  return (
    <section className="bg-surface border border-skin rounded-lg p-4">
      <h3 className="text-sm font-semibold text-skin-base mb-4">Outcomes</h3>
      {isLoading && <div className="h-72 bg-surface-alt rounded animate-pulse" />}
      {error && <div className="h-72 flex items-center justify-center text-sm text-danger">Failed to load outcomes.</div>}
      {!isLoading && !error && rows.length === 0 && (
        <div className="h-72 flex items-center justify-center text-sm text-skin-muted">No outcome data.</div>
      )}
      {!isLoading && !error && rows.length > 0 && (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows.slice(0, 12)} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-border))" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="disposition" type="category" width={96} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total_cases" name="Cases" fill="rgb(var(--color-primary-500))" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
