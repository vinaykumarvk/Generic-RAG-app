import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { CheckCircle, AlertCircle, Loader2, Clock } from "lucide-react";

interface Job {
  job_id: string;
  document_id: string;
  step: string;
  status: string;
  attempt: number;
  progress: number;
  error_message?: string;
  created_at: string;
  document_title: string;
}

export function IngestionMonitor({ workspaceId }: { workspaceId: string }) {
  const { data } = useQuery({
    queryKey: ["ingestion-jobs", workspaceId],
    queryFn: () => apiFetch<{ documents: Array<{ document_id: string; title: string; status: string; created_at: string }> }>(
      `/api/v1/workspaces/${workspaceId}/documents?limit=20`
    ),
    refetchInterval: 3000,
    enabled: !!workspaceId,
  });

  const docs = data?.documents || [];
  const processing = docs.filter((d) => ["VALIDATING", "NORMALIZING", "CHUNKING", "EMBEDDING", "KG_EXTRACTING"].includes(d.status));
  const failed = docs.filter((d) => d.status === "FAILED");
  const completed = docs.filter((d) => ["SEARCHABLE", "ACTIVE"].includes(d.status));

  return (
    <div className="space-y-4">
      {/* Processing */}
      {processing.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> Processing ({processing.length})
          </h4>
          {processing.map((doc) => (
            <div key={doc.document_id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium truncate flex-1">{doc.title}</span>
              <span className="text-xs text-blue-500 font-medium">{doc.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Failed */}
      {failed.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2 flex items-center gap-1">
            <AlertCircle size={12} /> Failed ({failed.length})
          </h4>
          {failed.map((doc) => (
            <div key={doc.document_id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium truncate flex-1">{doc.title}</span>
              <span className="text-xs text-red-500">Failed</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent completed */}
      <div>
        <h4 className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-2 flex items-center gap-1">
          <CheckCircle size={12} /> Completed ({completed.length})
        </h4>
        {completed.slice(0, 5).map((doc) => (
          <div key={doc.document_id} className="flex items-center justify-between py-2 text-sm">
            <span className="truncate flex-1 text-gray-600">{doc.title}</span>
            <span className="text-xs text-green-500">{doc.status}</span>
          </div>
        ))}
      </div>

      {docs.length === 0 && <p className="text-sm text-gray-400">No documents in this workspace</p>}
    </div>
  );
}
