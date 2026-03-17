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
    <div className="border-t border-gray-200 bg-gray-50 p-4 max-h-64 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">Citations</h4>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>
      <div className="space-y-2">
        {citations.map((c) => (
          <div key={c.citation_index} className="bg-white p-3 rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-primary-600">[{c.citation_index}]</span>
              <FileText size={12} className="text-gray-400" />
              <span className="text-xs font-medium text-gray-700">{c.document_title}</span>
              {c.page_number && (
                <span className="text-xs text-gray-400">p. {c.page_number}</span>
              )}
              <span className="text-xs text-gray-400 ml-auto">
                {(c.relevance_score * 100).toFixed(0)}% relevant
              </span>
            </div>
            <p className="text-xs text-gray-600 line-clamp-3">{c.excerpt}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
