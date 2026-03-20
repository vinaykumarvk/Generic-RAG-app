import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Hash, ExternalLink } from "lucide-react";

interface Citation {
  citation_index: number;
  document_title: string;
  page_number: number | null;
  excerpt: string;
  relevance_score: number;
}

interface ReferencesSectionProps {
  citations: Citation[];
  renumberMap?: Record<number, number>;
  showInlineCitations?: boolean;
  onToggleInline?: () => void;
  onCitationClick?: (citation: Citation) => void;
}

export function ReferencesSection({
  citations,
  renumberMap,
  showInlineCitations,
  onToggleInline,
  onCitationClick,
}: ReferencesSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!citations || citations.length === 0) return null;

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
          {citations.length} reference{citations.length > 1 ? "s" : ""}
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
        <ol className="mt-2 space-y-2 list-none pl-0">
          {sorted.map((citation) => {
            const displayIndex = renumberMap?.[citation.citation_index] ?? citation.citation_index;
            return (
              <li key={citation.citation_index}>
                <button
                  type="button"
                  onClick={() => onCitationClick?.(citation)}
                  className="flex items-start gap-2.5 w-full text-left p-2.5 rounded-lg border border-skin hover:border-primary-300 hover:bg-primary-50/50 transition-colors group"
                >
                  {/* Number badge */}
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
      )}
    </div>
  );
}
