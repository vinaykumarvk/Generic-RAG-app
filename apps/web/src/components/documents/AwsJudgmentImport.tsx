import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, CloudDownload, Loader2 } from "lucide-react";
import { apiFetch, apiPost } from "@/lib/api";

type AwsRepository = "high_court";
type AwsOptionKind = "years" | "courts" | "benches" | "files";

interface AwsImportResponse {
  document: {
    document_id: string;
    title: string;
    status: string;
  };
  import: {
    bucket: string;
    key: string;
    file_size_bytes: number;
  };
}

interface AwsOption {
  value: string;
  label: string;
  size?: number;
  last_modified?: string | null;
}

interface AwsOptionsResponse {
  options: AwsOption[];
  truncated: boolean;
}

interface AwsImportBatchResult {
  key: string;
  label: string;
  status: "queued" | "duplicate" | "failed";
  document?: AwsImportResponse["document"];
  file_size_bytes?: number;
  error?: string;
}

interface AwsImportBatchSummary {
  total: number;
  queued: number;
  duplicates: number;
  failed: number;
  results: AwsImportBatchResult[];
}

const REPOSITORIES: Array<{ value: AwsRepository; label: string }> = [
  { value: "high_court", label: "Indian High Court Judgments" },
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BULK_IMPORT_CONCURRENCY = 4;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatFileLabel(option: AwsOption): string {
  return option.size ? `${option.label} (${formatFileSize(option.size)})` : option.label;
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function importErrorMessage(error: unknown): string {
  const message = errorMessage(error) ?? "AWS import failed";
  if (message === "Duplicate document detected") {
    return "This PDF already exists in the workspace. Select Allow duplicate to import another copy, or choose a different file.";
  }
  return message;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function AwsJudgmentImport({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const hasValidWorkspaceId = UUID_PATTERN.test(workspaceId);
  const [repository, setRepository] = useState<AwsRepository>("high_court");
  const [year, setYear] = useState("");
  const [court, setCourt] = useState("");
  const [bench, setBench] = useState("");
  const [filePrefix, setFilePrefix] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [sensitivityLevel, setSensitivityLevel] = useState("PUBLIC");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [success, setSuccess] = useState<AwsImportBatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);

  const fetchOptions = (kind: AwsOptionKind, params: Record<string, string> = {}) => {
    const search = new URLSearchParams({
      repository,
      kind,
      max_keys: kind === "files" ? "500" : "1000",
      ...params,
    });
    return apiFetch<AwsOptionsResponse>(`/api/v1/workspaces/${workspaceId}/documents/aws-import/options?${search}`);
  };

  const yearsQuery = useQuery({
    queryKey: ["aws-import-options", workspaceId, repository, "years"],
    queryFn: () => fetchOptions("years"),
    enabled: hasValidWorkspaceId,
  });

  const courtsQuery = useQuery({
    queryKey: ["aws-import-options", workspaceId, repository, "courts", year],
    queryFn: () => fetchOptions("courts", { year }),
    enabled: Boolean(hasValidWorkspaceId && year),
  });

  const benchesQuery = useQuery({
    queryKey: ["aws-import-options", workspaceId, repository, "benches", year, court],
    queryFn: () => fetchOptions("benches", { year, court }),
    enabled: Boolean(hasValidWorkspaceId && year && court),
  });

  const filesQuery = useQuery({
    queryKey: ["aws-import-options", workspaceId, repository, "files", year, court, bench, filePrefix],
    queryFn: () => fetchOptions("files", { year, court, bench, file_prefix: filePrefix }),
    enabled: Boolean(hasValidWorkspaceId && year && court && bench),
  });

  const years = useMemo(() => yearsQuery.data?.options ?? [], [yearsQuery.data?.options]);
  const courts = useMemo(() => courtsQuery.data?.options ?? [], [courtsQuery.data?.options]);
  const benches = useMemo(() => benchesQuery.data?.options ?? [], [benchesQuery.data?.options]);
  const files = useMemo(() => filesQuery.data?.options ?? [], [filesQuery.data?.options]);

  useEffect(() => {
    if (!years.length) return;
    if (!years.some((option) => option.value === year)) {
      setYear(years[0].value);
      setCourt("");
      setBench("");
      setSelectedFiles([]);
    }
  }, [year, years]);

  useEffect(() => {
    if (!courts.length) return;
    if (!courts.some((option) => option.value === court)) {
      setCourt(courts[0].value);
      setBench("");
      setSelectedFiles([]);
    }
  }, [court, courts]);

  useEffect(() => {
    if (!benches.length) return;
    if (!benches.some((option) => option.value === bench)) {
      setBench(benches[0].value);
      setSelectedFiles([]);
    }
  }, [bench, benches]);

  useEffect(() => {
    setSelectedFiles((current) => {
      if (!files.length) return [];
      const available = new Set(files.map((option) => option.value));
      const retained = current.filter((key) => available.has(key));
      return retained.length ? retained : [files[0].value];
    });
  }, [files]);

  const selectedFileOptions = selectedFiles
    .map((key) => files.find((option) => option.value === key))
    .filter((option): option is AwsOption => Boolean(option));
  const optionError =
    errorMessage(yearsQuery.error) ||
    errorMessage(courtsQuery.error) ||
    errorMessage(benchesQuery.error) ||
    errorMessage(filesQuery.error);
  const optionErrorMessage = hasValidWorkspaceId
    ? optionError
    : "Open this page from a valid judgment workspace before importing AWS documents.";

  const importMutation = useMutation({
    mutationFn: async () => {
      const keys = selectedFiles.filter((key) => key.toLowerCase().endsWith(".pdf"));
      setBulkProgress({ completed: 0, total: keys.length });

      const results = await mapWithConcurrency(keys, BULK_IMPORT_CONCURRENCY, async (key) => {
        const option = files.find((item) => item.value === key);
        const label = option?.label || key.split("/").pop() || key;
        try {
          const result = await apiPost<AwsImportResponse>(`/api/v1/workspaces/${workspaceId}/documents/aws-import`, {
            repository,
            key,
            title: keys.length === 1 ? title.trim() || label : label,
            sensitivity_level: sensitivityLevel,
            force: allowDuplicate,
          });
          return {
            key,
            label,
            status: "queued" as const,
            document: result.document,
            file_size_bytes: result.import.file_size_bytes,
          };
        } catch (err) {
          const rawMessage = errorMessage(err) ?? "AWS import failed";
          return {
            key,
            label,
            status: rawMessage === "Duplicate document detected" ? "duplicate" as const : "failed" as const,
            error: importErrorMessage(err),
          };
        } finally {
          setBulkProgress((progress) => progress ? { ...progress, completed: progress.completed + 1 } : progress);
        }
      });

      return {
        total: results.length,
        queued: results.filter((result) => result.status === "queued").length,
        duplicates: results.filter((result) => result.status === "duplicate").length,
        failed: results.filter((result) => result.status === "failed").length,
        results,
      };
    },
    onSuccess: async (result) => {
      setSuccess(result);
      setError(null);
      setTitle("");
      setBulkProgress(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["analytics", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-kpi", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
      ]);
    },
    onError: (err) => {
      setSuccess(null);
      setBulkProgress(null);
      setError(importErrorMessage(err));
    },
  });

  const canSubmit = hasValidWorkspaceId
    && selectedFiles.length > 0
    && selectedFiles.every((key) => key.toLowerCase().endsWith(".pdf"))
    && !importMutation.isPending;

  return (
    <section className="border border-border-primary rounded-xl bg-surface-primary p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-text-primary">AWS Open Data</h3>
          <p className="text-sm text-text-secondary mt-1">Select and import a public judgment PDF.</p>
        </div>
        <CloudDownload size={22} className="text-primary-500 shrink-0" aria-hidden="true" />
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        <label className="space-y-1">
          <span className="text-xs font-medium text-text-secondary">Repository</span>
          <select
            value={repository}
            onChange={(event) => {
              setRepository(event.target.value as AwsRepository);
              setYear("");
              setCourt("");
              setBench("");
              setSelectedFiles([]);
            }}
            className="w-full px-3 py-2 rounded-lg border border-border-primary bg-surface-secondary text-sm text-text-primary"
          >
            {REPOSITORIES.map((repo) => (
              <option key={repo.value} value={repo.value}>{repo.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-text-secondary">Year</span>
          <select
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
              setCourt("");
              setBench("");
              setSelectedFiles([]);
            }}
            disabled={yearsQuery.isLoading || years.length === 0}
            className="w-full px-3 py-2 rounded-lg border border-border-primary bg-surface-secondary text-sm text-text-primary disabled:opacity-60"
          >
            {yearsQuery.isLoading && <option>Loading</option>}
            {years.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-text-secondary">Court Code</span>
          <select
            value={court}
            onChange={(event) => {
              setCourt(event.target.value);
              setBench("");
              setSelectedFiles([]);
            }}
            disabled={!year || courtsQuery.isLoading || courts.length === 0}
            className="w-full px-3 py-2 rounded-lg border border-border-primary bg-surface-secondary text-sm text-text-primary disabled:opacity-60"
          >
            {courtsQuery.isLoading && <option>Loading</option>}
            {courts.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-text-secondary">Bench</span>
          <select
            value={bench}
            onChange={(event) => {
              setBench(event.target.value);
              setSelectedFiles([]);
            }}
            disabled={!court || benchesQuery.isLoading || benches.length === 0}
            className="w-full px-3 py-2 rounded-lg border border-border-primary bg-surface-secondary text-sm text-text-primary disabled:opacity-60"
          >
            {benchesQuery.isLoading && <option>Loading</option>}
            {benches.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <label className="space-y-1">
          <span className="text-xs font-medium text-text-secondary">File Starts With</span>
          <input
            value={filePrefix}
            onChange={(event) => {
              setFilePrefix(event.target.value.replace(/[/?#]/g, ""));
              setSelectedFiles([]);
            }}
            className="w-full px-3 py-2 rounded-lg border border-border-primary bg-surface-secondary text-sm text-text-primary"
          />
        </label>

        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs font-medium text-text-secondary">Files</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-tertiary">{selectedFiles.length} of {files.length} selected</span>
              <button
                type="button"
                onClick={() => setSelectedFiles(files.map((option) => option.value))}
                disabled={!files.length || filesQuery.isLoading}
                className="px-2 py-1 rounded border border-border-primary text-xs text-text-secondary hover:bg-surface-secondary disabled:opacity-50"
              >
                Select all shown
              </button>
              <button
                type="button"
                onClick={() => setSelectedFiles([])}
                disabled={!selectedFiles.length}
                className="px-2 py-1 rounded border border-border-primary text-xs text-text-secondary hover:bg-surface-secondary disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>
          <select
            multiple
            size={Math.min(8, Math.max(3, files.length || 3))}
            value={selectedFiles}
            onChange={(event) => {
              setSelectedFiles(Array.from(event.currentTarget.selectedOptions).map((option) => option.value));
            }}
            disabled={!bench || filesQuery.isLoading || files.length === 0}
            className="w-full px-3 py-2 rounded-lg border border-border-primary bg-surface-secondary text-sm text-text-primary disabled:opacity-60 min-h-[9rem]"
          >
            {filesQuery.isLoading && <option>Loading</option>}
            {files.map((option) => (
              <option key={option.value} value={option.value}>{formatFileLabel(option)}</option>
            ))}
          </select>
        </div>
      </div>

      {filesQuery.data?.truncated && (
        <div className="rounded-lg bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning">
          Showing first 500 files. Narrow by file prefix.
        </div>
      )}

      {optionErrorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>{optionErrorMessage}</span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[1fr_180px]">
        <label className="space-y-1">
          <span className="text-xs font-medium text-text-secondary">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={selectedFiles.length > 1}
            className="w-full px-3 py-2 rounded-lg border border-border-primary bg-surface-secondary text-sm text-text-primary disabled:opacity-60"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-text-secondary">Sensitivity</span>
          <select
            value={sensitivityLevel}
            onChange={(event) => setSensitivityLevel(event.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border-primary bg-surface-secondary text-sm text-text-primary"
          >
            <option value="PUBLIC">Public</option>
            <option value="INTERNAL">Internal</option>
            <option value="RESTRICTED">Restricted</option>
            <option value="SEALED">Sealed</option>
          </select>
        </label>
      </div>

      {selectedFiles.length > 0 && (
        <div className="rounded-lg bg-surface-secondary px-3 py-2 text-xs text-text-secondary space-y-1">
          {selectedFiles.slice(0, 5).map((key) => (
            <div key={key} className="break-all">{key}</div>
          ))}
          {selectedFiles.length > 5 && <div>{selectedFiles.length - 5} more selected</div>}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={allowDuplicate}
            onChange={(event) => setAllowDuplicate(event.target.checked)}
            className="h-4 w-4 rounded border-border-primary"
          />
          Allow duplicate
        </label>
        <button
          type="button"
          onClick={() => importMutation.mutate()}
          disabled={!canSubmit}
          className="btn-primary justify-center disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {importMutation.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CloudDownload size={16} aria-hidden="true" />}
          Import {selectedFiles.length > 1 ? `${selectedFiles.length} PDFs` : "PDF"}
        </button>
      </div>

      {bulkProgress && (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-700">
          Importing {bulkProgress.completed} of {bulkProgress.total}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success space-y-2">
          <div className="flex items-start gap-2">
            <CheckCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {success.queued} queued, {success.duplicates} duplicate, {success.failed} failed out of {success.total}
            </span>
          </div>
          <div className="space-y-1 text-xs">
            {success.results.slice(0, 8).map((result) => (
              <div key={result.key} className={result.status === "failed" || result.status === "duplicate" ? "text-danger" : "text-success"}>
                {result.label}: {result.status === "queued" && result.file_size_bytes ? `queued (${formatFileSize(result.file_size_bytes)})` : result.error || result.status}
              </div>
            ))}
            {success.results.length > 8 && <div>{success.results.length - 8} more results</div>}
          </div>
        </div>
      )}
    </section>
  );
}
