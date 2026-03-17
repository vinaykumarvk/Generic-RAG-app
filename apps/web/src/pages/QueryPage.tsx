import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { ChatPanel } from "@/components/conversation/ChatPanel";
import { MessageSquare, Plus } from "lucide-react";

interface ConversationSummary {
  conversation_id: string;
  title: string;
  preset: string;
  message_count: number;
  updated_at: string;
}

export function QueryPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [activeConversation, setActiveConversation] = useState<string | null>(null);

  const { data: conversations } = useQuery({
    queryKey: ["conversations", workspaceId],
    queryFn: () =>
      apiFetch<{ conversations: ConversationSummary[] }>(
        `/api/v1/workspaces/${workspaceId}/conversations`
      ).then((r) => r.conversations),
    enabled: !!workspaceId,
  });

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Conversation sidebar */}
      <div className="w-64 bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
        <div className="p-3 border-b border-gray-100">
          <button
            onClick={() => setActiveConversation(null)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
          >
            <Plus size={16} />
            New conversation
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations?.map((conv) => (
            <button
              key={conv.conversation_id}
              onClick={() => setActiveConversation(conv.conversation_id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeConversation === conv.conversation_id
                  ? "bg-primary-50 text-primary-700"
                  : "hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-gray-400 shrink-0" />
                <span className="truncate font-medium">{conv.title || "Untitled"}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {conv.message_count} messages
              </div>
            </button>
          ))}
          {conversations?.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No conversations yet</p>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden">
        <ChatPanel
          workspaceId={workspaceId!}
          conversationId={activeConversation}
          onConversationCreated={setActiveConversation}
        />
      </div>
    </div>
  );
}
