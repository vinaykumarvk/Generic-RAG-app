import { useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ChevronRight, FileText, GitBranch, Hash, ExternalLink } from "lucide-react";

interface Citation {
  citation_index: number;
  document_title: string;
  page_number: number | null;
  excerpt: string;
  relevance_score: number;
  source_language?: string | null;
  target_language?: string | null;
  translation_status?: string | null;
  translated_excerpt?: string | null;
  original_excerpt?: string | null;
}

interface ReferencesSectionProps {
  citations: Citation[];
  wikiReferences?: Array<{ title: string; review_status?: string; citation_coverage?: number }>;
  graphReferences?: Array<{ edge_type?: string; source_name?: string; target_name?: string; review_status?: string; confidence?: number }>;
  renumberMap?: Record<number, number>;
  showInlineCitations?: boolean;
  onToggleInline?: () => void;
  onCitationClick?: (citation: Citation) => void;
}

export function ReferencesSection({
  citations,
  wikiReferences = [],
  graphReferences = [],
  renumberMap,
  showInlineCitations,
  onToggleInline,
  onCitationClick,
}: ReferencesSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if ((!citations || citations.length === 0) && wikiReferences.length === 0 && graphReferences.length === 0) return null;

  const sorted = [...citations].sort(
    (a, b) => (renumberMap?.[a.citation_index] ?? a.citation_index) - (renumberMap?.[b.citation_index] ?? b.citation_index),
  );

  return (
    <div className="mt-3 border-t border-skin pt-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs font-medium text-skin-muted hover:text-skin-base transition-colors"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          {citations.length + wikiReferences.length + graphReferences.length} reference{citations.length + wikiReferences.length + graphReferences.length > 1 ? "s" : ""}
        </button>
        {onToggleInline && (
          <button
            type="button"
            onClick={onToggleInline}
            className="flex items-center gap-1 text-xs text-skin-muted hover:text-skin-base transition-colors ml-auto"
            aria-pressed={showInlineCitations}
          >
            <Hash size={10} aria-hidden="true" />
            {showInlineCitations ? "Hide inline" : "Show inline"}
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-2 space-y-3">
          {wikiReferences.length > 0 && (
            <ReferenceGroup title="Wiki" icon={<BookOpen size={12} aria-hidden="true" />}>
              {wikiReferences.map((ref, index) => (
                <div key={`${ref.title}-${index}`} className="rounded-lg border border-skin p-2 text-xs text-skin-muted">
                  <div className="font-semibold text-skin-base">{ref.title}</div>
                  <div>{ref.review_status || "unknown"}{ref.citation_coverage != null ? ` · ${Math.round(ref.citation_coverage * 100)}% cited` : ""}</div>
                </div>
              ))}
            </ReferenceGroup>
          )}
          {graphReferences.length > 0 && (
            <ReferenceGroup title="Graph" icon={<GitBranch size={12} aria-hidden="true" />}>
              {graphReferences.map((ref, index) => (
                <div key={`${ref.edge_type}-${index}`} className="rounded-lg border border-skin p-2 text-xs text-skin-muted">
                  <div className="font-semibold text-skin-base">{ref.source_name || "Source"} [{ref.edge_type || "edge"}] {ref.target_name || "Target"}</div>
                  <div>{ref.review_status || "unknown"}{ref.confidence != null ? ` · ${Math.round(ref.confidence * 100)}%` : ""}</div>
                </div>
              ))}
            </ReferenceGroup>
          )}
          {sorted.length > 0 && (
            <ReferenceGroup title="Judgments" icon={<FileText size={12} aria-hidden="true" />}>
              <ol className="space-y-2 list-none pl-0">
                {sorted.map((citation) => {
                  const displayIndex = renumberMap?.[citation.citation_index] ?? citation.citation_index;
                  return (
                    <li key={citation.citation_index}>
                      <button
                        type="button"
                        onClick={() => onCitationClick?.(citation)}
                        className="flex items-start gap-2.5 w-full text-left p-2.5 rounded-lg border border-skin hover:border-primary-300 hover:bg-primary-50/50 transition-colors group"
                      >
                        <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1 text-xs font-bold rounded bg-primary-100 text-primary-700 shrink-0 mt-0.5">
                          {displayIndex}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <FileText size={13} className="text-primary-500 shrink-0" aria-hidden="true" />
                            <p className="text-xs font-semibold text-skin-base truncate">
                              {citation.document_title}
                              {citation.page_number ? <span className="font-normal text-skin-muted">, p.{citation.page_number}</span> : ""}
                            </p>
                            <ExternalLink size={10} className="text-skin-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-auto" aria-hidden="true" />
                          </div>
                          <p className="text-xs text-skin-muted leading-relaxed mt-1 line-clamp-3">
                            {citation.excerpt}
                          </p>
                          {citation.source_language && citation.target_language && citation.source_language !== citation.target_language && (
                            <div className="mt-1.5 space-y-1 text-[0.68rem] text-skin-muted">
                              <div>
                                {citation.source_language.toUpperCase()} to {citation.target_language.toUpperCase()}
                                {citation.translation_status ? ` (${citation.translation_status})` : ""}
                              </div>
                              {citation.original_excerpt && (
                                <p className="line-clamp-2">{citation.original_excerpt}</p>
                              )}
                            </div>
                          )}
                          {citation.relevance_score > 0 && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <div className="h-1 w-16 rounded-full bg-surface overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-primary-400"
                                  style={{ width: `${Math.round(citation.relevance_score * 100)}%` }}
                                />
                              </div>
                              <span className="text-[0.6rem] text-skin-muted">{Math.round(citation.relevance_score * 100)}%</span>
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </ReferenceGroup>
          )}
        </div>
      )}
    </div>
  );
}

function ReferenceGroup({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-skin-base">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}
