import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Download, Calendar } from "lucide-react";

interface VolumeData {
  day: string;
  upload_count: number;
  total_bytes: number;
}

interface LegacyVolumeData {
  day: string;
  doc_count: number;
  total_bytes: number;
}

interface IngestionVolumeResponse {
  period_days?: number;
  data?: VolumeData[];
  volume?: LegacyVolumeData[] | VolumeData[];
}

export function IngestionVolumeChart({ workspaceId }: { workspaceId: string }) {
  const [days, setDays] = useState(30);

  const { data, isLoading, error } = useQuery({
    queryKey: ["ingestion-volume", workspaceId, days],
    queryFn: () =>
      apiFetch<IngestionVolumeResponse>(
        `/api/v1/workspaces/${workspaceId}/admin/ingestion-volume?days=${days}`
      ),
    enabled: !!workspaceId,
  });

  const handleExportCsv = () => {
    const rows = getVolumeRows(data);
    if (rows.length === 0) return;
    const headers = "Date,Uploads,Bytes\n";
    const csvRows = rows.map((d) => `${d.day},${d.upload_count},${d.total_bytes}`).join("\n");
    const blob = new Blob([headers + csvRows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ingestion-volume-${workspaceId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="bg-surface-primary border border-border-primary rounded-xl p-6 animate-pulse">
        <div className="h-4 bg-surface-secondary rounded w-40 mb-4" />
        <div className="h-48 bg-surface-secondary rounded" />
      </div>
    );
  }

  const rows = getVolumeRows(data);

  if (error || rows.length === 0) {
    return (
      <div className="bg-surface-primary border border-border-primary rounded-xl p-6">
        <p className="text-sm text-text-tertiary">Ingestion volume data unavailable</p>
      </div>
    );
  }

  const chartData = rows.map((d) => ({
    date: new Date(d.day).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    uploads: d.upload_count,
    sizeMB: Math.round(d.total_bytes / 1024 / 1024),
  }));

  return (
    <div className="bg-surface-primary border border-border-primary rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-text-primary">Ingestion Volume</h3>
        <div className="flex items-center gap-2">
          {/* Date range picker (FR-024/AC-03) */}
          <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-0.5">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === d
                    ? "bg-brand text-on-brand"
                    : "text-text-secondary hover:bg-surface-primary"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          {/* CSV export (FR-025/AC-05) */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-text-secondary border border-border-primary rounded-lg hover:bg-surface-secondary transition-colors"
            aria-label="Export CSV"
          >
            <Download size={12} aria-hidden="true" />
            CSV
          </button>
        </div>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-border))" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              stroke="rgb(var(--color-text-tertiary))"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              stroke="rgb(var(--color-text-tertiary))"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(var(--color-surface-primary))",
                border: "1px solid rgb(var(--color-border))",
                borderRadius: "0.5rem",
                fontSize: "0.75rem",
              }}
            />
            <Bar dataKey="uploads" fill="rgb(var(--color-primary-500))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function getVolumeRows(data: IngestionVolumeResponse | undefined): VolumeData[] {
  if (data?.data?.length) {
    return data.data;
  }

  if (!data?.volume?.length) {
    return [];
  }

  return data.volume.map((row) => ({
    day: row.day,
    upload_count: "upload_count" in row ? row.upload_count : row.doc_count,
    total_bytes: row.total_bytes,
  }));
}
