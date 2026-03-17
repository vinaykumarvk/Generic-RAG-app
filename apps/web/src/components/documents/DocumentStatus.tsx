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
    const token = localStorage.getItem("intellirag_token");
    const eventSource = new EventSource(
      `/api/v1/workspaces/${workspaceId}/documents/${documentId}/status`
    );

    eventSource.onmessage = (event) => {
      try {
        setStatus(JSON.parse(event.data));
      } catch { /* ignore parse errors */ }
    };

    return () => eventSource.close();
  }, [workspaceId, documentId]);

  if (!status) return null;

  const steps = ["VALIDATE", "NORMALIZE", "CHUNK", "EMBED", "KG_EXTRACT"];

  return (
    <div className="space-y-2">
      {steps.map((step) => {
        const job = status.jobs?.find((j: PipelineStep) => j.step === step);
        const isComplete = job?.status === "COMPLETED";
        const isProcessing = job?.status === "PROCESSING";
        const isFailed = job?.status === "FAILED";

        return (
          <div key={step} className="flex items-center gap-3">
            <div className="w-5">
              {isComplete && <CheckCircle size={16} className="text-green-500" />}
              {isProcessing && <Loader2 size={16} className="text-blue-500 animate-spin" />}
              {isFailed && <AlertCircle size={16} className="text-red-500" />}
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
