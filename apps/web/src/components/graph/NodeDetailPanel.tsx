import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { X, ArrowRight, FileText, Loader2 } from "lucide-react";

interface NodeDetail {
  node_id: string;
  name: string;
  node_type: string;
  description: string;
  source_count: number;
  edges: Array<{
    edge_id: string;
    edge_type: string;
    source_name: string;
    target_name: string;
    source_type: string;
    target_type: string;
    document_title?: string;
  }>;
}

interface NodeDetailPanelProps {
  workspaceId: string;
  nodeId: string;
  onClose: () => void;
}

export function NodeDetailPanel({ workspaceId, nodeId, onClose }: NodeDetailPanelProps) {
  const { data: node, isLoading } = useQuery({
    queryKey: ["graph-node", nodeId],
    queryFn: () => apiFetch<NodeDetail>(`/api/v1/workspaces/${workspaceId}/graph/nodes/${nodeId}`),
    enabled: !!nodeId,
  });

  return (
    <div className="w-80 bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <h3 className="font-semibold text-sm">Node Details</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : node ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h4 className="font-bold text-lg">{node.name}</h4>
            <span className="inline-block mt-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">
              {node.node_type}
            </span>
            <span className="text-xs text-gray-400 ml-2">{node.source_count} sources</span>
          </div>

          {node.description && (
            <p className="text-sm text-gray-600">{node.description}</p>
          )}

          <div>
            <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Relationships ({node.edges?.length || 0})
            </h5>
            <div className="space-y-2">
              {node.edges?.map((edge) => (
                <div key={edge.edge_id} className="text-xs p-2 bg-gray-50 rounded">
                  <div className="flex items-center gap-1">
                    <span className="font-medium">{edge.source_name}</span>
                    <ArrowRight size={10} className="text-gray-400" />
                    <span className="font-medium">{edge.target_name}</span>
                  </div>
                  <span className="text-gray-500">{edge.edge_type}</span>
                  {edge.document_title && (
                    <div className="flex items-center gap-1 mt-1 text-gray-400">
                      <FileText size={10} />
                      <span className="truncate">{edge.document_title}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
