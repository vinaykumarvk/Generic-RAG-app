import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  Database,
  GitBranch,
  MessageSquare,
  Search,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { MarkdownContent } from "./MarkdownContent";

interface Citation {
  citation_index: number;
  document_title: string;
  page_number: number | null;
  excerpt: string;
  relevance_score: number;
}

interface JourneyStep {
  step_key: string;
  step_index: number;
  title: string;
  status: string;
  latency_ms?: number | null;
  item_count?: number | null;
  summary?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
}

interface JourneyTrace {
  message_id: string;
  retrieval_run_id: string;
  question: string;
  answer: string;
  model_provider?: string | null;
  model_id?: string | null;
  latency_ms?: number | null;
  preset: string;
  retrieval_mode: string;
  cache_hit: boolean;
  expanded_intent?: string | null;
  step_back_question?: string | null;
  inferred_filters?: Record<string, unknown>;
  created_at: string;
  citations: Citation[];
  metrics: {
    total_latency_ms: number;
    vector_latency_ms?: number | null;
    lexical_latency_ms?: number | null;
    graph_latency_ms?: number | null;
    rerank_latency_ms?: number | null;
    generation_latency_ms?: number | null;
    vector_results_count: number;
    lexical_results_count: number;
    graph_results_count: number;
    final_chunks_count: number;
  };
  steps: JourneyStep[];
}

interface JourneyResponse {
  trace: JourneyTrace | null;
}

interface AnswerJourneyPanelProps {
  workspaceId: string;
  messageId: string;
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-success/10 text-success",
  skipped: "bg-surface text-text-secondary",
  cache_hit: "bg-primary-100 text-primary-700",
  cache_miss: "bg-surface text-text-secondary",
  fallback: "surface-warning-soft text-warning",
  failed: "surface-danger-soft text-danger",
};

