import { useEffect, useState } from "react";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";

interface PipelineStep {
  step: string;
  status: string;
  progress: number;
}

const STEP_LABELS: Record<string, string> = {
  VALIDATE: "Validate",
  NORMALIZE: "Normalize & OCR",
  CHUNK: "Chunk",
  EMBED: "Embed",
  KG_EXTRACT: "Extract KG",
};

export function DocumentStatus({ workspaceId, documentId }: { workspaceId: string; documentId: string }) {
  const [status, setStatus] = useState<{ status: string; jobs: PipelineStep[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("intellirag_token");

    async function pollStatus() {
      while (!cancelled) {
        try {
          const response = await fetch(
            `/api/v1/workspaces/${workspaceId}/documents/${documentId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!response.ok) break;
          const data = await response.json();
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

  const steps = ["VALIDATE", "NORMALIZE", "CHUNK", "EMBED", "KG_EXTRACT"];

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
              {isComplete && <CheckCircle size={16} className="text-green-500" aria-hidden="true" />}
              {isProcessing && <Loader2 size={16} className="text-blue-500 animate-spin" aria-hidden="true" />}
              {isFailed && <AlertCircle size={16} className="text-red-500" aria-hidden="true" />}
              {!job && <div className="w-4 h-4 rounded-full border-2 border-gray-200" />}
            </div>
            <span className={`text-sm ${isComplete ? "text-green-700" : isProcessing ? "text-blue-600" : isFailed ? "text-red-600" : "text-gray-400"}`}>
              {STEP_LABELS[step] || step}
            </span>
            {isProcessing && job?.progress > 0 && (
              <div className="flex-1 max-w-32">
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${job.progress}%` }} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
