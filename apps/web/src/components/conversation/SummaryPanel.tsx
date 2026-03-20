import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/lib/api";
import { MarkdownContent } from "./MarkdownContent";
import { TranslateDropdown } from "./TranslateDropdown";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { downloadAnswerAsPdf } from "@/lib/pdf-export";
import { Copy, Check, Download, RefreshCw, FileText } from "lucide-react";

interface SummaryData {
  summary_id: string;
  content: string;
  model_provider?: string;
  model_id?: string;
  latency_ms?: number;
  created_at: string;
  updated_at: string;
}

interface SummaryPanelProps {
  workspaceId: string;
  conversationId: string;
}

export function SummaryPanel({ workspaceId, conversationId }: SummaryPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["summary", conversationId],
    queryFn: () =>
      apiFetch<{ summary: SummaryData | null }>(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/summary`
      ),
    enabled: !!conversationId,
  });

  const generateMutation = useMutation({
    mutationFn: (force: boolean) =>
      apiPost<{ summary: SummaryData }>(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/summary`,
        { force }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["summary", conversationId] });
      setShowOverwriteConfirm(false);
    },
  });

  const summary = data?.summary;

  const handleCopy = async () => {
    if (!summary) return;
    await navigator.clipboard.writeText(summary.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = () => {
    if (summary) {
      setShowOverwriteConfirm(true);
    } else {
      generateMutation.mutate(false);
    }
  };

  const handleDownload = () => {
    if (!summary) return;
    downloadAnswerAsPdf(summary.content, [], "Conversation Summary");
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8" role="status">
        <div className="flex items-center gap-2 text-skin-muted text-sm">
          <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          Loading summary...
        </div>
        <span className="sr-only">Loading summary</span>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-skin-muted">
        <FileText size={48} className="mb-4" aria-hidden="true" />
        <h3 className="text-lg font-medium">No Summary Yet</h3>
        <p className="text-sm mt-1 mb-4">Generate an AI summary of this conversation</p>
        <button type="button" onClick={() => generateMutation.mutate(false)} disabled={generateMutation.isPending} className="btn-primary">
          {generateMutation.isPending ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            "Generate Summary"
          )}
        </button>
        {generateMutation.error && (
          <p className="text-xs text-danger mt-2">{generateMutation.error.message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-surface-alt rounded-xl p-4">
          <MarkdownContent content={summary.content} />
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {summary.model_provider && (
            <span className="text-xs text-skin-muted px-1.5 py-0.5 bg-surface rounded">
              {summary.model_provider}{summary.model_id ? `/${summary.model_id}` : ""}
            </span>
          )}
          {summary.latency_ms && (
            <span className="text-xs text-skin-muted">{summary.latency_ms}ms</span>
          )}

          <div className="flex-1" />

          <TranslateDropdown workspaceId={workspaceId} sourceType="summary" sourceId={summary.summary_id} />

          <button type="button" onClick={handleCopy} className="p-1 rounded hover:bg-surface text-skin-muted hover:text-skin-base transition-colors" aria-label="Copy summary">
            {copied ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </button>

          <button type="button" onClick={handleDownload} className="p-1 rounded hover:bg-surface text-skin-muted hover:text-skin-base transition-colors" aria-label="Download summary as PDF">
            <Download size={14} aria-hidden="true" />
          </button>

          <button type="button" onClick={handleRegenerate} disabled={generateMutation.isPending} className="p-1 rounded hover:bg-surface text-skin-muted hover:text-skin-base disabled:opacity-50 transition-colors" aria-label="Regenerate summary">
            {generateMutation.isPending ? (
              <div className="w-3.5 h-3.5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
          </button>
        </div>

        {generateMutation.error && (
          <p className="text-xs text-danger mt-2">{generateMutation.error.message}</p>
        )}
      </div>

      {showOverwriteConfirm && (
        <ConfirmDialog
          title="Overwrite summary"
          message="A summary was generated previously. Do you wish to overwrite it with a new one?"
          confirmLabel="Overwrite summary"
          variant="default"
          onConfirm={() => generateMutation.mutate(true)}
          onCancel={() => setShowOverwriteConfirm(false)}
        />
      )}
    </div>
  );
}