export function AnswerJourneyPanel({ workspaceId, messageId }: AnswerJourneyPanelProps) {
  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["answer-journey", workspaceId, messageId],
    queryFn: () => apiFetch<JourneyResponse>(`/api/v1/workspaces/${workspaceId}/messages/${messageId}/trace`),
  });

  const trace = data?.trace || null;

  useEffect(() => {
    if (!trace?.steps?.length) {
      setSelectedStepKey(null);
      return;
    }
    setSelectedStepKey((prev) => prev && trace.steps.some((step) => step.step_key === prev) ? prev : trace.steps[0].step_key);
  }, [trace]);

  const selectedStep = trace?.steps.find((step) => step.step_key === selectedStepKey) || trace?.steps[0] || null;

  if (isLoading) {
    return (
      <div className="mt-3 rounded-xl border border-skin bg-surface p-4">
        <div className="h-4 w-40 rounded bg-surface-alt animate-pulse mb-3" />
        <div className="grid gap-2 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-11 rounded-lg bg-surface-alt animate-pulse" />
            ))}
          </div>
          <div className="space-y-3">
            <div className="h-20 rounded-lg bg-surface-alt animate-pulse" />
            <div className="h-32 rounded-lg bg-surface-alt animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-xl border border-danger-soft surface-danger-soft p-4 text-sm text-danger">
        Failed to load the saved answer journey.
      </div>
    );
  }

  if (!trace) {
    return (
      <div className="mt-3 rounded-xl border border-skin bg-surface p-4 text-sm text-text-secondary">
        No saved journey is available for this answer.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-skin bg-surface p-4 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-primary-600" aria-hidden="true" />
            <h4 className="text-sm font-semibold text-text-primary">How This Answer Was Built</h4>
          </div>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{trace.question}</p>
          <div className="flex flex-wrap gap-2">
            <MetricBadge icon={<MessageSquare size={12} aria-hidden="true" />} label={trace.preset} />
            <MetricBadge icon={<Search size={12} aria-hidden="true" />} label={trace.retrieval_mode} />
            <MetricBadge icon={<Clock size={12} aria-hidden="true" />} label={`${trace.metrics.total_latency_ms}ms`} />
            <MetricBadge icon={<Database size={12} aria-hidden="true" />} label={`${trace.metrics.final_chunks_count} chunks`} />
            {trace.cache_hit && <MetricBadge icon={<Database size={12} aria-hidden="true" />} label="Cache hit" />}
          </div>
        </div>
        {(trace.expanded_intent || trace.step_back_question) && (
          <div className="rounded-lg border border-skin bg-surface-alt p-3 text-xs text-text-secondary max-w-xl">
            {trace.expanded_intent && (
              <div className="mb-2">
                <div className="font-medium text-text-primary mb-1">Expanded intent</div>
                <div>{trace.expanded_intent}</div>
              </div>
            )}
            {trace.step_back_question && (
              <div>
                <div className="font-medium text-text-primary mb-1">Step-back question</div>
                <div>{trace.step_back_question}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {trace.steps.map((step) => {
            const isActive = step.step_key === selectedStep?.step_key;
            return (
              <button
                key={step.step_key}
                type="button"
                onClick={() => setSelectedStepKey(step.step_key)}
                className={`min-w-[11rem] rounded-lg border px-3 py-2 text-left transition-colors ${
                  isActive
                    ? "border-primary-500 bg-primary-50"
                    : "border-border-primary bg-surface hover:bg-surface-alt"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text-primary">{step.step_index}. {step.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLES[step.status] || STATUS_STYLES.completed}`}>
                    {formatStatus(step.status)}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-text-secondary">
                  {step.latency_ms != null ? `${step.latency_ms}ms` : "No timer"}
                  {step.item_count != null ? ` • ${step.item_count} items` : ""}
                </div>
              </button>
            );
          })}
        </div>

        <div className="min-w-0">
          {selectedStep ? (
            <StepDetail step={selectedStep} trace={trace} />
          ) : (
            <div className="rounded-lg border border-skin bg-surface-alt p-4 text-sm text-text-secondary">
              No journey steps were recorded for this answer.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepDetail({ step, trace }: { step: JourneyStep; trace: JourneyTrace }) {
  const summaryEntries = Object.entries(step.summary || {}).filter(([, value]) => value !== null && value !== undefined && value !== "");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-skin bg-surface-alt p-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h5 className="text-sm font-semibold text-text-primary">{step.title}</h5>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLES[step.status] || STATUS_STYLES.completed}`}>
            {formatStatus(step.status)}
          </span>
          {step.latency_ms != null && (
            <span className="text-xs text-text-secondary">{step.latency_ms}ms</span>
          )}
        </div>
        {summaryEntries.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {summaryEntries.map(([key, value]) => (
              <SummaryTile key={key} label={formatKey(key)} value={formatValue(value)} />
            ))}
          </div>
        )}
      </div>

      {renderStepBody(step, trace)}

      <details className="rounded-lg border border-skin bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-primary">
          Raw step payload
        </summary>
        <pre className="overflow-x-auto border-t border-skin bg-surface-alt p-4 text-xs text-text-secondary whitespace-pre-wrap">
          {JSON.stringify({ summary: step.summary || {}, payload: step.payload || {} }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function renderStepBody(step: JourneyStep, trace: JourneyTrace): ReactNode {
  const payload = step.payload || {};

  switch (step.step_key) {
    case "query_expansion":
      return (
        <div className="space-y-4">
          <Section title="Expanded intent">
            <p className="text-sm text-text-primary">{stringOrFallback(payload.expanded_intent)}</p>
          </Section>
          <Section title="Step-back question">
            <p className="text-sm text-text-primary">{stringOrFallback(payload.step_back_question)}</p>
          </Section>
          <Section title="Expanded queries">
            <StringList items={asStringArray(payload.expanded_queries)} emptyLabel="No expanded queries." />
          </Section>
        </div>
      );

    case "entity_detection":
      return (
        <Section title="Detected entities">
          <EntityList items={asObjectArray(payload.entities)} />
        </Section>
      );

    case "filter_inference":
      return (
        <div className="space-y-4">
          <Section title="Inferred filters">
            <JsonInline value={payload.inferred_filters || {}} emptyLabel="No inferred filters." />
          </Section>
          <Section title="Scope resolution">
            <JsonInline value={payload.final_scope_resolution || {}} emptyLabel="No scope metadata." />
          </Section>
        </div>
      );

    case "vector_search":
      return (
        <Section title="Per-query vector candidates">
          <QueryResultGroups groups={asObjectArray(payload.queries)} />
        </Section>
      );

    case "lexical_search":
      return (
        <Section title="Lexical candidates">
          <CandidateList items={asObjectArray(payload.results)} />
        </Section>
      );

    case "graph_lookup":
      return (
        <div className="space-y-4">
          <Section title="Related entities">
            <GraphNodeList items={asObjectArray(payload.nodes)} />
          </Section>
          <Section title="Discovered edges">
            <GraphEdgeList items={asObjectArray(payload.edges)} />
          </Section>
          <Section title="Graph context">
            <pre className="whitespace-pre-wrap text-xs text-text-secondary bg-surface-alt rounded-lg p-3 border border-skin">
              {stringOrFallback(payload.context_text)}
            </pre>
          </Section>
        </div>
      );

    case "rerank":
      return (
        <Section title="Ranked chunks">
          <CandidateList items={asObjectArray(payload.ranked_chunks)} />
        </Section>
      );

    case "access_filter":
      return (
        <div className="space-y-4">
          <Section title="Allowed chunks">
            <CandidateList items={asObjectArray(payload.allowed_chunks || payload.remaining_chunks)} />
          </Section>
          <Section title="Removed chunks">
            <CandidateList items={asObjectArray(payload.removed_chunks)} emptyLabel="No chunks were removed here." />
          </Section>
        </div>
      );

    case "scope_filter":
      return (
        <div className="space-y-4">
          <Section title="Final in-scope chunks">
            <CandidateList items={asObjectArray(payload.final_chunks)} />
          </Section>
          <Section title="Removed by scope">
            <CandidateList items={asObjectArray(payload.removed_chunks)} emptyLabel="No chunks were removed by scope." />
          </Section>
          <Section title="Balanced out">
            <CandidateList items={asObjectArray(payload.balanced_out_chunks)} emptyLabel="No chunks were balanced out." />
          </Section>
        </div>
      );

    case "answer_generation":
    case "final_response":
      return (
        <div className="space-y-4">
          <Section title="Answer">
            <div className="rounded-lg border border-skin bg-surface p-3">
              <MarkdownContent content={typeof payload.answer === "string" ? payload.answer : trace.answer} />
            </div>
          </Section>
          <Section title="Citations">
            <CitationList items={trace.citations.length > 0 ? trace.citations : asCitationArray(payload.citations)} />
          </Section>
          {asStringArray(payload.follow_up_questions).length > 0 && (
            <Section title="Follow-up questions">
              <StringList items={asStringArray(payload.follow_up_questions)} emptyLabel="No follow-up questions." />
            </Section>
          )}
        </div>
      );

    case "cache_lookup":
      return (
        <div className="space-y-4">
          <Section title="Cache outcome">
            <p className="text-sm text-text-primary">{stringOrFallback(payload.reason || (trace.cache_hit ? "cache_hit" : "cache_miss"))}</p>
          </Section>
          <Section title="Cached citations">
            <CitationList items={asCitationArray(payload.citations)} />
          </Section>
        </div>
      );

    case "conversation_context":
      return (
        <div className="space-y-4">
          <Section title="Request filters">
            <JsonInline value={payload.request_filters || {}} emptyLabel="No request filters." />
          </Section>
          <Section title="Effective scope">
            <JsonInline value={payload.scope_resolution || {}} emptyLabel="No scope metadata." />
          </Section>
        </div>
      );

    default:
      return (
        <Section title="Saved artifacts">
          <JsonInline value={payload} emptyLabel="No payload recorded." />
        </Section>
      );
  }
}

function MetricBadge({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-skin bg-surface px-2 py-1 text-xs text-text-secondary">
      {icon}
      {label}
    </span>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-skin bg-surface px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="mt-1 text-sm font-medium text-text-primary break-words">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-skin bg-surface p-4 space-y-3">
      <h6 className="text-sm font-semibold text-text-primary">{title}</h6>
      {children}
    </section>
  );
}

function StringList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${item}-${index}`} className="rounded-lg border border-skin bg-surface-alt px-3 py-2 text-sm text-text-primary">
          {item}
        </div>
      ))}
    </div>
  );
}

function EntityList({ items }: { items: Array<Record<string, unknown>> }) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">No entities detected.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((entity, index) => (
        <span key={`${entity.name}-${index}`} className="inline-flex items-center gap-2 rounded-full border border-skin bg-surface-alt px-3 py-1.5 text-xs text-text-primary">
          <Search size={12} aria-hidden="true" className="text-primary-600" />
          <span>{stringOrFallback(entity.name)}</span>
          <span className="text-text-secondary uppercase">{stringOrFallback(entity.type)}</span>
        </span>
      ))}
    </div>
  );
}

