import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiFetch } from "@/lib/api";
import { PresetSelector } from "./PresetSelector";
import { CitationPanel } from "./CitationPanel";
import { Send, Loader2, Bot, User } from "lucide-react";

interface Message {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Array<{
    citation_index: number;
    document_title: string;
    page_number: number | null;
    excerpt: string;
    relevance_score: number;
  }>;
  latency_ms?: number;
}

interface QueryResult {
  answer: string;
  conversation_id: string;
  message_id: string;
  citations: Array<{
    citation_index: number;
    document_title: string;
    page_number: number | null;
    excerpt: string;
    relevance_score: number;
  }>;
  retrieval: {
    preset: string;
    total_latency_ms: number;
    cache_hit: boolean;
    chunks_retrieved: number;
  };
}

interface ChatPanelProps {
  workspaceId: string;
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
}

export function ChatPanel({ workspaceId, conversationId, onConversationCreated }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [preset, setPreset] = useState<"concise" | "balanced" | "detailed">("balanced");
  const [selectedCitations, setSelectedCitations] = useState<Message["citations"]>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: conversation } = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => apiFetch<{ messages: Message[] }>(`/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`),
    enabled: !!conversationId,
  });

  const messages = conversation?.messages || [];

  const queryMutation = useMutation({
    mutationFn: (question: string) =>
      apiPost<QueryResult>(`/api/v1/workspaces/${workspaceId}/query`, {
        question,
        conversation_id: conversationId,
        preset,
      }),
    onSuccess: (result) => {
      if (!conversationId) {
        onConversationCreated(result.conversation_id);
      }
      qc.invalidateQueries({ queryKey: ["conversation", result.conversation_id] });
      qc.invalidateQueries({ queryKey: ["conversations", workspaceId] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, queryMutation.isPending]);

  const handleSend = () => {
    if (!input.trim() || queryMutation.isPending) return;
    queryMutation.mutate(input.trim());
    setInput("");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !queryMutation.isPending && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Bot size={48} className="mb-4" />
            <h3 className="text-lg font-medium text-gray-600">Ask a question</h3>
            <p className="text-sm mt-1">Your documents will be searched for relevant answers</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.message_id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                <Bot size={16} className="text-primary-600" />
              </div>
            )}
            <div className={`max-w-[70%] ${msg.role === "user"
              ? "bg-primary-600 text-white rounded-2xl rounded-br-md px-4 py-2"
              : "bg-gray-50 rounded-2xl rounded-bl-md px-4 py-3"
            }`}>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              {msg.citations && msg.citations.length > 0 && (
                <button
                  onClick={() => setSelectedCitations(msg.citations)}
                  className="text-xs text-primary-600 mt-2 hover:underline"
                >
                  {msg.citations.length} citation{msg.citations.length > 1 ? "s" : ""}
                </button>
              )}
              {msg.latency_ms && (
                <span className="text-xs text-gray-400 mt-1 block">{msg.latency_ms}ms</span>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                <User size={16} className="text-gray-600" />
              </div>
            )}
          </div>
        ))}

        {queryMutation.isPending && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
              <Loader2 size={16} className="text-primary-600 animate-spin" />
            </div>
            <div className="bg-gray-50 rounded-2xl rounded-bl-md px-4 py-3">
              <p className="text-sm text-gray-500">Searching documents and generating answer...</p>
            </div>
          </div>
        )}

        {queryMutation.error && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-lg">
            {queryMutation.error.message}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Citation panel */}
      {selectedCitations && (
        <CitationPanel citations={selectedCitations} onClose={() => setSelectedCitations(undefined)} />
      )}

      {/* Input */}
      <div className="border-t border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-2">
          <PresetSelector value={preset} onChange={setPreset} />
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Ask a question about your documents..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
            disabled={queryMutation.isPending}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || queryMutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            aria-label="Send message"
          >
            <Send size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
