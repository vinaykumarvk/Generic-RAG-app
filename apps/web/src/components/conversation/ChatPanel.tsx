import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiFetch } from "@/lib/api";
import { PresetSelector } from "./PresetSelector";
import { MarkdownContent } from "./MarkdownContent";
import { ReferencesSection } from "./ReferencesSection";
import { DocumentPreviewModal } from "./DocumentPreviewModal";
import { SummaryPanel } from "./SummaryPanel";
import { TranslateDropdown } from "./TranslateDropdown";
import { AnswerJourneyPanel } from "./AnswerJourneyPanel";
import { usePreferences } from "@/hooks/usePreferences";
import {
  Send, Bot, User, ThumbsUp, ThumbsDown, Copy, Check,
  RefreshCw, Cpu, Zap, Filter, Download, MessageSquare, FileText,
  GitBranch,
} from "lucide-react";
import { downloadAnswerAsPdf } from "@/lib/pdf-export";

interface Citation {
  citation_index: number;
  document_title: string;
  page_number: number | null;
  excerpt: string;
  relevance_score: number;
}

interface Message {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  retrieval_run_id?: string | null;
  citations?: Citation[];
  model_provider?: string;
  model_id?: string;
  latency_ms?: number;
}

interface QueryResult {
  answer: string;
  conversationId: string;
  messageId: string;
  retrieval_run_id?: string;
  citations: Citation[];
  model_provider?: string;
  model_id?: string;
  title?: string;
  follow_up_questions?: string[];
  retrieval: {
    preset: string;
    total_latency_ms: number;
    cache_hit: boolean;
    chunks_retrieved: number;
    retrieval_mode?: string;
    inferred_filters?: Record<string, unknown>;
  };
}

function buildRenumberMap(citations: Citation[]): Record<number, number> {
  const sorted = [...citations].sort((a, b) => a.citation_index - b.citation_index);
  const map: Record<number, number> = {};
  sorted.forEach((c, i) => { map[c.citation_index] = i + 1; });
  return map;
}

interface ChatPanelProps {
  workspaceId: string;
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
}

