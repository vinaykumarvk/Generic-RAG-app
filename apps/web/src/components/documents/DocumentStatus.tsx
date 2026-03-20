import { useEffect, useState } from "react";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface PipelineStep {
  step: string;
  status: string;
  progress: number;
}

const STEP_LABELS: Record<string, string> = {
  VALIDATE: "Validate",
  NORMALIZE: "Normalize & OCR",
  CONVERT: "Convert",
  METADATA_EXTRACT: "Metadata",
  CHUNK: "Chunk",
  EMBED: "Embed",
  KG_EXTRACT: "Extract KG",
};

export function DocumentStatus({ workspaceId, documentId }: { workspaceId: string; documentId: string }) {
  const [status, setStatus] = useState<{ status: string; jobs: PipelineStep[] } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function pollStatus() {
      while (!cancelled) {
        try {
          const data = await apiFetch<{ status: string; jobs: PipelineStep[] }>(
            `/api/v1/workspaces/${workspaceId}/documents/${documentId}`
          );
          if (!cancelled) {
            setStatus(data);
            // Stop polling if document is in a terminal state
            if (["ACTIVE", "FAILED", "SEARCHABLE", "DELETED"].includes(data.status)) break;
          }
        } catch {
          // Ignore fetch errors, retry on next interval
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    pollStatus();
    return () => { cancelled = true; };
  }, [workspaceId, documentId]);

  if (!status) return null;

  const steps = ["VALIDATE", "NORMALIZE", "CONVERT", "METADATA_EXTRACT", "CHUNK", "EMBED", "KG_EXTRACT"];

  return (
    <div className="space-y-2" role="status" aria-label="Document processing status">
      {steps.map((step) => {
        const job = status.jobs?.find((j: PipelineStep) => j.step === step);
        const isComplete = job?.status === "COMPLETED";
        const isProcessing = job?.status === "PROCESSING";
        const isFailed = job?.status === "FAILED";

        return (
          <div key={step} className="flex items-center gap-3">
            <div className="w-5">
              {isComplete && <CheckCircle size={16} className="text-success" aria-hidden="true" />}
              {isProcessing && <Loader2 size={16} className="text-primary-500 animate-spin" aria-hidden="true" />}
              {isFailed && <AlertCircle size={16} className="text-danger" aria-hidden="true" />}
              {!job && <div className="w-4 h-4 rounded-full border-2 border-skin" />}
            </div>
            <span className={`text-sm ${isComplete ? "text-success" : isProcessing ? "text-primary-600" : isFailed ? "text-danger" : "text-skin-muted"}`}>
              {STEP_LABELS[step] || step}
            </span>
            {isProcessing && job?.progress > 0 && (
              <div className="flex-1 max-w-32">
                <div className="h-1.5 bg-surface-alt rounded-full overflow-hidden">
                  <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${job.progress}%` }} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
