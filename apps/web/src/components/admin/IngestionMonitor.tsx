import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { CheckCircle, AlertCircle, Loader2, Clock, RefreshCw, RotateCcw, FileText, Layers } from "lucide-react";

interface DocSummary {
  document_id: string;
  title: string;
  status: string;
  error_message?: string;
  chunk_count: number;
  created_at: string;
  doc_type?: string;
  category?: string;
  worker_id?: string;
}

function formatDuration(createdAt: string): string {
  const start = new Date(createdAt).getTime();
  const now = Date.now();
  const diffMs = now - start;
  if (diffMs < 0) return "—";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function IngestionMonitor({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ingestion-jobs", workspaceId],
    queryFn: () => apiFetch<{ documents: DocSummary[] }>(
      `/api/v1/workspaces/${workspaceId}/documents?limit=50`
    ),
    refetchInterval: 3000,
    enabled: !!workspaceId,
  });

  const retryMutation = useMutation({
    mutationFn: (docId: string) =>
      apiFetch(`/api/v1/workspaces/${workspaceId}/documents/${docId}/reprocess`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ingestion-jobs", workspaceId] }),
  });

  const docs = data?.documents || [];
  const pending = docs.filter((d) => d.status === "UPLOADED");
  const processing = docs.filter((d) => ["VALIDATING", "NORMALIZING", "CONVERTING", "METADATA_EXTRACTING", "CHUNKING", "EMBEDDING", "KG_EXTRACTING", "REPROCESSING"].includes(d.status));
  const failed = docs.filter((d) => d.status === "FAILED");
  const completed = docs.filter((d) => ["SEARCHABLE", "ACTIVE"].includes(d.status));

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards (FR-024/AC-01) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="bg-surface-primary border border-border-primary rounded-xl p-4">
          <div className="flex items-center gap-2 text-text-secondary">
            <Layers size={16} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider">Total</span>
          </div>
          <p className="text-2xl font-bold text-text-primary mt-1">{docs.length}</p>
        </div>
        <div className="bg-surface-primary border border-border-primary rounded-xl p-4">
          <div className="flex items-center gap-2 text-text-secondary">
            <Clock size={16} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider">Pending</span>
          </div>
          <p className="text-2xl font-bold text-text-primary mt-1">{pending.length}</p>
        </div>
        <div className="bg-surface-primary border border-border-primary rounded-xl p-4">
          <div className="flex items-center gap-2 text-primary-600">
            <Loader2 size={16} className={processing.length > 0 ? "animate-spin" : ""} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider">Processing</span>
          </div>
          <p className="text-2xl font-bold text-text-primary mt-1">{processing.length}</p>
        </div>
        <div className="bg-surface-primary border border-border-primary rounded-xl p-4">
          <div className="flex items-center gap-2 text-danger">
            <AlertCircle size={16} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider">Failed</span>
          </div>
          <p className="text-2xl font-bold text-text-primary mt-1">{failed.length}</p>
        </div>
        <div className="bg-surface-primary border border-border-primary rounded-xl p-4">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle size={16} aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wider">Complete</span>
          </div>
          <p className="text-2xl font-bold text-text-primary mt-1">{completed.length}</p>
        </div>
      </div>

      {/* Manual refresh (FR-024/AC-05) */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => qc.invalidateQueries({ queryKey: ["ingestion-jobs", workspaceId] })}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
          aria-label="Refresh ingestion status"
        >
          <RotateCcw size={12} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Job queue table (FR-024/AC-02) */}
      {(pending.length > 0 || processing.length > 0 || failed.length > 0) && (
        <>
          <div className="md:hidden space-y-3">
            {[...pending, ...processing, ...failed].map((doc) => (
              <article key={doc.document_id} className="bg-surface-primary border border-border-primary rounded-xl p-4 space-y-3">
                <div className="space-y-2">
                  <h5 className="font-medium text-text-primary break-words">{doc.title}</h5>
                  <p className="text-xs text-text-secondary">{doc.doc_type || doc.category || "—"}</p>
                  <div>
                    {doc.status === "FAILED" ? (
                      <div>
                        <span className="flex items-center gap-1 text-xs font-medium text-danger">
                          <AlertCircle size={12} aria-hidden="true" /> Failed
                        </span>
                        {doc.error_message && (
                          <p className="text-xs text-danger mt-1 break-words">{doc.error_message}</p>
                        )}
                      </div>
                    ) : doc.status === "UPLOADED" ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-text-tertiary">
                        <Clock size={12} aria-hidden="true" /> Pending
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium text-primary-500">
                        <Loader2 size={12} className="animate-spin" aria-hidden="true" /> {doc.status}
                      </span>
                    )}
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <dt className="text-text-tertiary">Started</dt>
                    <dd className="text-text-primary font-medium mt-0.5">{doc.created_at ? new Date(doc.created_at).toLocaleString() : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary">Duration</dt>
                    <dd className="text-text-primary font-medium mt-0.5">{doc.created_at ? formatDuration(doc.created_at) : "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-text-tertiary">Worker</dt>
                    <dd className="text-text-primary font-medium mt-0.5 break-all font-mono">{doc.worker_id || "—"}</dd>
                  </div>
                </dl>

                {doc.status === "FAILED" && (
                  <div className="flex justify-end border-t border-border-primary pt-3">
                    <button
                      type="button"
                      onClick={() => retryMutation.mutate(doc.document_id)}
                      disabled={retryMutation.isPending}
                      className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50"
                      aria-label={`Retry ${doc.title}`}
                    >
                      <RefreshCw size={12} aria-hidden="true" /> Retry
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="hidden md:block bg-surface-primary border border-border-primary rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-primary">
                <tr>
                  <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">Document</th>
                  <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">Type</th>
                  <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">Status</th>
                  <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">Started</th>
                  <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">Duration</th>
                  <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">Worker</th>
                  <th scope="col" className="text-right px-4 py-2 font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-primary">
                {[...pending, ...processing, ...failed].map((doc) => (
                  <tr key={doc.document_id} className="hover:bg-surface-secondary">
                    <td className="px-4 py-2">
                      <span className="font-medium text-text-primary truncate block max-w-[200px]">{doc.title}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-text-secondary">
                      {doc.doc_type || doc.category || "—"}
                    </td>
                    <td className="px-4 py-2">
                      {doc.status === "FAILED" ? (
                        <div>
                          <span className="flex items-center gap-1 text-xs font-medium text-danger">
                            <AlertCircle size={12} aria-hidden="true" /> Failed
                          </span>
                          {doc.error_message && (
                            <p className="text-xs text-danger mt-0.5 truncate max-w-[200px]" title={doc.error_message}>
                              {doc.error_message}
                            </p>
                          )}
                        </div>
                      ) : doc.status === "UPLOADED" ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-text-tertiary">
                          <Clock size={12} aria-hidden="true" /> Pending
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-medium text-primary-500">
                          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> {doc.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-tertiary">
                      {doc.created_at ? new Date(doc.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-tertiary">
                      {doc.created_at ? formatDuration(doc.created_at) : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-tertiary font-mono">
                      {doc.worker_id || "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {doc.status === "FAILED" && (
                        <button
                          type="button"
                          onClick={() => retryMutation.mutate(doc.document_id)}
                          disabled={retryMutation.isPending}
                          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 ml-auto"
                          aria-label={`Retry ${doc.title}`}
                        >
                          <RefreshCw size={12} aria-hidden="true" /> Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Recent completed */}
      {completed.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Recently Completed
          </h4>
          <div className="space-y-1">
            {completed.slice(0, 5).map((doc) => (
              <div key={doc.document_id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="truncate flex-1 text-text-secondary">{doc.title}</span>
                <span className="text-xs text-success flex items-center gap-1">
                  <CheckCircle size={10} aria-hidden="true" /> {doc.chunk_count} chunks
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {docs.length === 0 && <p className="text-sm text-text-tertiary text-center py-4">No documents in this workspace</p>}
    </div>
  );
}
