import { useParams } from "react-router-dom";
import { AwsJudgmentImport } from "@/components/documents/AwsJudgmentImport";
import { DocumentUpload } from "@/components/documents/DocumentUpload";
import { DocumentList } from "@/components/documents/DocumentList";
import { useWorkspace } from "@/hooks/useWorkspaces";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function DocumentsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const validWorkspaceId = workspaceId && UUID_PATTERN.test(workspaceId) ? workspaceId : null;
  const { data: workspace } = useWorkspace(validWorkspaceId ?? "");
  const isJudgmentWorkspace = workspace?.settings?.workspaceKind === "judgments";

  if (!validWorkspaceId) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        Invalid workspace route. Open Documents from the workspace switcher or dashboard.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-skin-base">Documents</h2>
        <p className="text-skin-muted text-sm mt-1">Upload and manage your knowledge base documents</p>
      </div>

      {isJudgmentWorkspace && <AwsJudgmentImport workspaceId={validWorkspaceId} />}
      <DocumentUpload workspaceId={validWorkspaceId} />
      <DocumentList workspaceId={validWorkspaceId} />
    </div>
  );
}
