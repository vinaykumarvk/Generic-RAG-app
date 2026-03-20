import { useState, useCallback, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiFetch, apiDelete, apiPatch } from "@/lib/api";
import { ChatPanel } from "@/components/conversation/ChatPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useDebounce } from "@/hooks/useDebounce";
import { formatRelativeTime } from "@/lib/time";
import { MessageSquare, Plus, Trash2, Pin, PinOff, Search, X, Archive, ArchiveRestore, Pencil, Download, MoreVertical, ArrowLeft } from "lucide-react";
import { downloadConversationAsPdf } from "@/lib/pdf-export";

interface ConversationSummary {
  conversation_id: string;
  title: string;
  preset: string;
  message_count: number;
  is_pinned?: boolean;
  is_archived?: boolean;
  updated_at: string;
}

export function QueryPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showMobileList, setShowMobileList] = useState(true);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const menuRef = useRef<HTMLDivElement>(null);
  const debouncedSearch = useDebounce(searchTerm, 300);
  const qc = useQueryClient();

  // Track mobile breakpoint
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Close 3-dot menu on outside click or Escape
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpenId(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpenId]);

  const { data: conversations } = useQuery({
    queryKey: ["conversations", workspaceId, showArchived],
    queryFn: () =>
      apiFetch<{ conversations: ConversationSummary[] }>(
        `/api/v1/workspaces/${workspaceId}/conversations${showArchived ? "?archived=true" : ""}`
      ).then((r) => r.conversations),
    enabled: !!workspaceId,
  });

  // Filter: exclude locally deleted, apply search, sort pinned first
  const filtered = (conversations || [])
    .filter((c) => !deletedIds.has(c.conversation_id))
    .filter((c) => {
      if (!debouncedSearch) return true;
      return (c.title || "").toLowerCase().includes(debouncedSearch.toLowerCase());
    })
    .sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return 0;
    });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/workspaces/${workspaceId}/conversations/${id}`),
    onSuccess: (_data, deletedId) => {
      // Remove from local state immediately — no refetch that could repopulate
      setDeletedIds((prev) => new Set(prev).add(deletedId));
      if (activeConversation === deletedId) setActiveConversation(null);
      setDeleteTarget(null);
    },
    onError: () => {
      setDeleteTarget(null);
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiPatch(`/api/v1/workspaces/${workspaceId}/conversations/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const handlePin = (id: string, currentPinned: boolean) => {
    patchMutation.mutate({ id, body: { is_pinned: !currentPinned } });
  };

  // FR-013: Archive/reopen conversation
  const handleArchive = (id: string, currentArchived: boolean) => {
    patchMutation.mutate({ id, body: { is_archived: !currentArchived } });
  };

  const handleRename = (id: string) => {
    if (editTitle.trim()) {
      patchMutation.mutate({ id, body: { title: editTitle.trim() } });
    }
    setEditingId(null);
  };

  const truncate = (s: string, len: number) => s.length > len ? s.slice(0, len) + "..." : s;

  const handleSelectConversation = (id: string) => {
    setActiveConversation(id);
    if (isMobile) setShowMobileList(false);
  };

  const handleNewConversation = () => {
    setActiveConversation(null);
    if (isMobile) setShowMobileList(false);
  };

  // On mobile: show list OR chat, never both
  const showList = !isMobile || showMobileList;
  const showChat = !isMobile || !showMobileList;

  return (
    <div className="flex h-[calc(100dvh-8rem)] gap-0 md:gap-4">
      {/* Conversation sidebar */}
      {showList && (
      <div className={`bg-surface border border-skin rounded-xl overflow-hidden flex flex-col ${isMobile ? "w-full" : "w-64"}`}>
        <div className="p-3 border-b border-skin space-y-2">
          <button
            type="button"
            onClick={handleNewConversation}
            className="btn-primary btn-primary--full"
          >
            <Plus size={16} aria-hidden="true" />
            New conversation
          </button>
          {/* FR-013: Show archived toggle */}
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              showArchived ? "border-warning-soft surface-warning-soft text-warning" : "border-border-primary text-text-secondary hover:bg-surface-secondary"
            }`}
          >
            <Archive size={12} aria-hidden="true" />
            {showArchived ? "Showing archived" : "Show archived"}
          </button>
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-skin-muted" aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-8 pr-8 py-1.5 text-xs border border-skin rounded-lg bg-surface text-skin-base focus:ring-1 focus:ring-primary-500 outline-none"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-skin-muted hover:text-skin-base"
                aria-label="Clear search"
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.map((conv) => (
            <div
              key={conv.conversation_id}
              className={`group relative rounded-lg transition-colors ${
                activeConversation === conv.conversation_id
                  ? "bg-primary-500/10"
                  : "hover:bg-surface-alt"
              }`}
            >
              <button
                type="button"
                onClick={() => handleSelectConversation(conv.conversation_id)}
                onDoubleClick={() => {
                  setEditingId(conv.conversation_id);
                  setEditTitle(conv.title || "");
                }}
                className={`w-full text-left px-3 py-2 text-sm ${conv.is_archived ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {conv.is_pinned && <Pin size={10} className="text-primary-500 shrink-0" aria-label="Pinned" />}
                  <MessageSquare size={14} className="text-skin-muted shrink-0" aria-hidden="true" />
                  {editingId === conv.conversation_id ? (
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleRename(conv.conversation_id)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRename(conv.conversation_id); }}
                      className="flex-1 text-xs bg-surface border border-skin rounded px-1 py-0.5 outline-none"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="truncate font-medium text-skin-base" title={conv.title || "Untitled"}>
                        {truncate(conv.title || "Untitled", 40)}
                      </span>
                      {/* FR-017/AC-04: Message count badge */}
                      {conv.message_count > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-xs font-medium rounded-full bg-surface text-skin-muted shrink-0">
                          {conv.message_count}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="text-xs text-skin-muted mt-0.5 pl-6">
                  {formatRelativeTime(conv.updated_at)}
                </div>
              </button>
              {/* 3-dot menu */}
              <div className="absolute right-1 top-1.5 z-10" ref={menuOpenId === conv.conversation_id ? menuRef : undefined}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === conv.conversation_id ? null : conv.conversation_id); }}
                  className="p-2 rounded hover:bg-surface-alt text-skin-muted min-h-[2.75rem] min-w-[2.75rem] flex items-center justify-center"
                  aria-label="Conversation options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpenId === conv.conversation_id}
                >
                  <MoreVertical size={14} aria-hidden="true" />
                </button>

                {menuOpenId === conv.conversation_id && (
                  <div role="menu" className="absolute right-0 top-full mt-1 bg-[rgb(var(--color-surface))] border border-border-primary rounded-lg shadow-lg py-1 z-50 min-w-[10rem]">
                    <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); setEditingId(conv.conversation_id); setEditTitle(conv.title || ""); }} className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-surface-alt text-skin-base transition-colors">
                      <Pencil size={12} aria-hidden="true" />
                      Rename
                    </button>
                    <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); handlePin(conv.conversation_id, !!conv.is_pinned); }} className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-surface-alt text-skin-base transition-colors">
                      {conv.is_pinned ? <PinOff size={12} aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}
                      {conv.is_pinned ? "Unpin" : "Pin"}
                    </button>
                    <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); apiFetch<{ messages: Array<{ role: string; content: string; citations?: Array<{ citation_index: number; document_title: string; page_number: number | null; excerpt: string }> }> }>(`/api/v1/workspaces/${workspaceId}/conversations/${conv.conversation_id}`).then((data) => { downloadConversationAsPdf(data.messages, conv.title || "Conversation"); }); }} className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-surface-alt text-skin-base transition-colors">
                      <Download size={12} aria-hidden="true" />
                      Export PDF
                    </button>
                    <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); handleArchive(conv.conversation_id, !!conv.is_archived); }} className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-surface-alt text-skin-base transition-colors">
                      {conv.is_archived ? <ArchiveRestore size={12} aria-hidden="true" /> : <Archive size={12} aria-hidden="true" />}
                      {conv.is_archived ? "Unarchive" : "Archive"}
                    </button>
                    <div className="border-t border-skin my-1" />
                    <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); setDeleteTarget(conv.conversation_id); }} className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover-surface-danger-soft text-danger transition-colors">
                      <Trash2 size={12} aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && conversations && conversations.length > 0 && (
            <p className="text-xs text-skin-muted text-center py-4">No matching conversations</p>
          )}
          {(!conversations || conversations.length === 0) && (
            <p className="text-xs text-skin-muted text-center py-4">No conversations yet</p>
          )}
        </div>
      </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete conversation"
          message="This will permanently delete the conversation and all its messages."
          confirmLabel="Delete conversation"
          variant="danger"
          onConfirm={() => deleteMutation.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Main chat area */}
      {showChat && (
      <div className="flex-1 bg-surface border border-skin rounded-xl overflow-hidden flex flex-col">
        {/* Mobile back button */}
        {isMobile && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-skin">
            <button
              type="button"
              onClick={() => setShowMobileList(true)}
              className="p-2 rounded-lg hover:bg-surface-alt text-skin-muted min-h-[2.75rem] min-w-[2.75rem] flex items-center justify-center"
              aria-label="Back to conversations"
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <span className="text-sm font-medium text-skin-base truncate">
              {activeConversation ? "Conversation" : "New conversation"}
            </span>
          </div>
        )}
        <ChatPanel
          workspaceId={workspaceId!}
          conversationId={activeConversation}
          onConversationCreated={(id) => {
            setActiveConversation(id);
            qc.invalidateQueries({ queryKey: ["conversations"] });
          }}
        />
      </div>
      )}
    </div>
  );
}
