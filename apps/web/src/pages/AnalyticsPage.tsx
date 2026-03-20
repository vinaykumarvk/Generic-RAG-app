import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DocumentAnalytics } from "@/components/analytics/DocumentAnalytics";
import { IngestionVolumeChart } from "@/components/analytics/IngestionVolumeChart";
import { QueryVolumeChart } from "@/components/analytics/QueryVolumeChart";
import { CacheStatsCard } from "@/components/analytics/CacheStatsCard";
import { UserAnalyticsPanel } from "@/components/analytics/UserAnalyticsPanel";
import { QAHistoryPanel } from "@/components/analytics/QAHistoryPanel";
import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard";
import { apiFetch } from "@/lib/api";
import { Download, Calendar } from "lucide-react";

/** Shape of the main analytics response (used for CSV export) */
interface AnalyticsData {
  period_days: number;
  queries_per_day: Array<{ day: string; count: number }>;
  latency: { avg_ms: number; p95_ms: number };
  cache: { hit_rate: number; hits: number; total: number };
  feedback: { avg_rating: number; total: number; thumbs_up: number; thumbs_down: number };
  top_questions: Array<{ original_query: string; count: number }>;
  llm_usage: Array<{ provider: string; model_name: string; calls: number; avg_latency: number }>;
  document_stats: Array<{ status: string; count: number }>;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, Math.min(90, Math.round((e.getTime() - s.getTime()) / 86400000)));
}

function buildCsvContent(data: AnalyticsData): string {
  const lines: string[] = [];

  // Summary
  lines.push("Section,Metric,Value");
  lines.push(`Summary,Period (days),${data.period_days}`);
  lines.push(`Summary,Avg Latency (ms),${data.latency.avg_ms}`);
  lines.push(`Summary,P95 Latency (ms),${data.latency.p95_ms}`);
  lines.push(`Summary,Cache Hit Rate,${(data.cache.hit_rate * 100).toFixed(1)}%`);
  lines.push(`Summary,Cache Hits,${data.cache.hits}`);
  lines.push(`Summary,Total Queries,${data.cache.total}`);
  lines.push(`Summary,Thumbs Up,${data.feedback.thumbs_up}`);
  lines.push(`Summary,Thumbs Down,${data.feedback.thumbs_down}`);
  lines.push("");

  // Queries per day
  lines.push("Date,Query Count");
  for (const row of data.queries_per_day) {
    lines.push(`${row.day},${row.count}`);
  }
  lines.push("");

  // Top questions
  lines.push("Top Question,Count");
  for (const row of data.top_questions) {
    // Escape commas/quotes in query text
    const escaped = row.original_query.includes(",") || row.original_query.includes('"')
      ? `"${row.original_query.replace(/"/g, '""')}"`
      : row.original_query;
    lines.push(`${escaped},${row.count}`);
  }
  lines.push("");

  // LLM usage
  lines.push("Provider,Model,Calls,Avg Latency (ms)");
  for (const row of data.llm_usage) {
    lines.push(`${row.provider},${row.model_name},${row.calls},${Math.round(row.avg_latency)}`);
  }
  lines.push("");

  // Document stats
  lines.push("Document Status,Count");
  for (const row of data.document_stats) {
    lines.push(`${row.status},${row.count}`);
  }

  return lines.join("\n");
}

export function AnalyticsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [startDate, setStartDate] = useState(daysAgoStr(30));
  const [endDate, setEndDate] = useState(todayStr());

  const computedDays = daysBetween(startDate, endDate);

  // Fetch analytics data with date range for CSV export
  const { data: analyticsData } = useQuery({
    queryKey: ["analytics-export", workspaceId, computedDays],
    queryFn: () =>
      apiFetch<AnalyticsData>(
        `/api/v1/workspaces/${workspaceId}/analytics?days=${computedDays}`
      ),
    enabled: !!workspaceId,
  });

  const handleExportCsv = useCallback(() => {
    if (!analyticsData) return;
    const csv = buildCsvContent(analyticsData);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${workspaceId}-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [analyticsData, workspaceId, startDate, endDate]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-skin-base">Analytics</h2>
          <p className="text-skin-muted text-sm mt-1">Document metrics and query insights</p>
        </div>

        {/* Gap #57: Date range picker + CSV export */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-skin-muted" aria-hidden="true" />
            <label htmlFor="analytics-start" className="sr-only">Start date</label>
            <input
              id="analytics-start"
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2 py-1 text-xs border border-skin rounded-lg bg-surface text-skin-base focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <span className="text-xs text-skin-muted">to</span>
            <label htmlFor="analytics-end" className="sr-only">End date</label>
            <input
              id="analytics-end"
              type="date"
              value={endDate}
              min={startDate}
              max={todayStr()}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2 py-1 text-xs border border-skin rounded-lg bg-surface text-skin-base focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!analyticsData}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-skin rounded-lg text-skin-muted hover:bg-surface-alt transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Export all analytics data as CSV"
          >
            <Download size={13} aria-hidden="true" />
            Export CSV
          </button>
        </div>
      </div>

      <DocumentAnalytics workspaceId={workspaceId!} />
      <QueryVolumeChart workspaceId={workspaceId!} />
      <IngestionVolumeChart workspaceId={workspaceId!} />

      {/* Cache + User analytics side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CacheStatsCard workspaceId={workspaceId!} />
        <UserAnalyticsPanel workspaceId={workspaceId!} />
      </div>

      {/* FR-020/AC-05: Q&A History tab */}
      <QAHistoryPanel workspaceId={workspaceId!} />

      <AnalyticsDashboard workspaceId={workspaceId!} />
    </div>
  );
}
