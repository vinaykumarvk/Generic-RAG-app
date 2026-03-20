import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { formatRelativeTime } from "@/lib/time";
import { Search, X, ChevronDown, ChevronRight, MessageSquare } from "lucide-react";

interface Message {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface Conversation {
  conversation_id: string;
  title: string;
  preset: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  messages?: Message[];
}

interface QAHistoryPanelProps {
  workspaceId: string;
}

const PRESET_BADGES: Record<string, string> = {
  concise: "badge-success",
  balanced: "badge-brand",
  detailed: "badge-warning",
};

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function QAHistoryPanel({ workspaceId }: QAHistoryPanelProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debouncedSearch = useDebounce(searchTerm, 300);

  const { data: conversationsData, isLoading, error } = useQuery({
    queryKey: ["qa-history", workspaceId],
    queryFn: () =>
      apiFetch<{ conversations: Conversation[] }>(
        `/api/v1/workspaces/${workspaceId}/conversations`,
      ),
    enabled: !!workspaceId,
  });

  // Fetch expanded conversation details
  const { data: expandedConversation } = useQuery({
    queryKey: ["conversation", expandedId],
    queryFn: () =>
      apiFetch<{ messages: Message[] }>(
        `/api/v1/workspaces/${workspaceId}/conversations/${expandedId}`,
      ),
    enabled: !!expandedId,
  });

  const conversations = conversationsData?.conversations || [];

  // Apply search and date filters
  const filtered = conversations.filter((conv) => {
    // Search filter
    if (debouncedSearch) {
      const lower = debouncedSearch.toLowerCase();
      const matchesTitle = (conv.title || "").toLowerCase().includes(lower);
      if (!matchesTitle) return false;
    }

    // Date range filter
    if (dateFrom) {
      const convDate = new Date(conv.created_at);
      const fromDate = new Date(dateFrom);
      if (convDate < fromDate) return false;
    }
    if (dateTo) {
      const convDate = new Date(conv.created_at);
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      if (convDate > toDate) return false;
    }

    return true;
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // Extract Q&A pairs from messages
  const qaPairs: Array<{ question: string; answer: string }> = [];
  if (expandedConversation?.messages) {
    const msgs = expandedConversation.messages;
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role === "user") {
        const answer = msgs[i + 1]?.role === "assistant" ? msgs[i + 1].content : "";
        qaPairs.push({ question: msgs[i].content, answer });
      }
    }
  }

  // Loading state with skeleton
  if (isLoading) {
    return (
      <div className="bg-surface border border-skin rounded-xl p-5">
        <div className="h-5 bg-surface-alt rounded w-40 mb-4 animate-pulse" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse flex items-center gap-4">
              <div className="h-4 bg-surface-alt rounded flex-1" />
              <div className="h-4 bg-surface-alt rounded w-24" />
              <div className="h-4 bg-surface-alt rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div role="alert" className="surface-danger-soft border border-danger-soft rounded-xl p-4 text-danger text-sm">
        Failed to load Q&amp;A history.
      </div>
    );
  }

  return (
    <div className="bg-surface border border-skin rounded-xl p-5">
      <h3 className="font-semibold text-text-primary mb-4">Q&amp;A History</h3>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[12rem]">
          <label htmlFor="qa-search" className="block text-xs font-medium text-text-secondary mb-1">
            Search
          </label>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary"
              aria-hidden="true"
            />
            <input
              id="qa-search"
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-8 pr-8 py-1.5 text-sm border border-skin rounded-lg bg-surface text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                aria-label="Clear search"
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Date from */}
        <div>
          <label htmlFor="qa-date-from" className="block text-xs font-medium text-text-secondary mb-1">
            From
          </label>
          <input
            id="qa-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-skin rounded-lg bg-surface text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
          />
        </div>

        {/* Date to */}
        <div>
          <label htmlFor="qa-date-to" className="block text-xs font-medium text-text-secondary mb-1">
            To
          </label>
          <input
            id="qa-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-skin rounded-lg bg-surface text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
          />
        </div>

        {/* Clear filters */}
        {(searchTerm || dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm("");
              setDateFrom("");
              setDateTo("");
            }}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-skin rounded-lg hover:bg-surface-alt transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <p className="text-center py-8 text-text-secondary text-sm">
            {conversations.length === 0
              ? "No conversations yet"
              : "No conversations match your filters"}
          </p>
        ) : (
          filtered.map((conv) => (
            <MobileConversationCard
              key={conv.conversation_id}
              conversation={conv}
              isExpanded={expandedId === conv.conversation_id}
              onToggle={() => toggleExpand(conv.conversation_id)}
              qaPairs={expandedId === conv.conversation_id ? qaPairs : []}
            />
          ))
        )}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-skin">
              <th scope="col" className="text-left py-2 px-3 font-medium text-text-secondary text-xs w-8">
                <span className="sr-only">Expand</span>
              </th>
              <th scope="col" className="text-left py-2 px-3 font-medium text-text-secondary text-xs">
                Conversation
              </th>
              <th scope="col" className="text-left py-2 px-3 font-medium text-text-secondary text-xs">
                Messages
              </th>
              <th scope="col" className="text-left py-2 px-3 font-medium text-text-secondary text-xs">
                Date
              </th>
              <th scope="col" className="text-left py-2 px-3 font-medium text-text-secondary text-xs">
                Preset
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-text-secondary text-sm">
                  {conversations.length === 0
                    ? "No conversations yet"
                    : "No conversations match your filters"}
                </td>
              </tr>
            )}
            {filtered.map((conv) => (
              <ConversationRow
                key={conv.conversation_id}
                conversation={conv}
                isExpanded={expandedId === conv.conversation_id}
                onToggle={() => toggleExpand(conv.conversation_id)}
                qaPairs={expandedId === conv.conversation_id ? qaPairs : []}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ConversationRowProps {
  conversation: Conversation;
  isExpanded: boolean;
  onToggle: () => void;
  qaPairs: Array<{ question: string; answer: string }>;
}

function ConversationRow({ conversation, isExpanded, onToggle, qaPairs }: ConversationRowProps) {
  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <>
      <tr
        className="border-b border-skin hover:bg-surface-alt transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="py-2.5 px-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="p-0.5 rounded text-text-secondary hover:text-text-primary transition-colors"
            aria-label={isExpanded ? "Collapse conversation" : "Expand conversation"}
            aria-expanded={isExpanded}
          >
            <ExpandIcon size={14} aria-hidden="true" />
          </button>
        </td>
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-text-secondary shrink-0" aria-hidden="true" />
            <span className="font-medium text-text-primary truncate max-w-[20rem]">
              {conversation.title || "Untitled"}
            </span>
          </div>
        </td>
        <td className="py-2.5 px-3 text-text-secondary">
          {conversation.message_count}
        </td>
        <td className="py-2.5 px-3 text-text-secondary whitespace-nowrap">
          <span title={formatDate(conversation.created_at)}>
            {formatRelativeTime(conversation.created_at)}
          </span>
        </td>
        <td className="py-2.5 px-3">
          <span
            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
              PRESET_BADGES[conversation.preset] || "bg-surface-alt text-text-secondary"
            }`}
          >
            {conversation.preset || "balanced"}
          </span>
        </td>
      </tr>

      {/* Expanded Q&A pairs */}
      {isExpanded && (
        <tr>
          <td colSpan={5} className="bg-surface-alt px-6 py-4">
            <ExpandedQaPairs qaPairs={qaPairs} />
          </td>
        </tr>
      )}
    </>
  );
}

function MobileConversationCard({ conversation, isExpanded, onToggle, qaPairs }: ConversationRowProps) {
  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <article className="border border-skin rounded-xl overflow-hidden bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="w-full p-4 text-left hover:bg-surface-alt transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-start gap-3">
          <ExpandIcon size={16} className="text-text-secondary shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-start gap-2">
              <MessageSquare size={14} className="text-text-secondary shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <div className="font-medium text-text-primary break-words">
                  {conversation.title || "Untitled"}
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="text-text-secondary">Messages</dt>
                <dd className="text-text-primary font-medium mt-0.5">{conversation.message_count}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Date</dt>
                <dd className="text-text-primary font-medium mt-0.5" title={formatDate(conversation.created_at)}>
                  {formatRelativeTime(conversation.created_at)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-text-secondary">Preset</dt>
                <dd className="mt-1">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      PRESET_BADGES[conversation.preset] || "bg-surface-alt text-text-secondary"
                    }`}
                  >
                    {conversation.preset || "balanced"}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="bg-surface-alt px-4 py-4 border-t border-skin">
          <ExpandedQaPairs qaPairs={qaPairs} />
        </div>
      )}
    </article>
  );
}

function ExpandedQaPairs({ qaPairs }: { qaPairs: Array<{ question: string; answer: string }> }) {
  if (qaPairs.length === 0) {
    return (
      <div className="flex items-center justify-center py-3">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" role="status" aria-label="Loading messages" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {qaPairs.map((pair, idx) => (
        <div key={idx} className="space-y-2">
          <div className="flex gap-2">
            <span className="shrink-0 text-xs font-semibold text-primary-600 mt-0.5">Q:</span>
            <p className="text-sm text-text-primary">{pair.question}</p>
          </div>
          <div className="flex gap-2">
            <span className="shrink-0 text-xs font-semibold text-success mt-0.5">A:</span>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">
              {truncateText(pair.answer, 500)}
            </p>
          </div>
          {idx < qaPairs.length - 1 && (
            <hr className="border-skin" />
          )}
        </div>
      ))}
    </div>
  );
}
