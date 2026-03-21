import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Download } from "lucide-react";

interface QueryVolumeData {
  day: string;
  count: number;
}

interface QueryVolumeResponse {
  period_days: number;
  data: QueryVolumeData[];
}

const DAY_OPTIONS = [7, 30, 90] as const;
const SVG_HEIGHT = 132;
const PLOT_HEIGHT = 92;
const BASELINE_Y = 108;
const LABEL_Y = 124;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function exportCsv(data: QueryVolumeData[], workspaceId: string) {
  const headers = "Date,Query Count\n";
  const rows = data.map((d) => `${d.day},${d.count}`).join("\n");
  const blob = new Blob([headers + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `query-volume-${workspaceId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function QueryVolumeChart({ workspaceId }: { workspaceId: string }) {
  const [days, setDays] = useState<number>(30);

  const { data, isLoading, error } = useQuery({
    queryKey: ["query-volume", workspaceId, days],
    queryFn: () =>
      apiFetch<QueryVolumeResponse>(
        `/api/v1/workspaces/${workspaceId}/analytics/query-volume?days=${days}`
      ),
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return (
      <div className="bg-surface border border-skin rounded-xl p-6 animate-pulse">
        <div className="h-4 bg-surface-alt rounded w-40 mb-4" />
        <div className="h-36 bg-surface-alt rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="bg-surface border border-skin rounded-xl p-6">
        <p className="text-sm text-skin-muted">Failed to load query volume data.</p>
      </div>
    );
  }

  const rows = data?.data ?? [];

  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-skin rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-skin-base">Query Volume</h3>
          <DayToggle days={days} onChange={setDays} />
        </div>
        <p className="text-sm text-skin-muted py-8 text-center">No query data for this period.</p>
      </div>
    );
  }

  const maxCount = Math.max(...rows.map((r) => Number(r.count)));

  return (
    <div className="bg-surface border border-skin rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-skin-base">Query Volume</h3>
        <div className="flex items-center gap-2">
          <DayToggle days={days} onChange={setDays} />
          <button
            type="button"
            onClick={() => exportCsv(rows, workspaceId)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-skin-muted border border-skin rounded-lg hover:bg-surface-alt transition-colors"
            aria-label="Export query volume as CSV"
          >
            <Download size={12} aria-hidden="true" />
            CSV
          </button>
        </div>
      </div>

      {/* SVG Bar Chart */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${Math.max(rows.length * 28, 200)} ${SVG_HEIGHT}`}
          className="w-full"
          style={{ minWidth: `${Math.max(rows.length * 28, 200)}px` }}
          role="img"
          aria-label={`Bar chart showing daily query volume for the last ${days} days`}
        >
          {/* Y-axis gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const y = BASELINE_Y - frac * PLOT_HEIGHT;
            const label = Math.round(frac * maxCount);
            return (
              <g key={frac}>
                <line
                  x1="0"
                  y1={y}
                  x2={rows.length * 28}
                  y2={y}
                  stroke="rgb(var(--color-border))"
                  strokeWidth="0.5"
                  strokeDasharray="4 2"
                />
                {frac > 0 && (
                  <text
                    x="2"
                    y={y - 2}
                    fontSize="8"
                    fill="rgb(var(--color-text-secondary))"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Bars */}
          {rows.map((row, i) => {
            const count = Number(row.count);
            const barHeight = maxCount > 0 ? (count / maxCount) * PLOT_HEIGHT : 0;
            const x = i * 28 + 4;
            const barY = BASELINE_Y - barHeight;

            return (
              <g key={row.day}>
                <rect
                  x={x}
                  y={barY}
                  width="20"
                  height={Math.max(barHeight, 1)}
                  rx="3"
                  fill="rgb(var(--color-primary-500))"
                  opacity="0.85"
                >
                  <title>{`${formatDate(row.day)}: ${count} queries`}</title>
                </rect>
                {/* X-axis label: show every Nth label to avoid crowding */}
                {(rows.length <= 14 || i % Math.ceil(rows.length / 14) === 0) && (
                  <text
                    x={x + 10}
                    y={LABEL_Y}
                    textAnchor="middle"
                    fontSize="7"
                    fill="rgb(var(--color-text-secondary))"
                  >
                    {formatDate(row.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function DayToggle({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="flex items-center gap-1 bg-surface-alt rounded-lg p-0.5" role="group" aria-label="Time range">
      {DAY_OPTIONS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={days === d}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
            days === d
              ? "bg-brand text-on-brand"
              : "text-skin-muted hover:bg-surface"
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}
