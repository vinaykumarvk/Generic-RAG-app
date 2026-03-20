import { X, FileText } from "lucide-react";

interface Citation {
  citation_index: number;
  document_title: string;
  page_number: number | null;
  excerpt: string;
  relevance_score: number;
}

interface CitationPanelProps {
  citations: Citation[];
  onClose: () => void;
}

export function CitationPanel({ citations, onClose }: CitationPanelProps) {
  return (
    <div className="border-t border-skin bg-surface-alt p-4 max-h-64 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-skin-base">Citations</h4>
        <button type="button" onClick={onClose} className="text-skin-muted hover:text-skin-base" aria-label="Close citations">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-2">
        {citations.map((c) => (
          <div key={c.citation_index} className="bg-surface p-3 rounded-lg border border-skin">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-primary-600">[{c.citation_index}]</span>
              <FileText size={12} className="text-skin-muted" aria-hidden="true" />
              <span className="text-xs font-medium text-skin-base">{c.document_title}</span>
              {c.page_number && (
                <span className="text-xs text-skin-muted">p. {c.page_number}</span>
              )}
              <span className="text-xs text-skin-muted ml-auto">
                {(c.relevance_score * 100).toFixed(0)}% relevant
              </span>
            </div>
            <p className="text-xs text-skin-muted line-clamp-3">{c.excerpt}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