export function ChatPanel({ workspaceId, conversationId, onConversationCreated }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const { prefs } = usePreferences();
  const [preset, setPreset] = useState<"concise" | "balanced" | "detailed">(prefs.defaultPreset);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewCitation, setPreviewCitation] = useState<Citation | null>(null);
  const [showInlineCitations, setShowInlineCitations] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [regeneratingMsgId, setRegeneratingMsgId] = useState<string | null>(null);
  const [hiddenMsgIds, setHiddenMsgIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"conversation" | "summary">("conversation");
  const [journeyMessageId, setJourneyMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  const { data: conversation, isLoading: conversationLoading } = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => apiFetch<{ messages: Message[] }>(`/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`),
    enabled: !!conversationId,
  });

  const messages = conversation?.messages || [];

  const [mode, setMode] = useState<"hybrid" | "vector_only" | "metadata_only" | "graph_only">("hybrid");

  const queryMutation = useMutation({
    mutationFn: ({ question, regenerate }: { question: string; regenerate?: boolean }) =>
      apiPost<QueryResult>(`/api/v1/workspaces/${workspaceId}/query`, {
        question,
        conversation_id: conversationId,
        preset,
        mode,
        regenerate: regenerate || undefined,
      }),
    onSuccess: (result) => {
      setPendingQuestion(null);
      setRegeneratingMsgId(null);
      setJourneyMessageId(null);
      if (!conversationId) {
        onConversationCreated(result.conversationId);
      }
      qc.invalidateQueries({ queryKey: ["conversation", result.conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: () => {
      setPendingQuestion(null);
      // Un-hide the old message if regeneration failed
      if (regeneratingMsgId) {
        setHiddenMsgIds((prev) => { const next = new Set(prev); next.delete(regeneratingMsgId); return next; });
        setRegeneratingMsgId(null);
      }
    },
  });

  // Show answer from mutation result until server refetch catches up
  const lastResult = queryMutation.data;
  const showOptimisticAnswer = lastResult && !queryMutation.isPending &&
    !messages.some((m) => m.message_id === lastResult.messageId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, queryMutation.isPending, pendingQuestion, showOptimisticAnswer]);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 5 * 24; // ~5 lines
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, []);

  useEffect(() => { adjustTextareaHeight(); }, [input, adjustTextareaHeight]);

  const handleSend = () => {
    if (!input.trim() || queryMutation.isPending) return;
    const q = input.trim();
    setPendingQuestion(q);
    queryMutation.mutate({ question: q });
    setInput("");
  };

  // FR-021/AC-03: Enter or Ctrl+Enter sends message (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = async (messageId: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(messageId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  /** Regenerate a specific assistant message — finds its preceding user question, hides the old answer, replaces in-place */
  const handleRegenerate = (assistantMsgId: string) => {
    if (queryMutation.isPending) return;
    // Find the user question that preceded this assistant message
    const msgIndex = messages.findIndex((m) => m.message_id === assistantMsgId);
    let question = "";
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === "user") { question = messages[i].content; break; }
    }
    if (!question) return;

    setRegeneratingMsgId(assistantMsgId);
    setHiddenMsgIds((prev) => new Set(prev).add(assistantMsgId));
    queryMutation.mutate({ question, regenerate: true });
  };

  const [feedbackOpen, setFeedbackOpen] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  // FR-019: 3-level feedback (HELPFUL, PARTIALLY_HELPFUL, NOT_HELPFUL)
  const handleFeedback = async (messageId: string, level: "HELPFUL" | "PARTIALLY_HELPFUL" | "NOT_HELPFUL") => {
    setFeedbackOpen(messageId);
    try {
      await apiPost(`/api/v1/workspaces/${workspaceId}/feedback`, {
        message_id: messageId,
        conversation_id: conversationId,
        feedback_level: level,
        feedback_text: feedbackText || undefined,
      });
    } catch {
      // Non-critical
    }
  };

  const handleFeedbackSubmit = async (messageId: string) => {
    if (!feedbackText.trim()) return;
    try {
      await apiPost(`/api/v1/workspaces/${workspaceId}/feedback`, {
        message_id: messageId,
        conversation_id: conversationId,
        feedback_type: "TEXT",
        feedback_text: feedbackText,
      });
    } catch {
      // Non-critical
    }
    setFeedbackText("");
    setFeedbackOpen(null);
  };

  const handleFollowUp = (question: string) => {
    setInput(question);
    setPendingQuestion(question);
    queryMutation.mutate({ question });
  };

  const toggleJourney = (messageId: string) => {
    setJourneyMessageId((prev) => prev === messageId ? null : messageId);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — only shown when a conversation has messages */}
      {conversationId && messages.length > 0 && (
        <div className="border-b border-skin px-4" role="tablist" aria-label="Conversation tabs">
          <button type="button" role="tab" aria-selected={activeTab === "conversation"} onClick={() => setActiveTab("conversation")} className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "conversation" ? "border-primary-600 text-primary-600" : "border-transparent text-skin-muted hover:text-skin-base"}`}>
            <MessageSquare size={14} aria-hidden="true" />
            Conversation
          </button>
          <button type="button" role="tab" aria-selected={activeTab === "summary"} onClick={() => setActiveTab("summary")} className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "summary" ? "border-primary-600 text-primary-600" : "border-transparent text-skin-muted hover:text-skin-base"}`}>
            <FileText size={14} aria-hidden="true" />
            Summary
          </button>
        </div>
      )}

      {/* Summary tab */}
      {activeTab === "summary" && conversationId ? (
        <SummaryPanel workspaceId={workspaceId} conversationId={conversationId} />
      ) : (
      <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Skeleton loader while conversation messages are loading */}
        {conversationLoading && conversationId && (
          <div className="space-y-4" aria-label="Loading messages" role="status">
            {[...Array(3)].map((_, i) => (
              <div key={i} className={`flex gap-2 sm:gap-3 ${i % 2 === 0 ? "" : "justify-end"}`}>
                {i % 2 === 0 && (
                  <div className="hidden sm:block w-8 h-8 rounded-full bg-surface-alt animate-pulse shrink-0" />
                )}
                <div className={`max-w-[88%] sm:max-w-[70%] ${i % 2 === 0 ? "space-y-2" : ""}`}>
                  <div className={`rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 animate-pulse ${
                    i % 2 === 0
                      ? "bg-surface-alt rounded-bl-md"
                      : "bg-primary-100 rounded-br-md"
                  }`}>
                    <div className="h-3 bg-surface rounded w-full mb-2" />
                    <div className="h-3 bg-surface rounded w-3/4" />
                    {i % 2 === 0 && <div className="h-3 bg-surface rounded w-1/2 mt-2" />}
                  </div>
                </div>
                {i % 2 !== 0 && (
                  <div className="hidden sm:block w-8 h-8 rounded-full bg-surface-alt animate-pulse shrink-0" />
                )}
              </div>
            ))}
            <span className="sr-only">Loading conversation messages</span>
          </div>
        )}

        {messages.length === 0 && !queryMutation.isPending && !conversationLoading && (
          <div className="flex flex-col items-center justify-center h-full text-skin-muted">
            <Bot size={48} className="mb-4" aria-hidden="true" />
            <h3 className="text-lg font-medium text-skin-muted">Ask a question</h3>
            <p className="text-sm mt-1">Your documents will be searched for relevant answers</p>
          </div>
        )}

        {messages.filter((m) => !hiddenMsgIds.has(m.message_id)).map((msg) => (
          <div key={msg.message_id} className={`flex gap-2 sm:gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="hidden sm:flex w-8 h-8 rounded-full bg-primary-100 items-center justify-center shrink-0">
                <Bot size={16} className="text-primary-600" aria-hidden="true" />
              </div>
            )}
            <div className={`max-w-[88%] sm:max-w-[70%] ${msg.role === "user"
              ? "bg-brand text-on-brand rounded-2xl rounded-br-md px-3 py-2 sm:px-4"
              : "bg-surface-alt rounded-2xl rounded-bl-md px-3 py-2.5 sm:px-4 sm:py-3"
            }`}>
              {msg.role === "assistant" ? (
                <MarkdownContent
                  content={msg.content}
                  citationMap={msg.citations ? buildRenumberMap(msg.citations) : undefined}
                  showInlineCitations={showInlineCitations}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              )}

              {/* Assistant metadata and actions */}
              {msg.role === "assistant" && (
                <>
                  {/* References */}
                  {msg.citations && msg.citations.length > 0 && (
                    <ReferencesSection
                      citations={msg.citations}
                      renumberMap={buildRenumberMap(msg.citations)}
                      showInlineCitations={showInlineCitations}
                      onToggleInline={() => setShowInlineCitations(prev => !prev)}
                      onCitationClick={(c) => setPreviewCitation(c)}
                    />
                  )}

                  {/* Badges + actions row */}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {/* Model badge */}
                    {msg.model_provider && (
                      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-surface text-skin-muted">
                        <Cpu size={10} aria-hidden="true" />
                        {msg.model_provider}{msg.model_id ? `/${msg.model_id}` : ""}
                      </span>
                    )}

                    {/* Cached badge */}
                    {queryMutation.data?.retrieval?.cache_hit && msg.message_id === queryMutation.data?.messageId && (
                      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-surface text-skin-muted">
                        <Zap size={10} aria-hidden="true" />
                        Cached
                      </span>
                    )}

                    {/* Latency */}
                    {msg.latency_ms && (
                      <span className="text-xs text-skin-muted">{msg.latency_ms}ms</span>
                    )}

                    <div className="flex-1" />

                    {/* FR-019: Thumbs up / down feedback */}
                    <button
                      type="button"
                      onClick={() => handleFeedback(msg.message_id, "HELPFUL")}
                      className="p-2.5 rounded hover:bg-surface text-skin-muted hover-text-success transition-colors min-h-[2.75rem] min-w-[2.75rem] flex items-center justify-center"
                      aria-label="Helpful"
                    >
                      <ThumbsUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback(msg.message_id, "NOT_HELPFUL")}
                      className="p-2.5 rounded hover:bg-surface text-skin-muted hover-text-danger transition-colors min-h-[2.75rem] min-w-[2.75rem] flex items-center justify-center"
                      aria-label="Not helpful"
                    >
                      <ThumbsDown size={14} aria-hidden="true" />
                    </button>

                    {/* Copy */}
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.message_id, msg.content)}
                      className="p-2.5 rounded hover:bg-surface text-skin-muted hover:text-skin-base transition-colors min-h-[2.75rem] min-w-[2.75rem] flex items-center justify-center"
                      aria-label="Copy to clipboard"
                    >
                      {copiedId === msg.message_id ? (
                        <Check size={14} className="text-success" aria-hidden="true" />
                      ) : (
                        <Copy size={14} aria-hidden="true" />
                      )}
                    </button>

                    {/* Translate */}
                    <TranslateDropdown
                      workspaceId={workspaceId}
                      sourceType="message"
                      sourceId={msg.message_id}
                    />

                    {/* Download as PDF */}
                    <button
                      type="button"
                      onClick={() => {
                        const map = buildRenumberMap(msg.citations || []);
                        downloadAnswerAsPdf(
                          msg.content,
                          (msg.citations || [])
                            .sort((a, b) => a.citation_index - b.citation_index)
                            .map((c) => ({
                              displayIndex: map[c.citation_index] ?? c.citation_index,
                              document_title: c.document_title,
                              page_number: c.page_number,
                              excerpt: c.excerpt,
                            })),
                        );
                      }}
                      className="p-2.5 rounded hover:bg-surface text-skin-muted hover:text-skin-base transition-colors min-h-[2.75rem] min-w-[2.75rem] flex items-center justify-center"
                      aria-label="Download as PDF"
                    >
                      <Download size={14} aria-hidden="true" />
                    </button>

                    {(msg.retrieval_run_id || msg.role === "assistant") && (
                      <button
                        type="button"
                        onClick={() => toggleJourney(msg.message_id)}
                        className={`p-2.5 rounded transition-colors min-h-[2.75rem] min-w-[2.75rem] flex items-center justify-center ${
                          journeyMessageId === msg.message_id
                            ? "bg-primary-100 text-primary-700"
                            : "hover:bg-surface text-skin-muted hover:text-skin-base"
                        }`}
                        aria-label={journeyMessageId === msg.message_id ? "Hide answer journey" : "Show answer journey"}
                      >
                        <GitBranch size={14} aria-hidden="true" />
                      </button>
                    )}

                    {/* Regenerate */}
                    <button
                      type="button"
                      onClick={() => handleRegenerate(msg.message_id)}
                      disabled={queryMutation.isPending}
                      className="p-2.5 rounded hover:bg-surface text-skin-muted hover:text-skin-base disabled:opacity-50 transition-colors min-h-[2.75rem] min-w-[2.75rem] flex items-center justify-center"
                      aria-label="Regenerate answer"
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                    </button>
                  </div>

                  {/* FR-018/AC-05: Optional feedback text input */}
                  {feedbackOpen === msg.message_id && (
                    <div className="mt-2 space-y-1.5">
                      <textarea
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        placeholder="Tell us more about this answer (optional)..."
                        rows={2}
                        className="w-full text-xs px-3 py-2 border border-skin rounded-lg bg-surface text-skin-base resize-none focus:ring-1 focus:ring-primary-500 outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleFeedbackSubmit(msg.message_id)}
                          className="text-xs px-3 py-1 bg-brand text-on-brand rounded-md hover:bg-brand-hover"
                        >
                          Submit
                        </button>
                        <button
                          type="button"
                          onClick={() => { setFeedbackOpen(null); setFeedbackText(""); }}
                          className="text-xs px-3 py-1 text-skin-muted hover:text-skin-base"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}

                  {journeyMessageId === msg.message_id && (
                    <AnswerJourneyPanel
                      workspaceId={workspaceId}
                      messageId={msg.message_id}
                    />
                  )}
                </>
              )}
            </div>
            {msg.role === "user" && (
              <div className="hidden sm:flex w-8 h-8 rounded-full bg-surface-alt items-center justify-center shrink-0">
                <User size={16} className="text-skin-muted" aria-hidden="true" />
              </div>
            )}
          </div>
        ))}

        {/* Optimistic user message — visible immediately while waiting for response (hidden during regeneration) */}
        {pendingQuestion && !regeneratingMsgId && (
          <div className="flex gap-2 sm:gap-3 justify-end">
            <div className="max-w-[88%] sm:max-w-[70%] bg-brand text-on-brand rounded-2xl rounded-br-md px-3 py-2 sm:px-4">
              <p className="text-sm whitespace-pre-wrap">{pendingQuestion}</p>
            </div>
            <div className="hidden sm:flex w-8 h-8 rounded-full bg-surface-alt items-center justify-center shrink-0">
              <User size={16} className="text-skin-muted" aria-hidden="true" />
            </div>
          </div>
        )}

        {/* Loading indicator — animated dots with label */}
        {queryMutation.isPending && (
          <div className="flex gap-2 sm:gap-3">
            <div className="hidden sm:flex w-8 h-8 rounded-full bg-primary-100 items-center justify-center">
              <Bot size={16} className="text-primary-600" aria-hidden="true" />
            </div>
            <div className="max-w-[88%] sm:max-w-[70%] bg-surface-alt rounded-2xl rounded-bl-md px-3 py-2.5 sm:px-4 sm:py-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-xs text-skin-muted">Generating answer...</span>
              </div>
            </div>
          </div>
        )}

        {/* Optimistic assistant answer — shown from mutation result before server refetch */}
        {showOptimisticAnswer && lastResult && (
          <div className="flex gap-2 sm:gap-3">
            <div className="hidden sm:flex w-8 h-8 rounded-full bg-primary-100 items-center justify-center shrink-0">
              <Bot size={16} className="text-primary-600" aria-hidden="true" />
            </div>
            <div className="max-w-[88%] sm:max-w-[70%] bg-surface-alt rounded-2xl rounded-bl-md px-3 py-2.5 sm:px-4 sm:py-3">
              <MarkdownContent
                content={lastResult.answer}
                citationMap={lastResult.citations ? buildRenumberMap(lastResult.citations) : undefined}
                showInlineCitations={showInlineCitations}
              />
              {lastResult.citations && lastResult.citations.length > 0 && (
                <ReferencesSection
                  citations={lastResult.citations}
                  renumberMap={buildRenumberMap(lastResult.citations)}
                  showInlineCitations={showInlineCitations}
                  onToggleInline={() => setShowInlineCitations(prev => !prev)}
                  onCitationClick={(c) => setPreviewCitation(c)}
                />
              )}
            </div>
          </div>
        )}

        {/* Follow-up suggestion chips */}
        {lastResult?.follow_up_questions && lastResult.follow_up_questions.length > 0 && !queryMutation.isPending && (
          <div className="flex flex-wrap gap-2 pl-0 sm:pl-11">
            {lastResult.follow_up_questions.map((q, i) => (
              <button type="button" key={i} onClick={() => handleFollowUp(q)} className="text-xs px-3 py-1.5 rounded-full border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors">
                {q}
              </button>
            ))}
          </div>
        )}

        {queryMutation.error && (
          <div className="bg-surface-alt text-skin-base border-l-4 border-danger text-sm px-4 py-2 rounded-lg">
            {queryMutation.error.message}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Document preview modal */}
      {previewCitation && (
        <DocumentPreviewModal
          documentTitle={previewCitation.document_title}
          pageNumber={previewCitation.page_number}
          excerpt={previewCitation.excerpt}
          onClose={() => setPreviewCitation(null)}
        />
      )}

      {/* Input */}
      <div className="border-t border-skin p-4 sticky bottom-0 bg-surface pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* FR-014: Interpreted scope / inferred filters display */}
        {queryMutation.data?.retrieval?.inferred_filters &&
         Object.keys(queryMutation.data.retrieval.inferred_filters).length > 0 && (
          <div className="flex items-center gap-2 mb-2 text-xs text-skin-muted flex-wrap">
            <Filter size={12} className="shrink-0" aria-hidden="true" />
            <span>Inferred:</span>
            {Object.entries(queryMutation.data.retrieval.inferred_filters).map(([key, val]) => (
              <span key={key} className="px-1.5 py-0.5 bg-surface text-primary-500 rounded text-xs">
                {key}: {String(val)}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          <PresetSelector value={preset} onChange={setPreset} />
          {/* FR-014: Retrieval mode selector */}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            className="text-xs px-2 py-1 border border-skin rounded-lg bg-surface text-skin-base"
            aria-label="Retrieval mode"
          >
            <option value="hybrid">Hybrid</option>
            <option value="vector_only">Vector only</option>
            <option value="metadata_only">Metadata only</option>
            <option value="graph_only">Graph only</option>
          </select>
        </div>
        <div className="flex gap-2 items-end">
          {/* Auto-expanding textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documents..."
            rows={1}
            className="flex-1 px-4 py-2 border border-skin rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm bg-surface text-skin-base resize-none overflow-hidden"
            disabled={queryMutation.isPending}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || queryMutation.isPending}
            className="btn-primary shrink-0"
            aria-label="Send message"
          >
            <Send size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
