import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseZap, Search, ListChecks, Cog } from "lucide-react";
import { apiFetch, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { ToastContainer } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface BatchJob {
  district_batch_job_id: string;
  job_type: "seed" | "discover";
  status: "pending" | "processing" | "succeeded" | "failed";
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
}

interface StageCounts {
  queued_for_fetch: number;
  fetch_failed: number;
  stored_awaiting_processing: number;
  processed: number;
}

interface StateOption {
  value: string;
  name: string;
  count: number;
}

interface FilterOptions {
  states: StateOption[];
  years: number[];
}

interface DiscoverForm {
  state: string;
  establishment: string;
  court_code: string;
  year: string;
  count: string;
}

const EMPTY_DISCOVER: DiscoverForm = { state: "", establishment: "", court_code: "", year: "", count: "100" };
const ACTIVE_STATUSES = ["pending", "processing"];
const INPUT_CLASS = "w-full px-3 py-2 text-sm rounded-lg border border-skin bg-surface text-skin-base focus:ring-1 focus:ring-primary-500 outline-none";

function statusClass(status: BatchJob["status"]): string {
  if (status === "failed") return "text-danger";
  if (status === "succeeded") return "text-primary-600";
  return "text-skin-muted";
}

function summarizeJob(job: BatchJob): string {
  if (job.job_type === "seed") {
    const queued = job.result?.queued;
    return queued != null ? `queued ${String(queued)}` : "seed";
  }
  const found = job.result?.found;
  const inserted = job.result?.inserted;
  if (found != null || inserted != null) return `found ${String(found ?? 0)}, inserted ${String(inserted ?? 0)}`;
  return `${String(job.params?.state ?? "")}${String(job.params?.establishment ?? "")} ${String(job.params?.year ?? "")}`;
}

export function DistrictBatchControls({ workspaceId }: { workspaceId: string }) {
  const { isAdmin } = useAuth();
  const { toasts, addToast, dismissToast } = useToast();
  const queryClient = useQueryClient();
  const [seedState, setSeedState] = useState("");
  const [seedYear, setSeedYear] = useState("");
  const [seedLimit, setSeedLimit] = useState("1000");
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [processLimit, setProcessLimit] = useState("100");
  const [discover, setDiscover] = useState<DiscoverForm>(EMPTY_DISCOVER);
  const [confirmDiscover, setConfirmDiscover] = useState(false);

  const filterOptions = useQuery({
    queryKey: ["district-filter-options", workspaceId],
    queryFn: () => apiFetch<FilterOptions>(`/api/v1/workspaces/${workspaceId}/district/analytics/filter-options`),
    enabled: !!workspaceId,
  });

  const stageCounts = useQuery({
    queryKey: ["district-stage-counts", workspaceId],
    queryFn: () => apiFetch<StageCounts>(`/api/v1/workspaces/${workspaceId}/district/stage-counts`),
    enabled: !!workspaceId,
    refetchInterval: (query) => {
      const c = query.state.data as StageCounts | undefined;
      return c && (c.queued_for_fetch > 0 || c.stored_awaiting_processing > 0) ? 5000 : false;
    },
  });

  const jobsQuery = useQuery({
    queryKey: ["district-batch-jobs", workspaceId],
    queryFn: () => apiFetch<{ jobs: BatchJob[] }>(`/api/v1/workspaces/${workspaceId}/district/batch-jobs`),
    enabled: !!workspaceId,
    refetchInterval: (query) => {
      const jobs = (query.state.data as { jobs: BatchJob[] } | undefined)?.jobs;
      return jobs?.some((j) => ACTIVE_STATUSES.includes(j.status)) ? 5000 : false;
    },
  });

  const invalidateJobs = () => {
    queryClient.invalidateQueries({ queryKey: ["district-batch-jobs", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["district-stage-counts", workspaceId] });
  };

  const seedMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { limit: Number(seedLimit) || 1000 };
      if (seedState) body.state_code = Number(seedState);
      if (seedYear) body.year = Number(seedYear);
      return apiPost(`/api/v1/workspaces/${workspaceId}/district/seed`, body);
    },
    onSuccess: () => { addToast("Fetch job queued", "success"); invalidateJobs(); },
    onError: (err: Error) => addToast(err.message || "Failed to queue fetch job", "error"),
  });

  const processMutation = useMutation({
    mutationFn: () => apiPost(`/api/v1/workspaces/${workspaceId}/district/process`, { limit: Number(processLimit) || 100 }),
    onSuccess: () => { addToast("Processing job queued", "success"); invalidateJobs(); },
    onError: (err: Error) => addToast(err.message || "Failed to queue processing job", "error"),
  });

  const discoverMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/workspaces/${workspaceId}/district/discover`, {
        state: discover.state,
        establishment: discover.establishment,
        court_code: Number(discover.court_code),
        year: Number(discover.year),
        count: Number(discover.count) || 100,
      }),
    onSuccess: () => { addToast("Discovery job queued", "success"); setDiscover(EMPTY_DISCOVER); invalidateJobs(); },
    onError: (err: Error) => addToast(err.message || "Failed to queue discovery job", "error"),
  });

  const discoverValid =
    /^[A-Za-z]{2}$/.test(discover.state.trim()) &&
    /^[A-Za-z]{2}$/.test(discover.establishment.trim()) &&
    discover.court_code.trim() !== "" &&
    discover.year.trim() !== "";

  const jobsPanel = (
    <BatchJobsPanel jobs={jobsQuery.data?.jobs} isLoading={jobsQuery.isLoading} isError={!!jobsQuery.error} />
  );
  const countsPanel = <StageCountsPanel counts={stageCounts.data} isLoading={stageCounts.isLoading} />;

  if (!isAdmin) {
    return (
      <section className="bg-surface border border-skin rounded-lg">
        {countsPanel}
        {jobsPanel}
      </section>
    );
  }

  return (
    <section className="bg-surface border border-skin rounded-lg">
      <div className="px-4 py-3 border-b border-skin flex items-center gap-2">
        <DatabaseZap size={15} className="text-primary-600" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-skin-base">Acquisition Controls</h3>
      </div>

      {countsPanel}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
        {/* Fetch criminal judgements by state + year */}
        <form
          className="border border-skin rounded-lg p-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); setConfirmSeed(true); }}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-skin-base">
            <ListChecks size={14} className="text-primary-600" aria-hidden="true" />
            Fetch criminal judgements
          </div>
          <p className="text-xs text-skin-muted">Queue criminal cases for judgement fetching. Criminal cases only.</p>
          <div>
            <label htmlFor="seed-state" className="block text-xs text-skin-muted mb-1">State</label>
            <select id="seed-state" value={seedState} onChange={(e) => setSeedState(e.target.value)} className={INPUT_CLASS}>
              <option value="">All states</option>
              {(filterOptions.data?.states ?? []).map((s) => (
                <option key={s.value} value={s.value}>{s.name} ({s.count})</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="seed-year" className="block text-xs text-skin-muted mb-1">Judgement year</label>
            <select id="seed-year" value={seedYear} onChange={(e) => setSeedYear(e.target.value)} className={INPUT_CLASS}>
              <option value="">All years</option>
              {(filterOptions.data?.years ?? []).map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="seed-limit" className="block text-xs text-skin-muted mb-1">Max cases</label>
            <input id="seed-limit" type="number" min={1} value={seedLimit} onChange={(e) => setSeedLimit(e.target.value)} className={INPUT_CLASS} />
          </div>
          <button type="submit" className="btn-primary disabled:opacity-50" disabled={seedMutation.isPending}>
            {seedMutation.isPending ? "Queuing…" : "Queue fetch"}
          </button>
        </form>

        {/* Discover */}
        <form
          className="border border-skin rounded-lg p-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (discoverValid) setConfirmDiscover(true); }}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-skin-base">
            <Search size={14} className="text-primary-600" aria-hidden="true" />
            Discover cases (CNR enumeration)
          </div>
          <p className="text-xs text-skin-muted">Probe the portal for new CNRs. Spends CAPTCHA budget — admin only.</p>
          <div className="grid grid-cols-2 gap-2">
            <LabeledInput id="disc-state" label="State (2)" value={discover.state} maxLength={2}
              onChange={(v) => setDiscover((d) => ({ ...d, state: v.toUpperCase() }))} placeholder="UP" />
            <LabeledInput id="disc-est" label="Establishment (2)" value={discover.establishment} maxLength={2}
              onChange={(v) => setDiscover((d) => ({ ...d, establishment: v.toUpperCase() }))} placeholder="LU" />
            <LabeledInput id="disc-court" label="Court code" value={discover.court_code} type="number"
              onChange={(v) => setDiscover((d) => ({ ...d, court_code: v }))} placeholder="1" />
            <LabeledInput id="disc-year" label="Year" value={discover.year} type="number"
              onChange={(v) => setDiscover((d) => ({ ...d, year: v }))} placeholder="2018" />
            <LabeledInput id="disc-count" label="Count (≤1000)" value={discover.count} type="number"
              onChange={(v) => setDiscover((d) => ({ ...d, count: v }))} placeholder="100" />
          </div>
          <button type="submit" className="btn-primary disabled:opacity-50" disabled={!discoverValid || discoverMutation.isPending}>
            {discoverMutation.isPending ? "Queuing…" : "Start discovery"}
          </button>
        </form>

        {/* Process (Stage 2) */}
        <form
          className="border border-skin rounded-lg p-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); processMutation.mutate(); }}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-skin-base">
            <Cog size={14} className="text-primary-600" aria-hidden="true" />
            Process stored judgments
          </div>
          <p className="text-xs text-skin-muted">Run fetched-but-unprocessed judgments through ingestion (extract, redact, chunk, embed), one by one.</p>
          <div>
            <label htmlFor="process-limit" className="block text-xs text-skin-muted mb-1">Max to process</label>
            <input
              id="process-limit"
              type="number"
              min={1}
              value={processLimit}
              onChange={(e) => setProcessLimit(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <button type="submit" className="btn-primary disabled:opacity-50" disabled={processMutation.isPending}>
            {processMutation.isPending ? "Queuing…" : "Queue processing"}
          </button>
        </form>
      </div>

      {jobsPanel}

      {confirmSeed && (
        <ConfirmDialog
          title="Queue criminal judgements for fetching?"
          message={`This queues up to ${seedLimit || 1000} criminal cases${seedState ? ` in the selected state` : " across all states"}${seedYear ? `, year ${seedYear}` : ""} for judgement fetching. Each fetched case spends acquisition budget. Proceed?`}
          confirmLabel="Queue fetch"
          variant="default"
          onConfirm={() => { setConfirmSeed(false); seedMutation.mutate(); }}
          onCancel={() => setConfirmSeed(false)}
        />
      )}

      {confirmDiscover && (
        <ConfirmDialog
          title="Start CNR discovery?"
          message={`This probes ${discover.count || 100} CNRs on the eCourts portal and spends CAPTCHA solver budget. Proceed?`}
          confirmLabel="Start discovery"
          variant="default"
          onConfirm={() => { setConfirmDiscover(false); discoverMutation.mutate(); }}
          onCancel={() => setConfirmDiscover(false)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </section>
  );
}

function LabeledInput(props: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: string; maxLength?: number; placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="block text-xs text-skin-muted mb-1">{props.label}</label>
      <input
        id={props.id}
        type={props.type ?? "text"}
        value={props.value}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className={INPUT_CLASS}
      />
    </div>
  );
}

function StageCountsPanel({ counts, isLoading }: { counts?: StageCounts; isLoading: boolean }) {
  const cards: Array<{ label: string; value: number | undefined; tone: "base" | "muted" | "danger" }> = [
    { label: "Queued to fetch", value: counts?.queued_for_fetch, tone: "base" },
    { label: "Stored · awaiting processing", value: counts?.stored_awaiting_processing, tone: "base" },
    { label: "Processed", value: counts?.processed, tone: "muted" },
    { label: "Fetch failed", value: counts?.fetch_failed, tone: "danger" },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 border-b border-skin">
      {cards.map((card) => (
        <div key={card.label} className="border border-skin rounded-lg p-3">
          <div className="text-xs text-skin-muted">{card.label}</div>
          <div className={`mt-1 text-xl font-semibold ${card.tone === "danger" ? "text-danger" : "text-skin-base"}`}>
            {isLoading ? "—" : (card.value ?? 0)}
          </div>
        </div>
      ))}
    </div>
  );
}

function BatchJobsPanel({ jobs, isLoading, isError }: { jobs?: BatchJob[]; isLoading: boolean; isError: boolean }) {
  return (
    <div className="p-4 border-t border-skin">
      <div className="flex items-center gap-2 mb-3 text-xs font-medium text-skin-base">
        <ListChecks size={13} className="text-primary-600" aria-hidden="true" />
        Recent batch jobs
      </div>
      {isLoading ? (
        <div className="h-20 rounded-lg bg-surface-alt animate-pulse" />
      ) : isError ? (
        <div className="surface-danger-soft border border-danger-soft rounded-lg p-3 text-sm text-danger">
          Failed to load batch jobs.
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <p className="text-sm text-skin-muted">No batch jobs yet.</p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.district_batch_job_id} className="border border-skin rounded-lg p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-skin-base capitalize">{job.job_type}</div>
                <div className="text-xs text-skin-muted truncate">
                  {summarizeJob(job)}
                  {job.error_message ? ` — ${job.error_message}` : ""}
                </div>
              </div>
              <span className={`text-xs font-medium shrink-0 ${statusClass(job.status)}`}>{job.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
