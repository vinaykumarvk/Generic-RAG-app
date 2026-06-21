import { Fragment, FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileText, RefreshCw, Search } from "lucide-react";
import { apiFetch, apiPost } from "@/lib/api";

interface DistrictCaseSummary {
  district_case_id: string;
  cnr: string | null;
  source_case_id: string;
  source_name: string;
  metadata_source: string;
  dataset_version: string;
  state_code: number | null;
  state_name: string | null;
  district_code: number | null;
  district_name: string | null;
  court_no: number | null;
  court_code: string | null;
  court_name: string | null;
  court_level: string | null;
  case_type: string | null;
  filing_date: string | null;
  registration_date: string | null;
  decision_date: string | null;
  disposition: string | null;
  purpose_name: string | null;
  judge_position: string | null;
  acts_cited: string[];
  sections_cited: string[];
  offence_categories: string[];
  is_criminal_target: boolean;
  text_status: string;
  commercial_safe: boolean;
  license_classification: string;
  sensitive_data_flags: string[];
  created_at: string;
  updated_at: string;
}

interface CasesResponse {
  cases: DistrictCaseSummary[];
  total: number;
  limit: number;
  offset: number;
}

interface DistrictCaseDetailResponse {
  case: DistrictCaseSummary & {
    source_confidence: number;
    bailable: boolean | null;
    under_trial: boolean | null;
    source_payload: Record<string, unknown>;
  };
  sources: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  artifacts: DistrictTextArtifact[];
  acquisition_queue: DistrictAcquisitionQueueRow[];
  fetch_attempts: DistrictFetchAttempt[];
}

interface DistrictTextArtifact {
  district_text_artifact_id: string;
  artifact_type: string;
  source_name: string;
  source_url: string | null;
  document_id: string | null;
  license_classification: string;
  commercial_safe: boolean;
  redaction_status: string;
  translation_status: string;
  created_at: string;
}

interface DistrictAcquisitionQueueRow {
  district_acquisition_queue_id: string;
  source_name: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  error_message: string | null;
  result_metadata?: Record<string, unknown> | null;
  next_attempt_at?: string | null;
  created_at?: string;
  updated_at: string;
}

interface DistrictFetchAttempt {
  district_fetch_attempt_id: string;
  source_name: string;
  outcome: string;
  notes: string | null;
  attempted_at: string;
}

