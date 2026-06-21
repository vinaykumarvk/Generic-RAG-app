import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "@/lib/api";

interface VolumeResponse {
  bucket: string;
  volume: Array<{
    bucket: string;
    state_code: number | null;
    district_code: number | null;
    total_cases: number;
    criminal_targets: number;
    text_available: number;
  }>;
}

export function DistrictCaseVolumeChart({ workspaceId, queryString }: { workspaceId: string; queryString: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["district-analytics-volume", workspaceId, queryString],
    queryFn: () => apiFetch<VolumeResponse>(`/api/v1/workspaces/${workspaceId}/district/analytics/volume?${queryString}`),
    enabled: !!workspaceId,
  });

  const chartData = (data?.volume || []).map((row) => ({
    ...row,
    label: String(row.bucket).slice(0, 10),
  }));

  return (
    <section className="bg-surface border border-skin rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-skin-base">Case Volume</h3>
        <span className="text-xs text-skin-muted">{data?.bucket || "month"}</span>
      </div>
      {isLoading && <div className="h-72 bg-surface-alt rounded animate-pulse" />}
      {error && <div className="h-72 flex items-center justify-center text-sm text-danger">Failed to load volume.</div>}
      {!isLoading && !error && chartData.length === 0 && (
        <div className="h-72 flex items-center justify-center text-sm text-skin-muted">No aggregate volume data.</div>
      )}
      {!isLoading && !error && chartData.length > 0 && (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-border))" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total_cases" name="Cases" fill="rgb(var(--color-primary-500))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="text_available" name="Text" fill="rgb(var(--color-success))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
