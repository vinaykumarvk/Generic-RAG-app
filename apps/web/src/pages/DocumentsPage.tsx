import { useParams } from "react-router-dom";
import { DocumentUpload } from "@/components/documents/DocumentUpload";
import { DocumentList } from "@/components/documents/DocumentList";

export function DocumentsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-skin-base">Documents</h2>
        <p className="text-skin-muted text-sm mt-1">Upload and manage your knowledge base documents</p>
      </div>

      <DocumentUpload workspaceId={workspaceId!} />
      <DocumentList workspaceId={workspaceId!} />
    </div>
  );
}