function CandidateList({
  items,
  emptyLabel = "No saved candidates.",
}: {
  items: Array<Record<string, unknown>>;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.chunk_id || item.document_title || index}`} className="rounded-lg border border-skin bg-surface-alt p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{stringOrFallback(item.document_title)}</span>
            {item.page_start != null && (
              <span className="text-xs text-text-secondary">p. {String(item.page_start)}</span>
            )}
            {item.score != null && (
              <span className="text-xs rounded-full bg-surface px-2 py-0.5 text-text-secondary">
                score {formatNumeric(item.score)}
              </span>
            )}
            {item.rank != null && (
              <span className="text-xs rounded-full bg-surface px-2 py-0.5 text-text-secondary">
                rank {formatNumeric(item.rank)}
              </span>
            )}
            {item.similarity != null && (
              <span className="text-xs rounded-full bg-surface px-2 py-0.5 text-text-secondary">
                sim {formatNumeric(item.similarity)}
              </span>
            )}
            {typeof item.reason === "string" && (
              <span className="text-xs rounded-full surface-warning-soft px-2 py-0.5 text-warning">
                {item.reason}
              </span>
            )}
          </div>
          {Array.isArray(item.sources) && item.sources.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(item.sources as unknown[]).map((source, sourceIndex) => (
                <span key={`${String(source)}-${sourceIndex}`} className="inline-flex items-center gap-1 rounded-full border border-skin bg-surface px-2 py-1 text-[11px] text-text-secondary">
                  <Database size={10} aria-hidden="true" />
                  {String(source)}
                </span>
              ))}
            </div>
          )}
          {Boolean(item.score_breakdown && typeof item.score_breakdown === "object") && (
            <JsonInline value={item.score_breakdown} emptyLabel="No score breakdown." />
          )}
          {typeof item.content_preview === "string" && (
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{item.content_preview}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function QueryResultGroups({ groups }: { groups: Array<Record<string, unknown>> }) {
  if (groups.length === 0) {
    return <p className="text-sm text-text-secondary">No vector searches were recorded.</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map((group, index) => (
        <div key={`${group.query}-${index}`} className="rounded-lg border border-skin bg-surface-alt p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{stringOrFallback(group.query)}</span>
            {group.latency_ms != null && (
              <span className="text-xs text-text-secondary">{String(group.latency_ms)}ms</span>
            )}
          </div>
          <CandidateList items={asObjectArray(group.results)} emptyLabel="No vector candidates." />
        </div>
      ))}
    </div>
  );
}

function GraphNodeList({ items }: { items: Array<Record<string, unknown>> }) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">No related entities were found.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.node_id || item.name || index}`} className="rounded-lg border border-skin bg-surface-alt p-3">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-medium text-text-primary">{stringOrFallback(item.name)}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-skin bg-surface px-2 py-0.5 text-[11px] text-text-secondary">
              <GitBranch size={10} aria-hidden="true" />
              {stringOrFallback(item.node_type)}
            </span>
            {Boolean(item.subtype) && (
              <span className="text-[11px] text-text-secondary">{String(item.subtype)}</span>
            )}
          </div>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{stringOrFallback(item.description)}</p>
        </div>
      ))}
    </div>
  );
}

