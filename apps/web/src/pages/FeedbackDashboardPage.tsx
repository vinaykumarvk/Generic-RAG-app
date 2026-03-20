/**
 * FeedbackDashboardPage — Admin feedback trends, review/resolve UI.
 * FR-019: Feedback management.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPatch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/time";
import {
  ThumbsUp, ThumbsDown, Minus, Loader2,
  MessageSquare, Filter, CheckCircle2,
} from "lucide-react";

interface FeedbackItem {
  feedback_id: string;
  conversation_id: string;
  message_id: string;
  feedback_level: string;
  comment: string | null;
  issue_tags: string[] | null;
  admin_notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  user_name: string;
  created_at: string;
}

interface FeedbackStats {
  total: number;
  helpful: number;
  partially_helpful: number;
  not_helpful: number;
  unresolved: number;
}

export function FeedbackDashboardPage() {
  const qc = useQueryClient();
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [resolvedFilter, setResolvedFilter] = useState<string>("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState("");

  const { data: stats } = useQuery({
    queryKey: ["feedback-stats"],
    queryFn: () => apiFetch<FeedbackStats>("/api/v1/feedback/stats"),
  });

  const params = new URLSearchParams();
  if (levelFilter) params.set("level", levelFilter);
  if (resolvedFilter === "unresolved") params.set("resolved", "false");
  if (resolvedFilter === "resolved") params.set("resolved", "true");

  const { data, isLoading } = useQuery({
    queryKey: ["feedback-list", levelFilter, resolvedFilter],
    queryFn: () =>
      apiFetch<{ feedback: FeedbackItem[] }>(`/api/v1/feedback?${params.toString()}`),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      apiPatch(`/api/v1/feedback/${id}`, { admin_notes: notes, resolved: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedback-list"] });
      qc.invalidateQueries({ queryKey: ["feedback-stats"] });
      setResolvingId(null);
      setAdminNotes("");
    },
  });

  const levelIcon = (level: string) => {
    switch (level) {
      case "HELPFUL": return <ThumbsUp size={14} className="text-success" aria-hidden="true" />;
      case "PARTIALLY_HELPFUL": return <Minus size={14} className="text-warning" aria-hidden="true" />;
      case "NOT_HELPFUL": return <ThumbsDown size={14} className="text-danger" aria-hidden="true" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <MessageSquare size={24} aria-hidden="true" />
          Feedback Dashboard
        </h2>
        <p className="text-text-tertiary text-sm mt-1">Review and resolve user feedback</p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Helpful" value={stats.helpful} color="text-success" />
          <StatCard label="Partial" value={stats.partially_helpful} color="text-warning" />
          <StatCard label="Not Helpful" value={stats.not_helpful} color="text-danger" />
          <StatCard label="Unresolved" value={stats.unresolved} color="text-primary-600" />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={16} className="text-text-tertiary" aria-hidden="true" />
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="text-xs px-2 py-1.5 border border-border-primary rounded-lg bg-surface-primary text-text-primary"
          aria-label="Filter by feedback level"
        >
          <option value="">All levels</option>
          <option value="HELPFUL">Helpful</option>
          <option value="PARTIALLY_HELPFUL">Partially Helpful</option>
          <option value="NOT_HELPFUL">Not Helpful</option>
        </select>
        <select
          value={resolvedFilter}
          onChange={(e) => setResolvedFilter(e.target.value)}
          className="text-xs px-2 py-1.5 border border-border-primary rounded-lg bg-surface-primary text-text-primary"
          aria-label="Filter by resolution status"
        >
          <option value="">All</option>
          <option value="unresolved">Unresolved</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {/* Feedback list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-text-tertiary" /></div>
      ) : !data?.feedback || data.feedback.length === 0 ? (
        <div className="text-center py-12 text-text-tertiary">
          <MessageSquare size={40} className="mx-auto mb-3 opacity-40" />
          <p>No feedback matching filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.feedback.map((fb) => (
            <div
              key={fb.feedback_id}
              className="bg-surface-primary border border-border-primary rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {levelIcon(fb.feedback_level)}
                  <span className="text-sm font-medium text-text-primary">{fb.feedback_level.replace(/_/g, " ")}</span>
                  <span className="text-xs text-text-tertiary">by {fb.user_name}</span>
                  <span className="text-xs text-text-tertiary">{formatRelativeTime(fb.created_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {fb.resolved_at ? (
                    <span className="text-xs text-success flex items-center gap-1">
                      <CheckCircle2 size={12} aria-hidden="true" />
                      Resolved
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setResolvingId(fb.feedback_id)}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>

              {fb.comment && (
                <p className="text-sm text-text-secondary mt-2">{fb.comment}</p>
              )}

              {fb.issue_tags && fb.issue_tags.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {fb.issue_tags.map((tag) => (
                    <span key={tag} className="text-xs bg-surface-secondary text-text-tertiary px-2 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {fb.admin_notes && (
                <div className="mt-2 p-2 bg-surface-secondary rounded text-xs text-text-secondary">
                  <span className="font-medium">Admin: </span>{fb.admin_notes}
                </div>
              )}

              {resolvingId === fb.feedback_id && (
                <div className="mt-3 flex gap-2 items-end">
                  <input
                    type="text"
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Admin notes..."
                    className="flex-1 px-3 py-1.5 text-sm border border-border-primary rounded-lg bg-surface-primary text-text-primary"
                  />
                  <button
                    type="button"
                    onClick={() => resolveMutation.mutate({ id: fb.feedback_id, notes: adminNotes })}
                    disabled={resolveMutation.isPending}
                    className="px-3 py-1.5 text-xs bg-brand text-on-brand rounded-lg hover:bg-brand-hover disabled:opacity-60"
                  >
                    {resolveMutation.isPending ? "Saving..." : "Confirm"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setResolvingId(null); setAdminNotes(""); }}
                    className="px-3 py-1.5 text-xs border border-border-primary rounded-lg hover:bg-surface-secondary"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-surface-primary border border-border-primary rounded-xl p-4">
      <p className="text-xs text-text-tertiary font-medium">{label}</p>
      <p className={`text-2xl font-bold ${color || "text-text-primary"}`}>{value}</p>
    </div>
  );
}
