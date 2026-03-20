import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { FileText, CheckCircle, Loader2, AlertCircle } from "lucide-react";

interface Analytics {
  document_stats: Array<{ status: string; count: number }>;
  file_type_stats: Array<{ mime_type: string; count: number }>;
}

const PROCESSING_STATUSES = new Set([
  "UPLOADED",
  "VALIDATING",
  "NORMALIZING",
  "CONVERTING",
  "METADATA_EXTRACTING",
  "CHUNKING",
  "CHUNKED",
  "EMBEDDING",
  "REPROCESSING",
  "KG_EXTRACTING",
  "SEARCHABLE",
]);

const STATUS_SWATCHES: Record<string, string> = {
  UPLOADED: "rgb(var(--color-text-secondary))",
  VALIDATING: "rgb(var(--color-primary-400))",
  NORMALIZING: "rgb(var(--color-primary-500))",
  CONVERTING: "rgb(var(--color-primary-500))",
  METADATA_EXTRACTING: "rgb(var(--color-primary-600))",
  CHUNKING: "rgb(var(--color-primary-600))",
  CHUNKED: "rgb(var(--color-primary-700))",
  EMBEDDING: "rgb(var(--color-primary-700))",
  SEARCHABLE: "rgb(var(--color-success))",
  KG_EXTRACTING: "rgb(var(--color-primary-800))",
  REPROCESSING: "rgb(var(--color-warning))",
  ACTIVE: "rgb(var(--color-success))",
  FAILED: "rgb(var(--color-danger))",
};

function mimeLabel(mime: string): string {
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word") || mime.includes("docx")) return "DOCX";
  if (mime.includes("plain")) return "TXT";
  if (mime.includes("html")) return "HTML";
  if (mime.includes("csv")) return "CSV";
  if (mime.includes("json")) return "JSON";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "XLSX";
  return mime.split("/").pop()?.toUpperCase() || mime;
}

export function DocumentAnalytics({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", workspaceId],
    queryFn: () => apiFetch<Analytics>(`/api/v1/workspaces/${workspaceId}/analytics`),
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-surface border border-skin rounded-xl p-4 animate-pulse">
            <div className="h-4 bg-surface-alt rounded w-24 mb-3" />
            <div className="h-8 bg-surface-alt rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="surface-danger-soft border border-danger-soft rounded-xl p-4 text-danger text-sm">
        Failed to load analytics data.
      </div>
    );
  }

  if (!data) return null;

  const stats = data.document_stats;
  const totalDocs = stats.reduce((sum, s) => sum + Number(s.count), 0);
  const activeDocs = Number(stats.find((s) => s.status === "ACTIVE")?.count || 0);
  const failedDocs = Number(stats.find((s) => s.status === "FAILED")?.count || 0);
  const processingDocs = stats
    .filter((s) => PROCESSING_STATUSES.has(s.status))
    .reduce((sum, s) => sum + Number(s.count), 0);

  const kpis = [
    { label: "Total Documents", value: totalDocs, icon: FileText, color: "text-primary-600" },
    { label: "Active", value: activeDocs, icon: CheckCircle, color: "text-success" },
    { label: "Processing", value: processingDocs, icon: Loader2, color: "text-warning" },
    { label: "Failed", value: failedDocs, icon: AlertCircle, color: "text-danger" },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-surface border border-skin rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={16} className={color} />
              <span className="text-xs text-skin-muted font-medium">{label}</span>
            </div>
            <p className="text-2xl font-bold text-skin-base">{value}</p>
          </div>
        ))}
      </div>

      {/* Status breakdown bars */}
      {stats.length > 0 && (
        <div className="bg-surface border border-skin rounded-xl p-5">
          <h3 className="font-semibold text-skin-base mb-4">Status Breakdown</h3>
          <div className="space-y-3">
            {stats
              .sort((a, b) => Number(b.count) - Number(a.count))
              .map(({ status, count }) => {
                const pct = totalDocs > 0 ? (Number(count) / totalDocs) * 100 : 0;
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className="w-28 text-xs font-medium text-skin-muted shrink-0">{status}</span>
                    <div className="flex-1 bg-surface-alt rounded-full h-2.5 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(pct, 1)}%`,
                          backgroundColor: STATUS_SWATCHES[status] || "rgb(var(--color-text-secondary))",
                        }}
                      />
                    </div>
                    <span className="w-16 text-xs text-skin-muted text-right">
                      {count} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* File type distribution */}
      {data.file_type_stats && data.file_type_stats.length > 0 && (
        <div className="bg-surface border border-skin rounded-xl p-5">
          <h3 className="font-semibold text-skin-base mb-4">File Types</h3>
          <div className="space-y-3">
            {data.file_type_stats.map(({ mime_type, count }) => {
              const pct = totalDocs > 0 ? (Number(count) / totalDocs) * 100 : 0;
              return (
                <div key={mime_type} className="flex items-center gap-3">
                  <span className="w-20 text-xs font-medium text-skin-muted shrink-0">{mimeLabel(mime_type)}</span>
                  <div className="flex-1 bg-surface-alt rounded-full h-2.5 overflow-hidden">
                    <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.max(pct, 1)}%` }} />
                  </div>
                  <span className="w-16 text-xs text-skin-muted text-right">
                    {count} ({pct.toFixed(0)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
