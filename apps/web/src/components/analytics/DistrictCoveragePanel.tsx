import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FileText, Languages, ShieldCheck, Target } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface DistrictSummary {
  totals: {
    total_cases: number;
    criminal_targets: number;
    text_available: number;
    ocr_required: number;
    translated: number;
    redacted: number;
    rag_active: number;
    fetch_failed: number;
  };
  delay: {
    avg_days_registration_to_decision: number | null;
    p95_days_registration_to_decision: number | null;
  };
  last_refresh: { completed_at?: string; inserted_fact_rows?: number } | null;
}

interface CoverageResponse {
  coverage: Array<{
    state_code: number | null;
    state_name: string | null;
    district_code: number | null;
    district_name: string | null;
    court_level: string | null;
    language: string | null;
    source_name: string | null;
    total_cases: number;
    criminal_targets: number;
    text_available: number;
    translated: number;
    redacted: number;
    rag_active: number;
  }>;
}

function pct(value: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleString() : "Not refreshed";
}

function labelWithCode(name: string | null | undefined, code: number | null): string {
  if (code == null) return "-";
  return name ? `${name} (${code})` : String(code);
}

export function DistrictCoveragePanel({ workspaceId, queryString }: { workspaceId: string; queryString: string }) {
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useQuery({
    queryKey: ["district-analytics-summary", workspaceId, queryString],
    queryFn: () => apiFetch<DistrictSummary>(`/api/v1/workspaces/${workspaceId}/district/analytics/summary?${queryString}`),
    enabled: !!workspaceId,
  });
  const { data: coverage, isLoading: coverageLoading } = useQuery({
    queryKey: ["district-analytics-coverage", workspaceId, queryString],
    queryFn: () => apiFetch<CoverageResponse>(`/api/v1/workspaces/${workspaceId}/district/analytics/coverage?${queryString}`),
    enabled: !!workspaceId,
  });

  if (summaryLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(8)].map((_, index) => (
          <div key={index} className="bg-surface border border-skin rounded-lg p-4 animate-pulse">
            <div className="h-3 w-20 bg-surface-alt rounded mb-3" />
            <div className="h-7 w-14 bg-surface-alt rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (summaryError || !summary) {
    return (
      <div className="surface-danger-soft border border-danger-soft rounded-lg p-4 text-sm text-danger">
        Failed to load district analytics.
      </div>
    );
  }

  const total = summary.totals.total_cases;
  const kpis = [
    { label: "Metadata Cases", value: total, icon: FileText, tone: "text-primary-600" },
    { label: "Criminal Targets", value: summary.totals.criminal_targets, icon: Target, tone: "text-primary-700" },
    { label: "Text Available", value: summary.totals.text_available, suffix: pct(summary.totals.text_available, total), icon: CheckCircle2, tone: "text-success" },
    { label: "Translated", value: summary.totals.translated, suffix: pct(summary.totals.translated, total), icon: Languages, tone: "text-primary-600" },
    { label: "Redacted", value: summary.totals.redacted, suffix: pct(summary.totals.redacted, total), icon: ShieldCheck, tone: "text-success" },
    { label: "RAG Active", value: summary.totals.rag_active, suffix: pct(summary.totals.rag_active, total), icon: CheckCircle2, tone: "text-success" },
    { label: "OCR Required", value: summary.totals.ocr_required, suffix: pct(summary.totals.ocr_required, total), icon: FileText, tone: "text-warning" },
    { label: "Fetch Failed", value: summary.totals.fetch_failed, icon: AlertCircle, tone: "text-danger" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(({ label, value, suffix, icon: Icon, tone }) => (
          <div key={label} className="bg-surface border border-skin rounded-lg p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-skin-muted">
              <Icon size={14} className={tone} aria-hidden="true" />
              {label}
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-skin-base">{value}</span>
              {suffix && <span className="text-xs text-skin-muted">{suffix}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-4">
        <div className="bg-surface border border-skin rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-skin">
            <h3 className="text-sm font-semibold text-skin-base">Coverage By Source</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt text-xs text-skin-muted">
                <tr>
                  <th scope="col" className="text-left px-4 py-2 font-medium">State</th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">District</th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">Court</th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">Language</th>
                  <th scope="col" className="text-left px-4 py-2 font-medium">Source</th>
                  <th scope="col" className="text-right px-4 py-2 font-medium">Cases</th>
                  <th scope="col" className="text-right px-4 py-2 font-medium">Text</th>
                  <th scope="col" className="text-right px-4 py-2 font-medium">Translated</th>
                </tr>
              </thead>
              <tbody>
                {(coverage?.coverage || []).map((row, index) => (
                  <tr key={`${row.state_code}-${row.district_code}-${row.source_name}-${index}`} className="border-t border-skin">
                    <td className="px-4 py-2 text-skin-base">{labelWithCode(row.state_name, row.state_code)}</td>
                    <td className="px-4 py-2 text-skin-base">{labelWithCode(row.district_name, row.district_code)}</td>
                    <td className="px-4 py-2 text-skin-muted">{row.court_level || "-"}</td>
                    <td className="px-4 py-2 text-skin-muted">{row.language || "-"}</td>
                    <td className="px-4 py-2 text-skin-muted">{row.source_name || "-"}</td>
                    <td className="px-4 py-2 text-right text-skin-base">{row.total_cases}</td>
                    <td className="px-4 py-2 text-right text-skin-muted">{row.text_available}</td>
                    <td className="px-4 py-2 text-right text-skin-muted">{row.translated}</td>
                  </tr>
                ))}
                {!coverageLoading && (!coverage?.coverage || coverage.coverage.length === 0) && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-skin-muted">
                      No district metadata has been aggregated yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-surface border border-skin rounded-lg p-4">
          <h3 className="text-sm font-semibold text-skin-base">Refresh</h3>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-skin-muted">Last completed</dt>
              <dd className="text-skin-base">{formatDate(summary.last_refresh?.completed_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-skin-muted">Fact rows</dt>
              <dd className="text-skin-base">{summary.last_refresh?.inserted_fact_rows ?? 0}</dd>
            </div>
            <div>
              <dt className="text-xs text-skin-muted">Average delay</dt>
              <dd className="text-skin-base">{summary.delay.avg_days_registration_to_decision ?? "-"} days</dd>
            </div>
            <div>
              <dt className="text-xs text-skin-muted">P95 delay</dt>
              <dd className="text-skin-base">{summary.delay.p95_days_registration_to_decision ?? "-"} days</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
