import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { FileText, Clock, CheckCircle, AlertCircle, Loader2, Trash2 } from "lucide-react";

interface Document {
  document_id: string;
  title: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  status: string;
  chunk_count: number;
  created_at: string;
}

const STATUS_ICONS: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  UPLOADED: { icon: Clock, color: "text-gray-400", label: "Uploaded" },
  VALIDATING: { icon: Loader2, color: "text-blue-500 animate-spin", label: "Validating" },
  NORMALIZING: { icon: Loader2, color: "text-blue-500 animate-spin", label: "Normalizing" },
  CHUNKING: { icon: Loader2, color: "text-blue-500 animate-spin", label: "Chunking" },
  EMBEDDING: { icon: Loader2, color: "text-blue-500 animate-spin", label: "Embedding" },
  SEARCHABLE: { icon: CheckCircle, color: "text-green-500", label: "Searchable" },
  KG_EXTRACTING: { icon: Loader2, color: "text-purple-500 animate-spin", label: "Extracting KG" },
  ACTIVE: { icon: CheckCircle, color: "text-green-600", label: "Active" },
  FAILED: { icon: AlertCircle, color: "text-red-500", label: "Failed" },
};

export function DocumentList({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["documents", workspaceId],
    queryFn: () => apiFetch<{ documents: Document[]; total: number }>(`/api/v1/workspaces/${workspaceId}/documents`),
    refetchInterval: 5000, // Poll for status updates
  });

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div>;
  }

  if (!data?.documents.length) {
    return <p className="text-center py-8 text-gray-400">No documents uploaded yet</p>;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Document</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Chunks</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Size</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Uploaded</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.documents.map((doc) => {
            const statusInfo = STATUS_ICONS[doc.status] || STATUS_ICONS.UPLOADED;
            const Icon = statusInfo.icon;
            return (
              <tr key={doc.document_id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileText size={16} className="text-gray-400" />
                    <span className="font-medium">{doc.title}</span>
                  </div>
                  <span className="text-xs text-gray-400">{doc.file_name}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`flex items-center gap-1.5 ${statusInfo.color}`}>
                    <Icon size={14} />
                    <span className="text-xs font-medium">{statusInfo.label}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-600">{doc.chunk_count}</td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {(doc.file_size_bytes / 1024 / 1024).toFixed(1)} MB
                </td>
                <td className="px-4 py-3 text-right text-gray-500 text-xs">
                  {new Date(doc.created_at).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