function GraphEdgeList({ items }: { items: Array<Record<string, unknown>> }) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">No graph edges were discovered.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${item.source}-${item.target}-${index}`} className="rounded-lg border border-skin bg-surface-alt px-3 py-2 text-sm text-text-primary">
          <span className="font-medium">{stringOrFallback(item.source_name)}</span>
          {" "}
          <span className="text-text-secondary">[{stringOrFallback(item.edge_type)}]</span>
          {" "}
          <span className="font-medium">{stringOrFallback(item.target_name)}</span>
        </div>
      ))}
    </div>
  );
}

function CitationList({ items }: { items: Citation[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">No citations were saved for this step.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((citation) => (
        <div key={`${citation.citation_index}-${citation.document_title}`} className="rounded-lg border border-skin bg-surface-alt p-3 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-primary-700">[{citation.citation_index}]</span>
            <span className="text-sm font-medium text-text-primary">{citation.document_title}</span>
            {citation.page_number != null && (
              <span className="text-xs text-text-secondary">p. {citation.page_number}</span>
            )}
            <span className="ml-auto text-xs text-text-secondary">{Math.round(citation.relevance_score * 100)}%</span>
          </div>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{citation.excerpt}</p>
        </div>
      ))}
    </div>
  );
}

function JsonInline({
  value,
  emptyLabel,
}: {
  value: unknown;
  emptyLabel: string;
}) {
  const normalized = JSON.stringify(value || {});
  if (!normalized || normalized === "{}" || normalized === "[]") {
    return <p className="text-sm text-text-secondary">{emptyLabel}</p>;
  }

  return (
    <pre className="overflow-x-auto rounded-lg border border-skin bg-surface-alt p-3 text-xs text-text-secondary whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asCitationArray(value: unknown): Citation[] {
  return Array.isArray(value)
    ? value.filter((item): item is Citation =>
      typeof item === "object"
      && item !== null
      && typeof (item as Citation).citation_index === "number"
      && typeof (item as Citation).document_title === "string")
    : [];
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ");
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => String(item)).join(", ") : "—";
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value == null || value === "") {
    return "—";
  }
  return String(value);
}

function formatNumeric(value: unknown): string {
  return typeof value === "number" ? value.toFixed(3) : String(value);
}

function stringOrFallback(value: unknown, fallback: string = "—"): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}
