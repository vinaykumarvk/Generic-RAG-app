/**
 * DocumentDetailPage — Read-only inspection surface for pipeline outputs.
 */

import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPatch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/time";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  FileText,
  GitBranch,
  GitFork,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react";

type DetailTab = "overview" | "text" | "chunks" | "graph";

interface DocumentDetail {
  document_id: string;
  title: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  status: string;
  sensitivity_level: string;
  case_reference: string | null;
  fir_number: string | null;
  station_code: string | null;
  language: string | null;
  page_count: number | null;
  review_required: boolean;
  metadata_confidence: number | null;
  extracted_metadata: Record<string, unknown> | null;
  chunk_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface DocumentVersion {
  version_id: string;
  version_number: number;
  file_size_bytes: number | null;
  created_at: string;
  is_current?: boolean;
}

interface IngestionStep {
  job_id: string;
  step: string;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface ExtractedTextResponse {
  extracted_text: {
    extraction_id: string;
    extraction_type: string;
    content: string;
    metadata: Record<string, unknown> | null;
    confidence: number | null;
    created_at: string;
  } | null;
}

interface ChunkRecord {
  chunk_id: string;
  chunk_index: number;
  chunk_type: string;
  token_count: number;
  page_start: number | null;
  page_end: number | null;
  heading_path: string | null;
  metadata: Record<string, unknown> | null;
  content: string;
}

interface GraphNodeRecord {
  node_id: string;
  name: string;
  normalized_name: string;
  node_type: string;
  subtype: string | null;
  description: string | null;
  confidence: number | null;
  mention_count: number;
  chunk_ids: string[];
}

interface GraphEdgeRecord {
  edge_id: string;
  edge_type: string;
  label: string | null;
  weight: number;
  source_name: string;
  source_type: string;
  target_name: string;
  target_type: string;
  evidence_count: number;
  chunk_ids: string[];
}

interface GraphResponse {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
}

export function DocumentDetailPage() {
  const { workspaceId, documentId } = useParams<{ workspaceId: string; documentId: string }>();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState<Record<string, string>>({});

  const { data: doc, isLoading } = useQuery({
    queryKey: ["document-detail", documentId],
    queryFn: () => apiFetch<DocumentDetail>(`/api/v1/workspaces/${workspaceId}/documents/${documentId}`),
    enabled: !!workspaceId && !!documentId,
  });

  const { data: versions } = useQuery({
    queryKey: ["document-versions", documentId],
    queryFn: () => apiFetch<{ versions: DocumentVersion[] }>(`/api/v1/workspaces/${workspaceId}/documents/${documentId}/versions`),
    enabled: !!workspaceId && !!documentId,
  });

  const { data: steps, isLoading: isLoadingSteps } = useQuery({
    queryKey: ["document-steps", documentId],
    queryFn: () => apiFetch<{ steps: IngestionStep[] }>(`/api/v1/workspaces/${workspaceId}/ingestion/${documentId}/history`),
    enabled: !!workspaceId && !!documentId,
    retry: false,
  });

  const { data: extractedText, isLoading: isLoadingText } = useQuery({
    queryKey: ["document-extracted-text", documentId],
    queryFn: () => apiFetch<ExtractedTextResponse>(`/api/v1/workspaces/${workspaceId}/documents/${documentId}/extracted-text`),
    enabled: !!workspaceId && !!documentId && activeTab === "text",
  });

  const { data: chunksData, isLoading: isLoadingChunks } = useQuery({
    queryKey: ["document-chunks", documentId],
    queryFn: () => apiFetch<{ chunks: ChunkRecord[] }>(`/api/v1/workspaces/${workspaceId}/documents/${documentId}/chunks`),
    enabled: !!workspaceId && !!documentId && activeTab === "chunks",
  });

  const { data: graphData, isLoading: isLoadingGraph } = useQuery({
    queryKey: ["document-graph", documentId],
    queryFn: () => apiFetch<GraphResponse>(`/api/v1/workspaces/${workspaceId}/documents/${documentId}/graph`),
    enabled: !!workspaceId && !!documentId && activeTab === "graph",
  });

  const updateMetaMutation = useMutation({
    mutationFn: (meta: Record<string, string>) =>
      apiPatch(`/api/v1/workspaces/${workspaceId}/documents/${documentId}`, meta),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["document-detail", documentId] });
      setEditingMeta(false);
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (!doc) {
    return <div className="text-center py-12 text-text-tertiary">Document not found.</div>;
  }

  const statusColor: Record<string, string> = {
    ACTIVE: "badge-success",
    SEARCHABLE: "badge-brand",
    FAILED: "badge-danger",
    UPLOADED: "badge-neutral",
    VALIDATING: "badge-warning",
    NORMALIZING: "badge-warning",
    CONVERTING: "badge-warning",
    METADATA_EXTRACTING: "badge-warning",
    CHUNKING: "badge-warning",
    CHUNKED: "badge-warning",
    EMBEDDING: "badge-warning",
    KG_EXTRACTING: "badge-warning",
    REPROCESSING: "badge-warning",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Link
          to={`/workspace/${workspaceId}/documents`}
          className="p-2 rounded-lg text-text-tertiary hover:bg-surface-secondary transition-colors"
          aria-label="Back to documents"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold text-text-primary truncate">{doc.title || doc.file_name}</h2>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColor[doc.status] || "bg-surface-alt text-skin-base"}`}>
              {doc.status}
            </span>
            {doc.review_required && (
              <span className="text-xs badge-warning px-2 py-0.5 rounded font-medium flex items-center gap-1">
                <AlertTriangle size={12} aria-hidden="true" />
                Review Required
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-text-tertiary">
            <span className="flex items-center gap-1">
              <Shield size={12} aria-hidden="true" />
              {doc.sensitivity_level || "INTERNAL"}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={12} aria-hidden="true" />
              Uploaded {formatRelativeTime(doc.created_at)}
            </span>
            <span>{doc.file_name}</span>
            <span>{formatBytes(doc.file_size_bytes)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <SummaryCard label="Pages" value={doc.page_count != null ? String(doc.page_count) : "—"} />
        <SummaryCard label="Chunks" value={String(doc.chunk_count)} />
        <SummaryCard label="Language" value={doc.language || "—"} />
        <SummaryCard label="Updated" value={formatRelativeTime(doc.updated_at)} />
      </div>

      <div className="flex gap-1 border-b border-border-primary" role="tablist" aria-label="Document inspection tabs">
        <TabButton label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
        <TabButton label="Extracted Text" active={activeTab === "text"} onClick={() => setActiveTab("text")} />
        <TabButton label="Chunks" active={activeTab === "chunks"} onClick={() => setActiveTab("chunks")} />
        <TabButton label="Nodes & Edges" active={activeTab === "graph"} onClick={() => setActiveTab("graph")} />
      </div>

      {activeTab === "overview" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-4">
            <SectionCard title="Metadata">
              {editingMeta ? (
                <div className="space-y-3">
                  {["case_reference", "fir_number", "station_code", "language", "sensitivity_level"].map((field) => (
                    <label key={field} className="block text-sm">
                      <span className="text-text-secondary font-medium">{field.replace(/_/g, " ")}</span>
                      <input
                        type="text"
                        value={metaForm[field] ?? (doc[field as keyof DocumentDetail] as string || "")}
                        onChange={(e) => setMetaForm({ ...metaForm, [field]: e.target.value })}
                        className="mt-1 w-full px-3 py-1.5 text-sm border border-border-primary rounded-lg bg-surface-primary text-text-primary"
                      />
                    </label>
                  ))}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => updateMetaMutation.mutate(metaForm)}
                      disabled={updateMetaMutation.isPending}
                      className="px-3 py-1.5 text-xs bg-brand text-on-brand rounded-lg hover:bg-brand-hover disabled:opacity-60"
                    >
                      {updateMetaMutation.isPending ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMeta(false)}
                      className="px-3 py-1.5 text-xs border border-border-primary rounded-lg hover:bg-surface-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <MetaRow label="File" value={doc.file_name} />
                  <MetaRow label="Size" value={formatBytes(doc.file_size_bytes)} />
                  <MetaRow label="Type" value={doc.mime_type} />
                  <MetaRow label="Case Reference" value={doc.case_reference} />
                  <MetaRow label="FIR Number" value={doc.fir_number} />
                  <MetaRow label="Station" value={doc.station_code} />
                  <MetaRow label="Language" value={doc.language} />
                  <MetaRow label="Pages" value={doc.page_count != null ? String(doc.page_count) : "—"} />
                  {doc.metadata_confidence != null && (
                    <MetaRow label="Metadata Confidence" value={`${(doc.metadata_confidence * 100).toFixed(0)}%`} />
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingMeta(true)}
                    className="mt-3 text-xs text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Edit metadata
                  </button>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Processing History" icon={<RefreshCw size={16} aria-hidden="true" />}>
              {isLoadingSteps ? (
                <LoadingState />
              ) : steps?.steps && steps.steps.length > 0 ? (
                <div className="space-y-3">
                  {steps.steps.map((step) => (
                    <div key={step.job_id} className="flex items-start gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${stepStatusDot(step.status)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-text-primary">{step.step}</span>
                          <span className="text-xs text-text-tertiary">{step.status}</span>
                        </div>
                        {step.error_message && (
                          <p className="text-xs text-danger mt-0.5 whitespace-pre-wrap break-words">{step.error_message}</p>
                        )}
                      </div>
                      <span className="text-xs text-text-tertiary whitespace-nowrap">
                        {formatRelativeTime(step.completed_at || step.started_at || step.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="No processing history available yet." />
              )}
            </SectionCard>

            {doc.error_message && (
              <SectionCard title="Current Failure" icon={<AlertTriangle size={16} aria-hidden="true" />}>
                <pre className="text-sm text-danger whitespace-pre-wrap break-words">{doc.error_message}</pre>
              </SectionCard>
            )}
          </div>

          <div className="space-y-4">
            <SectionCard title="Versions" icon={<GitBranch size={16} aria-hidden="true" />}>
              {versions?.versions && versions.versions.length > 0 ? (
                <div className="space-y-2">
                  {versions.versions.map((version) => (
                    <div key={version.version_id} className="flex items-center justify-between text-sm gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-text-primary">
                          v{version.version_number}
                          {version.is_current && (
                            <span className="ml-2 text-xs badge-success px-1.5 py-0.5 rounded">current</span>
                          )}
                        </div>
                        {version.file_size_bytes != null && (
                          <div className="text-xs text-text-tertiary">{formatBytes(version.file_size_bytes)}</div>
                        )}
                      </div>
                      <span className="text-xs text-text-tertiary whitespace-nowrap">{formatRelativeTime(version.created_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="Single version." />
              )}
            </SectionCard>

            {doc.extracted_metadata && Object.keys(doc.extracted_metadata).length > 0 && (
              <SectionCard title="Extracted Fields" icon={<FileText size={16} aria-hidden="true" />}>
                <dl className="space-y-2 text-sm">
                  {Object.entries(doc.extracted_metadata).map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-1">
                      <dt className="text-text-tertiary">{key}</dt>
                      <dd className="text-text-primary break-words">{formatUnknownValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </SectionCard>
            )}
          </div>
        </div>
      )}

      {activeTab === "text" && (
        <SectionCard title="Extracted Text" icon={<FileText size={16} aria-hidden="true" />} testId="document-extracted-text">
          {isLoadingText ? (
            <LoadingState />
          ) : extractedText?.extracted_text ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 text-xs text-text-tertiary">
                <span>Captured {formatRelativeTime(extractedText.extracted_text.created_at)}</span>
                {extractedText.extracted_text.confidence != null && (
                  <span>Confidence {(extractedText.extracted_text.confidence * 100).toFixed(0)}%</span>
                )}
              </div>
              <pre className="bg-surface-secondary border border-border-primary rounded-xl p-4 text-sm leading-6 whitespace-pre-wrap break-words overflow-x-auto">
                {extractedText.extracted_text.content}
              </pre>
            </div>
          ) : (
            <EmptyState message="No extracted text is available yet. The document may still be processing." />
          )}
        </SectionCard>
      )}

      {activeTab === "chunks" && (
        <SectionCard title="Chunks" testId="document-chunks">
          {isLoadingChunks ? (
            <LoadingState />
          ) : chunksData?.chunks && chunksData.chunks.length > 0 ? (
            <div className="space-y-4">
              {chunksData.chunks.map((chunk) => (
                <div key={chunk.chunk_id} data-testid="chunk-card" className="border border-border-primary rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-surface-secondary border-b border-border-primary flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-text-primary">Chunk {chunk.chunk_index + 1}</span>
                    <Badge>{chunk.chunk_type}</Badge>
                    <Badge>{chunk.token_count} tokens</Badge>
                    {chunk.page_start != null && (
                      <Badge>{formatPageRange(chunk.page_start, chunk.page_end)}</Badge>
                    )}
                    {chunk.heading_path && <Badge>{chunk.heading_path}</Badge>}
                  </div>
                  <pre className="p-4 text-sm leading-6 whitespace-pre-wrap break-words overflow-x-auto">{chunk.content}</pre>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No chunks are available yet. This document may still be before chunking." />
          )}
        </SectionCard>
      )}

      {activeTab === "graph" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <SectionCard title="Nodes" icon={<GitFork size={16} aria-hidden="true" />} testId="document-nodes">
            {isLoadingGraph ? (
              <LoadingState />
            ) : graphData?.nodes && graphData.nodes.length > 0 ? (
              <div className="space-y-3">
                {graphData.nodes.map((node) => (
                  <div key={node.node_id} data-testid="node-card" className="border border-border-primary rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-text-primary truncate">{node.name}</div>
                        <div className="text-xs text-text-tertiary">{node.normalized_name}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Badge>{node.node_type}</Badge>
                        <Badge>{node.mention_count} mentions</Badge>
                      </div>
                    </div>
                    {node.description && (
                      <p className="text-sm text-text-secondary whitespace-pre-wrap break-words">{node.description}</p>
                    )}
                    {node.chunk_ids.length > 0 && (
                      <div className="text-xs text-text-tertiary break-words">
                        Chunks: {node.chunk_ids.join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No nodes are linked to this document yet." />
            )}
          </SectionCard>

          <SectionCard title="Edges" icon={<GitBranch size={16} aria-hidden="true" />} testId="document-edges">
            {isLoadingGraph ? (
              <LoadingState />
            ) : graphData?.edges && graphData.edges.length > 0 ? (
              <div className="space-y-3">
                {graphData.edges.map((edge) => (
                  <div key={edge.edge_id} data-testid="edge-card" className="border border-border-primary rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-text-primary">{edge.source_name}</span>
                      <span className="text-text-tertiary">→</span>
                      <span className="text-primary-600 font-medium">{edge.edge_type}</span>
                      <span className="text-text-tertiary">→</span>
                      <span className="font-medium text-text-primary">{edge.target_name}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-text-tertiary">
                      <Badge>{edge.source_type}</Badge>
                      <Badge>{edge.target_type}</Badge>
                      <Badge>{edge.evidence_count} evidence</Badge>
                      <Badge>Weight {Number(edge.weight).toFixed(2)}</Badge>
                    </div>
                    {edge.label && (
                      <p className="text-sm text-text-secondary whitespace-pre-wrap break-words">{edge.label}</p>
                    )}
                    {edge.chunk_ids.length > 0 && (
                      <div className="text-xs text-text-tertiary break-words">
                        Chunks: {edge.chunk_ids.join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No edges are linked to this document yet." />
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title,
  icon,
  children,
  testId,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="bg-surface-primary border border-border-primary rounded-xl p-5">
      <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-primary border border-border-primary rounded-xl p-4">
      <div className="text-xs text-text-tertiary uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-lg font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid={`document-tab-${label.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and")}`}
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
        active ? "border-primary-600 text-primary-600" : "border-transparent text-text-tertiary hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-text-tertiary">{label}</span>
      <span className="text-text-primary text-right break-words">{value || "—"}</span>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface-alt text-text-tertiary text-xs">
      {children}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="flex justify-center py-8">
      <Loader2 className="animate-spin text-text-tertiary" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-text-tertiary">{message}</p>;
}

function stepStatusDot(status: string): string {
  if (status === "COMPLETED") return "status-dot-success";
  if (status === "FAILED") return "status-dot-danger";
  if (status === "PROCESSING" || status === "RETRYING") return "status-dot-warning animate-pulse";
  return "status-dot-muted";
}

function formatPageRange(pageStart: number, pageEnd: number | null): string {
  if (pageEnd != null && pageEnd !== pageStart) return `Pages ${pageStart}-${pageEnd}`;
  return `Page ${pageStart}`;
}

function formatUnknownValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
