import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiDelete } from "@/lib/api";
import { CheckCircle, AlertCircle, Clock, RefreshCw, Trash2, Download, Eye } from "lucide-react";
import { getDocumentIcon } from "@/lib/document-icons";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface Document {
  document_id: string;
  title: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  status: string;
  category?: string;
  subcategory?: string;
  source_path?: string;
  chunk_count: number;
  error_message?: string;
  uploaded_by?: string;
  created_at: string;
}

interface DocumentsResponse {
  documents: Document[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 20;

const ALL_STATUSES = [
  "UPLOADED",
  "VALIDATING",
  "NORMALIZING",
  "CONVERTING",
  "METADATA_EXTRACTING",
  "CHUNKING",
  "EMBEDDING",
  "SEARCHABLE",
  "KG_EXTRACTING",
  "ACTIVE",
  "FAILED",
  "REPROCESSING",
] as const;

const PROGRESS_MAP: Record<string, number> = {
  VALIDATING: 10,
  NORMALIZING: 20,
  CONVERTING: 35,
  METADATA_EXTRACTING: 50,
  CHUNKING: 45,
  EMBEDDING: 65,
  KG_EXTRACTING: 90,
  REPROCESSING: 5,
};

const STATUS_META: Record<string, { label: string }> = {
  UPLOADED: { label: "Uploaded" },
  VALIDATING: { label: "Validating" },
  NORMALIZING: { label: "Normalizing" },
  CONVERTING: { label: "Converting" },
  METADATA_EXTRACTING: { label: "Extracting Metadata" },
  CHUNKING: { label: "Chunking" },
  EMBEDDING: { label: "Embedding" },
  SEARCHABLE: { label: "Searchable" },
  KG_EXTRACTING: { label: "Extracting KG" },
  ACTIVE: { label: "Active" },
  FAILED: { label: "Failed" },
  REPROCESSING: { label: "Reprocessing" },
};

function formatFileSizeMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ProgressRing({ percent, size = 20 }: { percent: number; size?: number }) {
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${percent}% complete`}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgb(var(--color-border))"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgb(var(--color-primary-500))"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function StatusDisplay({ status, errorMessage }: { status: string; errorMessage?: string }) {
  const progress = PROGRESS_MAP[status];
  const meta = STATUS_META[status] || { label: status };

  if (progress !== undefined) {
    return (
      <div className="flex items-center gap-1.5">
        <ProgressRing percent={progress} />
        <span className="text-xs font-medium text-primary-500">{meta.label}</span>
      </div>
    );
  }

  if (status === "UPLOADED") {
    return (
      <span className="flex items-center gap-1.5 text-text-tertiary">
        <Clock size={14} aria-hidden="true" />
        <span className="text-xs font-medium">{meta.label}</span>
      </span>
    );
  }

  if (status === "FAILED") {
    return (
      <div>
        <span className="flex items-center gap-1.5 text-danger">
          <AlertCircle size={14} />
          <span className="text-xs font-medium">{meta.label}</span>
        </span>
        {errorMessage && (
          <p className="text-xs text-danger mt-0.5 truncate max-w-[200px]" title={errorMessage}>
            {errorMessage}
          </p>
        )}
      </div>
    );
  }

  // ACTIVE, SEARCHABLE
  return (
    <span className="flex items-center gap-1.5 text-success">
      <CheckCircle size={14} />
      <span className="text-xs font-medium">{meta.label}</span>
    </span>
  );
}

export function DocumentList({ workspaceId }: { workspaceId: string }) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<"delete" | "retry" | null>(null);
  const queryClient = useQueryClient();

  const setFilterAndResetPage = (filter: string | null) => {
    setStatusFilter(filter);
    setPage(1);
    setSelected(new Set());
  };

  const { data, isLoading } = useQuery({
    queryKey: ["documents", workspaceId, page, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (statusFilter) params.set("status", statusFilter);
      return apiFetch<DocumentsResponse>(`/api/v1/workspaces/${workspaceId}/documents?${params}`);
    },
    refetchInterval: 5000,
  });

  const reprocessMutation = useMutation({
    mutationFn: (docId: string) =>
      apiFetch(`/api/v1/workspaces/${workspaceId}/documents/${docId}/reprocess`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) =>
      apiDelete(`/api/v1/workspaces/${workspaceId}/documents/${docId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] }),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => apiDelete(`/api/v1/workspaces/${workspaceId}/documents/${id}`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      setSelected(new Set());
      setBatchAction(null);
    },
  });

  const batchRetryMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => apiFetch(`/api/v1/workspaces/${workspaceId}/documents/${id}/reprocess`, { method: "POST" })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      setSelected(new Set());
      setBatchAction(null);
    },
  });

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!data?.documents) return;
    setSelected((prev) => {
      if (prev.size === data.documents.length) return new Set();
      return new Set(data.documents.map((d) => d.document_id));
    });
  }, [data?.documents]);

  const selectedFailedIds = data?.documents
    .filter((d) => selected.has(d.document_id) && d.status === "FAILED")
    .map((d) => d.document_id) || [];

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" role="status" aria-label="Loading documents" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status filter chips */}
      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilterAndResetPage(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            statusFilter === null
              ? "bg-brand text-on-brand"
              : "bg-surface-secondary text-text-secondary hover:bg-surface-secondary/80"
          }`}
        >
          All
        </button>
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilterAndResetPage(statusFilter === s ? null : s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              statusFilter === s
                ? "bg-brand text-on-brand"
                : "bg-surface-secondary text-text-secondary hover:bg-surface-secondary/80"
            }`}
          >
            {STATUS_META[s]?.label || s}
          </button>
        ))}
      </div>

      {/* Batch action toolbar (FR-016/AC-04) */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 surface-brand-soft rounded-lg border border-primary-200">
          <span className="text-sm font-medium text-primary-700">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={() => setBatchAction("delete")}
            disabled={batchDeleteMutation.isPending}
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-danger surface-danger-soft rounded-lg hover-surface-danger-soft transition-colors disabled:opacity-50"
          >
            <Trash2 size={12} aria-hidden="true" />
            Delete selected
          </button>
          {selectedFailedIds.length > 0 && (
            <button
              type="button"
              onClick={() => setBatchAction("retry")}
              disabled={batchRetryMutation.isPending}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-primary-600 surface-brand-soft rounded-lg hover-surface-brand-soft transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} aria-hidden="true" />
              Retry failed ({selectedFailedIds.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-text-secondary hover:text-text-primary ml-auto"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Batch confirm dialog */}
      {batchAction === "delete" && (
        <ConfirmDialog
          title="Delete selected documents"
          message={`This will permanently delete ${selected.size} document${selected.size > 1 ? "s" : ""} and all associated data.`}
          confirmLabel={`Delete ${selected.size} document${selected.size > 1 ? "s" : ""}`}
          variant="danger"
          onConfirm={() => batchDeleteMutation.mutate(Array.from(selected))}
          onCancel={() => setBatchAction(null)}
        />
      )}
      {batchAction === "retry" && (
        <ConfirmDialog
          title="Retry failed documents"
          message={`This will reprocess ${selectedFailedIds.length} failed document${selectedFailedIds.length > 1 ? "s" : ""}.`}
          confirmLabel={`Retry ${selectedFailedIds.length} document${selectedFailedIds.length > 1 ? "s" : ""}`}
          onConfirm={() => batchRetryMutation.mutate(selectedFailedIds)}
          onCancel={() => setBatchAction(null)}
        />
      )}

      {/* Table */}
      {!data?.documents.length ? (
        <p className="text-center py-8 text-text-secondary">
          {statusFilter ? "No documents match this filter" : "No documents uploaded yet"}
        </p>
      ) : (
        <>
          <div className="md:hidden space-y-3">
            <div className="flex items-center justify-between px-4 py-3 bg-surface-primary border border-border-primary rounded-xl">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={data.documents.length > 0 && selected.size === data.documents.length}
                  onChange={toggleSelectAll}
                  className="rounded border-border-primary"
                  aria-label="Select all documents"
                />
                Select all
              </label>
              <span className="text-xs text-text-tertiary">{data.documents.length} document{data.documents.length > 1 ? "s" : ""}</span>
            </div>

            {data.documents.map((doc) => {
              const DocIcon = getDocumentIcon(doc.mime_type, doc.file_name);
              return (
                <article
                  key={doc.document_id}
                  className={`bg-surface-primary border border-border-primary rounded-xl p-4 space-y-3 ${
                    selected.has(doc.document_id) ? "surface-brand-soft" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(doc.document_id)}
                      onChange={() => toggleSelect(doc.document_id)}
                      className="rounded border-border-primary mt-1"
                      aria-label={`Select ${doc.title}`}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start gap-2">
                        <DocIcon size={16} className="text-text-tertiary shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/workspace/${workspaceId}/documents/${doc.document_id}`}
                            className="font-medium text-text-primary hover:text-primary-600 transition-colors break-words"
                          >
                            {doc.title}
                          </Link>
                          <p className="text-xs text-text-tertiary break-all mt-1">{doc.file_name}</p>
                        </div>
                      </div>

                      {(doc.category || doc.subcategory) && (
                        <div className="space-y-1">
                          {doc.category && (
                            <span className="inline-block px-2 py-0.5 badge-brand rounded text-xs font-medium">
                              {doc.category}
                            </span>
                          )}
                          {doc.subcategory && (
                            <p className="text-xs text-text-tertiary break-words">{doc.subcategory}</p>
                          )}
                        </div>
                      )}

                      <StatusDisplay status={doc.status} errorMessage={doc.error_message} />
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-text-tertiary">Chunks</dt>
                      <dd className="text-text-primary font-medium mt-0.5">{doc.chunk_count}</dd>
                    </div>
                    <div>
                      <dt className="text-text-tertiary">Size</dt>
                      <dd className="text-text-primary font-medium mt-0.5">{formatFileSizeMb(doc.file_size_bytes)}</dd>
                    </div>
                    <div>
                      <dt className="text-text-tertiary">Uploaded By</dt>
                      <dd className="text-text-primary font-medium mt-0.5 break-words">{doc.uploaded_by || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-text-tertiary">Uploaded</dt>
                      <dd className="text-text-primary font-medium mt-0.5">{new Date(doc.created_at).toLocaleDateString()}</dd>
                    </div>
                  </dl>

                  <div className="flex items-center justify-end gap-1 border-t border-border-primary pt-3">
                    <Link
                      to={`/workspace/${workspaceId}/documents/${doc.document_id}`}
                      className="p-2 rounded-lg text-text-tertiary hover:bg-surface-secondary hover:text-primary-500 transition-colors inline-flex"
                      aria-label={`Inspect ${doc.title}`}
                    >
                      <Eye size={16} aria-hidden="true" />
                    </Link>
                    {["SEARCHABLE", "ACTIVE"].includes(doc.status) && (
                      <a
                        href={`/api/v1/workspaces/${workspaceId}/documents/${doc.document_id}/download`}
                        className="p-2 rounded-lg text-text-tertiary hover:bg-surface-secondary hover:text-primary-500 transition-colors inline-flex"
                        aria-label={`Download ${doc.title}`}
                        download
                      >
                        <Download size={16} aria-hidden="true" />
                      </a>
                    )}
                    {doc.status === "FAILED" && (
                      <button
                        type="button"
                        onClick={() => reprocessMutation.mutate(doc.document_id)}
                        disabled={reprocessMutation.isPending}
                        className="p-2 rounded-lg text-text-tertiary hover:bg-surface-secondary hover:text-primary-500 transition-colors disabled:opacity-50"
                        aria-label={`Retry processing ${doc.title}`}
                      >
                        <RefreshCw size={16} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(doc.document_id)}
                      disabled={deleteMutation.isPending}
                      className="p-2 rounded-lg text-text-tertiary hover:bg-surface-secondary hover-text-danger transition-colors disabled:opacity-50"
                      aria-label={`Delete ${doc.title}`}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden md:block bg-surface-primary border border-border-primary rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary border-b border-border-primary">
                <tr>
                  <th scope="col" className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={data.documents.length > 0 && selected.size === data.documents.length}
                      onChange={toggleSelectAll}
                      className="rounded border-border-primary"
                      aria-label="Select all documents"
                    />
                  </th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-text-secondary">Document</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-text-secondary">Category</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-text-secondary">Status</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-text-secondary">Chunks</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-text-secondary">Size</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium text-text-secondary">Uploaded By</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-text-secondary">Uploaded</th>
                  <th scope="col" className="text-right px-4 py-3 font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-primary">
                {data.documents.map((doc) => {
                  const DocIcon = getDocumentIcon(doc.mime_type, doc.file_name);
                  return (
                    <tr key={doc.document_id} className={`hover:bg-surface-secondary ${selected.has(doc.document_id) ? "surface-brand-soft" : ""}`}>
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(doc.document_id)}
                          onChange={() => toggleSelect(doc.document_id)}
                          className="rounded border-border-primary"
                          aria-label={`Select ${doc.title}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <DocIcon size={16} className="text-text-tertiary shrink-0" aria-hidden="true" />
                          <Link
                            to={`/workspace/${workspaceId}/documents/${doc.document_id}`}
                            className="font-medium text-text-primary hover:text-primary-600 transition-colors"
                          >
                            {doc.title}
                          </Link>
                        </div>
                        <span className="text-xs text-text-tertiary">{doc.file_name}</span>
                      </td>
                      <td className="px-4 py-3">
                        {doc.category && (
                          <span className="inline-block px-2 py-0.5 badge-brand rounded text-xs font-medium">
                            {doc.category}
                          </span>
                        )}
                        {doc.subcategory && (
                          <div className="text-xs text-text-tertiary mt-0.5">{doc.subcategory}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusDisplay status={doc.status} errorMessage={doc.error_message} />
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary">{doc.chunk_count}</td>
                      <td className="px-4 py-3 text-right text-text-secondary">
                        {formatFileSizeMb(doc.file_size_bytes)}
                      </td>
                      <td className="px-4 py-3 text-text-tertiary text-xs">
                        {doc.uploaded_by || "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-text-tertiary text-xs">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            to={`/workspace/${workspaceId}/documents/${doc.document_id}`}
                            className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-secondary hover:text-primary-500 transition-colors inline-flex"
                            aria-label={`Inspect ${doc.title}`}
                          >
                            <Eye size={14} aria-hidden="true" />
                          </Link>
                          {["SEARCHABLE", "ACTIVE"].includes(doc.status) && (
                            <a
                              href={`/api/v1/workspaces/${workspaceId}/documents/${doc.document_id}/download`}
                              className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-secondary hover:text-primary-500 transition-colors inline-flex"
                              aria-label={`Download ${doc.title}`}
                              download
                            >
                              <Download size={14} aria-hidden="true" />
                            </a>
                          )}
                          {doc.status === "FAILED" && (
                            <button
                              type="button"
                              onClick={() => reprocessMutation.mutate(doc.document_id)}
                              disabled={reprocessMutation.isPending}
                              className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-secondary hover:text-primary-500 transition-colors disabled:opacity-50"
                              aria-label={`Retry processing ${doc.title}`}
                            >
                              <RefreshCw size={14} aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(doc.document_id)}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-secondary hover-text-danger transition-colors disabled:opacity-50"
                            aria-label={`Delete ${doc.title}`}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav aria-label="Document pagination" className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-border-primary text-text-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-sm text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-border-primary text-text-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
