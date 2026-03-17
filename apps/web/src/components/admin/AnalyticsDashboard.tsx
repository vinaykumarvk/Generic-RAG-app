import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { BarChart3, Clock, Zap, ThumbsUp, ThumbsDown, Database } from "lucide-react";

interface Analytics {
  period_days: number;
  queries_per_day: Array<{ day: string; count: number }>;
  latency: { avg_ms: number; p95_ms: number };
  cache: { hit_rate: number; hits: number; total: number };
  feedback: { avg_rating: number; total: number; thumbs_up: number; thumbs_down: number };
  top_questions: Array<{ original_query: string; count: number }>;
  llm_usage: Array<{ provider: string; model_name: string; calls: number; avg_latency: number }>;
  document_stats: Array<{ status: string; count: number }>;
}

export function AnalyticsDashboard({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", workspaceId],
    queryFn: () => apiFetch<Analytics>(`/api/v1/workspaces/${workspaceId}/analytics`),
    enabled: !!workspaceId,
  });

  if (isLoading || !data) return null;

  const cards = [
    { label: "Total Queries", value: data.cache.total, icon: BarChart3, color: "text-blue-600" },
    { label: "Avg Latency", value: `${data.latency.avg_ms}ms`, icon: Clock, color: "text-amber-600" },
    { label: "P95 Latency", value: `${data.latency.p95_ms}ms`, icon: Zap, color: "text-red-600" },
    { label: "Cache Hit Rate", value: `${(data.cache.hit_rate * 100).toFixed(0)}%`, icon: Database, color: "text-green-600" },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={16} className={color} />
              <span className="text-xs text-gray-500 font-medium">{label}</span>
            </div>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Feedback summary */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Feedback</h3>
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <ThumbsUp size={18} className="text-green-500" />
            <span className="text-lg font-bold">{data.feedback.thumbs_up}</span>
          </div>
          <div className="flex items-center gap-2">
            <ThumbsDown size={18} className="text-red-500" />
            <span className="text-lg font-bold">{data.feedback.thumbs_down}</span>
          </div>
          <div className="text-sm text-gray-500">
            {data.feedback.total} total feedback entries
          </div>
        </div>
      </div>

      {/* Top questions */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Top Questions</h3>
        <div className="space-y-2">
          {data.top_questions.map((q, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="truncate flex-1 text-gray-700">{q.original_query}</span>
              <span className="text-gray-400 ml-4 shrink-0">{q.count}x</span>
            </div>
          ))}
          {data.top_questions.length === 0 && <p className="text-sm text-gray-400">No queries yet</p>}
        </div>
      </div>

      {/* LLM Usage */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold mb-3">LLM Usage</h3>
        <div className="space-y-2">
          {data.llm_usage.map((u, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="font-medium">{u.provider}/{u.model_name}</span>
              <span className="text-gray-500">{u.calls} calls, avg {Math.round(u.avg_latency)}ms</span>
            </div>
          ))}
          {data.llm_usage.length === 0 && <p className="text-sm text-gray-400">No LLM usage yet</p>}
        </div>
      </div>

      {/* Document stats */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Document Status</h3>
        <div className="flex gap-4 flex-wrap">
          {data.document_stats.map(({ status, count }) => (
            <div key={status} className="text-sm">
              <span className="font-medium">{count}</span>
              <span className="text-gray-500 ml-1">{status}</span>
            </div>
          ))}
          {data.document_stats.length === 0 && <p className="text-sm text-gray-400">No documents</p>}
        </div>
      </div>
    </div>
  );
}