interface FetchJudgmentResponse {
  action: string;
  already_available: boolean;
  queued: boolean;
  document_id: string | null;
  artifact_id: string | null;
  text_status?: string;
  planned_sources?: string[];
  artifacts: DistrictTextArtifact[];
  acquisition_queue: DistrictAcquisitionQueueRow[];
  fetch_attempts: DistrictFetchAttempt[];
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function placeLabel(row: DistrictCaseSummary): string {
  const state = row.state_name ? `${row.state_name} (${row.state_code ?? "-"})` : row.state_code != null ? `State ${row.state_code}` : "-";
  const district = row.district_name ? `${row.district_name} (${row.district_code ?? "-"})` : row.district_code != null ? `District ${row.district_code}` : "-";
  return `${district}, ${state}`;
}

function hasActiveQueue(queue?: DistrictAcquisitionQueueRow[]): boolean {
  return Boolean(queue?.some((row) => ["pending", "processing", "rate_limited"].includes(row.status)));
}

function valueList(values?: string[]): string {
  return values?.length ? values.join(", ") : "-";
}

function metadataRows(row: DistrictCaseDetailResponse["case"]) {
  return [
    ["District case ID", row.district_case_id],
    ["CNR", row.cnr || "-"],
    ["Source case ID", row.source_case_id],
    ["Source", row.source_name],
    ["Dataset version", row.dataset_version],
    ["State", row.state_name ? `${row.state_name} (${row.state_code ?? "-"})` : row.state_code ?? "-"],
    ["District", row.district_name ? `${row.district_name} (${row.district_code ?? "-"})` : row.district_code ?? "-"],
    ["Court", row.court_name || row.court_code || "-"],
    ["Court level", row.court_level || "-"],
    ["Court number", row.court_no ?? "-"],
    ["Case type", row.case_type || "-"],
    ["Filing date", formatDate(row.filing_date)],
    ["Registration date", formatDate(row.registration_date)],
    ["Decision date", formatDate(row.decision_date)],
    ["Disposition", row.disposition || "-"],
    ["Purpose", row.purpose_name || "-"],
    ["Judge position", row.judge_position || "-"],
    ["Acts", valueList(row.acts_cited)],
    ["Sections", valueList(row.sections_cited)],
    ["Offence categories", valueList(row.offence_categories)],
    ["Criminal target", row.is_criminal_target ? "Yes" : "No"],
    ["Text status", row.text_status],
    ["License", row.license_classification],
    ["Commercial safe", row.commercial_safe ? "Yes" : "No"],
    ["Sensitive flags", valueList(row.sensitive_data_flags)],
  ];
}

export function DistrictCaseDrilldown({ workspaceId, queryString }: { workspaceId: string; queryString: string }) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [caseSearch, setCaseSearch] = useState("");
  const [hasRequestedCases, setHasRequestedCases] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const casesQueryString = useMemo(() => {
    const params = new URLSearchParams(queryString);
    params.set("limit", "25");
    if (caseSearch) params.set("case_search", caseSearch);
    return params.toString();
  }, [caseSearch, queryString]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["district-cases", workspaceId, casesQueryString],
    queryFn: () => apiFetch<CasesResponse>(`/api/v1/workspaces/${workspaceId}/district/cases?${casesQueryString}`),
    enabled: Boolean(workspaceId && hasRequestedCases),
  });

  const effectiveCaseId = hasRequestedCases ? selectedCaseId || data?.cases[0]?.district_case_id || null : null;

  const detailQuery = useQuery({
    queryKey: ["district-case-detail", workspaceId, effectiveCaseId],
    queryFn: () => apiFetch<DistrictCaseDetailResponse>(`/api/v1/workspaces/${workspaceId}/district/cases/${effectiveCaseId}`),
    enabled: Boolean(workspaceId && effectiveCaseId),
    refetchInterval: (query) => {
      const detail = query.state.data as DistrictCaseDetailResponse | undefined;
      return hasActiveQueue(detail?.acquisition_queue) ? 3000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const fetchJudgmentMutation = useMutation({
    mutationFn: (caseId: string) => apiPost<FetchJudgmentResponse>(`/api/v1/workspaces/${workspaceId}/district/cases/${caseId}/fetch-judgment`, {}),
    onSuccess: (response, caseId) => {
      queryClient.setQueryData<DistrictCaseDetailResponse>(
        ["district-case-detail", workspaceId, caseId],
        (existing) => existing ? {
          ...existing,
          case: {
            ...existing.case,
            text_status: response.text_status || existing.case.text_status,
          },
          artifacts: response.artifacts,
          acquisition_queue: response.acquisition_queue,
          fetch_attempts: response.fetch_attempts,
        } : existing,
      );
      queryClient.invalidateQueries({ queryKey: ["district-case-detail", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["district-cases", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["district-source-performance", workspaceId] });
    },
  });

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCaseSearch(searchInput.trim());
    setHasRequestedCases(true);
    setSelectedCaseId(null);
  }

  return (
    <section className="bg-surface border border-skin rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-skin flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-skin-base">Case Drilldown</h3>
          <p className="text-xs text-skin-muted mt-1">Search by CNR, source case ID, UUID, court, state, or district.</p>
        </div>
        <form onSubmit={onSearch} className="flex flex-col gap-2 w-full lg:w-[34rem] sm:flex-row">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-skin-muted" aria-hidden="true" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Case ID, CNR, district..."
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-skin bg-surface text-skin-base"
            />
          </div>
          <button type="submit" className="px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setCaseSearch("");
              setSelectedCaseId(null);
              setHasRequestedCases(true);
            }}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-skin bg-surface text-skin-base hover:bg-surface-alt"
          >
            Load Filtered
          </button>
        </form>
      </div>

      <div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt text-xs text-skin-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Case</th>
                <th className="text-left px-4 py-2 font-medium">Place</th>
                <th className="text-left px-4 py-2 font-medium">Court</th>
                <th className="text-left px-4 py-2 font-medium">Sections</th>
                <th className="text-left px-4 py-2 font-medium">Decision</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.cases.map((row) => {
                const selected = (selectedCaseId || data.cases[0]?.district_case_id) === row.district_case_id;
                return (
                  <Fragment key={row.district_case_id}>
                    <tr
                      onClick={() => setSelectedCaseId(row.district_case_id)}
                      className={`border-t border-skin cursor-pointer hover:bg-surface-alt ${selected ? "bg-primary-50" : ""}`}
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-skin-base">{row.cnr || row.source_case_id}</div>
                        <div className="text-xs text-skin-muted break-all">{row.source_case_id}</div>
                      </td>
                      <td className="px-4 py-3 align-top text-skin-muted">{placeLabel(row)}</td>
                      <td className="px-4 py-3 align-top text-skin-muted">{row.court_name || row.court_level || "-"}</td>
                      <td className="px-4 py-3 align-top text-skin-muted">{valueList(row.sections_cited)}</td>
                      <td className="px-4 py-3 align-top text-skin-muted">{formatDate(row.decision_date)}</td>
                      <td className="px-4 py-3 align-top text-skin-muted">{selected && detailQuery.data ? detailQuery.data.case.text_status : row.text_status}</td>
                    </tr>
                    {selected && (
                      <tr className="border-t border-skin bg-surface">
                        <td colSpan={6} className="p-0">
                          <CaseDetailPanel
                            workspaceId={workspaceId}
                            summary={row}
                            detail={detailQuery.data}
                            isLoading={detailQuery.isLoading || detailQuery.isFetching}
                            mutationVariables={fetchJudgmentMutation.variables}
                            mutationPending={fetchJudgmentMutation.isPending}
                            mutationError={fetchJudgmentMutation.error}
                            onFetch={(caseId) => fetchJudgmentMutation.mutate(caseId)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!hasRequestedCases && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-skin-muted">Search for a case ID/CNR or load the filtered case list.</td>
                </tr>
              )}
              {hasRequestedCases && isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-skin-muted">Loading cases...</td>
                </tr>
              )}
              {hasRequestedCases && !isLoading && !error && (!data?.cases || data.cases.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-skin-muted">No cases match the current filters.</td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-danger">Failed to load district cases.</td>
                </tr>
              )}
            </tbody>
          </table>
          {data && (
            <div className="px-4 py-2 border-t border-skin text-xs text-skin-muted">
              Showing {data.cases.length} of {data.total} matching cases.
            </div>
          )}
        </div>

        {!hasRequestedCases && (
          <div className="border-t border-skin p-4 text-sm text-skin-muted">Select a case to inspect its metadata.</div>
        )}
      </div>
    </section>
  );
}

function CaseDetailPanel({
  workspaceId,
  summary,
  detail,
  isLoading,
  mutationVariables,
  mutationPending,
  mutationError,
  onFetch,
}: {
  workspaceId: string;
  summary: DistrictCaseSummary;
  detail?: DistrictCaseDetailResponse;
  isLoading: boolean;
  mutationVariables?: string;
  mutationPending: boolean;
  mutationError: Error | null;
  onFetch: (caseId: string) => void;
}) {
  if (isLoading && !detail) {
    return <div className="m-4 h-64 rounded bg-surface-alt animate-pulse" />;
  }

  if (!detail) {
    return <div className="p-4 text-sm text-skin-muted">Loading case metadata...</div>;
  }

  const caseId = detail.case.district_case_id;
  const isFetchingThisCase = mutationPending && mutationVariables === caseId;

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-skin-base break-all">{detail.case.cnr || detail.case.source_case_id}</h4>
          <p className="text-xs text-skin-muted mt-1">{placeLabel(summary)}</p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <FetchJudgmentControls
            workspaceId={workspaceId}
            caseId={caseId}
            artifacts={detail.artifacts}
            queue={detail.acquisition_queue}
            attempts={detail.fetch_attempts}
            isFetching={isFetchingThisCase}
            error={mutationVariables === caseId ? mutationError : null}
            onFetch={() => onFetch(caseId)}
          />
          <div className="flex flex-wrap gap-2 text-[11px] text-skin-muted sm:justify-end">
            <CountPill title="Sources" count={detail.sources.length} />
            <CountPill title="Events" count={detail.events.length} />
            <CountPill title="Artifacts" count={detail.artifacts.length} />
            <CountPill title="Queue" count={detail.acquisition_queue.length} />
            <CountPill title="Fetches" count={detail.fetch_attempts.length} />
          </div>
        </div>
      </div>
      <FetchProgressPanel artifacts={detail.artifacts} queue={detail.acquisition_queue} attempts={detail.fetch_attempts} />
      <dl className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-2 text-xs">
        {metadataRows(detail.case).map(([label, value]) => (
          <div key={label} className="grid grid-cols-[8rem_1fr] gap-2">
            <dt className="text-skin-muted">{label}</dt>
            <dd className="text-skin-base break-words">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CountPill({ title, count }: { title: string; count: number }) {
  return (
    <span className="rounded-full border border-skin bg-surface-alt px-2 py-1">
      {title}: {count}
    </span>
  );
}

function FetchProgressPanel({
  artifacts,
  queue,
  attempts,
}: {
  artifacts: DistrictTextArtifact[];
  queue: DistrictAcquisitionQueueRow[];
  attempts: DistrictFetchAttempt[];
}) {
  const availableArtifacts = artifacts.filter((artifact) => artifact.document_id && artifact.artifact_type !== "metadata_only");

  return (
    <div className="overflow-hidden rounded-lg border border-skin">
      <div className="flex flex-col gap-1 border-b border-skin bg-surface-alt px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <h5 className="text-xs font-semibold text-skin-base">Judgment Fetch Progress</h5>
        <div className="flex flex-wrap gap-2 text-[11px] text-skin-muted">
          <CountPill title="Queue" count={queue.length} />
          <CountPill title="Attempts" count={attempts.length} />
          <CountPill title="Documents" count={availableArtifacts.length} />
        </div>
      </div>

      {queue.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface text-skin-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Attempts</th>
                <th className="px-3 py-2 text-left font-medium">Next try</th>
                <th className="px-3 py-2 text-left font-medium">Updated</th>
                <th className="px-3 py-2 text-left font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((row) => (
                <tr key={row.district_acquisition_queue_id} className="border-t border-skin">
                  <td className="px-3 py-2 font-medium text-skin-base">{row.source_name}</td>
                  <td className="px-3 py-2"><StatusPill text={row.status} tone={statusTone(row.status)} /></td>
                  <td className="px-3 py-2 text-skin-muted">{Number(row.attempt_count || 0)} / {Number(row.max_attempts || 0)}</td>
                  <td className="px-3 py-2 text-skin-muted whitespace-nowrap">{formatDateTime(row.next_attempt_at)}</td>
                  <td className="px-3 py-2 text-skin-muted whitespace-nowrap">{formatDateTime(row.updated_at)}</td>
                  <td className="px-3 py-2 text-skin-muted max-w-[18rem] break-words">{queueResult(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-3 py-3 text-xs text-skin-muted">No judgment fetch request has been created for this case.</div>
      )}

      {attempts.length > 0 && (
        <div className="border-t border-skin px-3 py-3">
          <div className="mb-2 text-xs font-medium text-skin-base">Recent Attempts</div>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {attempts.slice(0, 6).map((attempt) => (
              <div key={attempt.district_fetch_attempt_id} className="grid grid-cols-[8rem_1fr] gap-2 text-xs">
                <div className="text-skin-muted">{attempt.source_name}</div>
                <div className="min-w-0">
                  <StatusPill text={attempt.outcome} tone={statusTone(attempt.outcome)} />
                  <span className="ml-2 text-skin-muted">{formatDateTime(attempt.attempted_at)}</span>
                  {attempt.notes && <div className="mt-1 break-words text-skin-muted">{attempt.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function queueResult(row: DistrictAcquisitionQueueRow): string {
  if (row.error_message) return row.error_message;
  const metadata = row.result_metadata || {};
  const documentId = typeof metadata.document_id === "string" ? metadata.document_id : null;
  const artifactId = typeof metadata.artifact_id === "string" ? metadata.artifact_id : null;
  if (documentId) return `Document ${documentId}`;
  if (artifactId) return `Artifact ${artifactId}`;
  return "-";
}

function statusTone(status: string): "success" | "pending" | "blocked" | "neutral" {
  if (["succeeded", "success", "hit", "available"].includes(status)) return "success";
  if (["pending", "processing", "rate_limited", "queued"].includes(status)) return "pending";
  if (["failed", "blocked", "blocked_by_policy", "captcha_required", "miss", "dead"].includes(status)) return "blocked";
  return "neutral";
}

function FetchJudgmentControls({
  workspaceId,
  caseId,
  artifacts,
  queue,
  attempts,
  isFetching,
  error,
  onFetch,
}: {
  workspaceId: string;
  caseId: string;
  artifacts: DistrictTextArtifact[];
  queue: DistrictAcquisitionQueueRow[];
  attempts: DistrictFetchAttempt[];
  isFetching: boolean;
  error: Error | null;
  onFetch: () => void;
}) {
  const availableArtifact = artifacts.find((artifact) => artifact.document_id && artifact.artifact_type !== "metadata_only") || null;
  const activeQueue = queue.find((row) => ["pending", "processing", "rate_limited"].includes(row.status)) || null;
  const blockedQueue = queue.find((row) => row.status === "blocked") || null;
  const latestAttempt = attempts[0] || null;
  const disabled = Boolean(availableArtifact || activeQueue || isFetching);
  const buttonLabel = availableArtifact
    ? "Judgment available"
    : activeQueue
      ? activeQueue.status === "processing" ? "Fetch processing" : "Fetch queued"
      : isFetching ? "Requesting..." : "Fetch judgment";

  return (
    <div className="flex max-w-full flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <button
          type="button"
          onClick={onFetch}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-lg border border-skin bg-surface px-3 py-2 text-xs font-medium text-skin-base hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isFetching ? <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}
          {buttonLabel}
        </button>
        {availableArtifact?.document_id && (
          <Link
            to={`/workspace/${workspaceId}/documents/${availableArtifact.document_id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700"
          >
            <FileText size={13} aria-hidden="true" />
            Open document
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] text-skin-muted sm:justify-end">
        {availableArtifact && <StatusPill text={`Available from ${availableArtifact.source_name}`} tone="success" />}
        {activeQueue && <StatusPill text={`${activeQueue.source_name}: ${activeQueue.status}`} tone="pending" />}
        {!availableArtifact && !activeQueue && blockedQueue && <StatusPill text={`${blockedQueue.source_name}: blocked`} tone="blocked" />}
        {!availableArtifact && !activeQueue && latestAttempt && <StatusPill text={`${latestAttempt.source_name}: ${latestAttempt.outcome}`} tone="neutral" />}
        {error && <StatusPill text={error.message} tone="blocked" />}
      </div>
      <span className="sr-only">Selected case {caseId}</span>
    </div>
  );
}

function StatusPill({ text, tone }: { text: string; tone: "success" | "pending" | "blocked" | "neutral" }) {
  const className = tone === "success"
    ? "border-green-200 bg-green-50 text-green-700"
    : tone === "pending"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "blocked"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-skin bg-surface-alt text-skin-muted";
  return <span className={`rounded-full border px-2 py-1 ${className}`}>{text}</span>;
}
