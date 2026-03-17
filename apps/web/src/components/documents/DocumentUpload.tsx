import { useState, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, X, FileText, Loader2 } from "lucide-react";

interface DocumentUploadProps {
  workspaceId: string;
}

export function DocumentUpload({ workspaceId }: DocumentUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name);
      const token = localStorage.getItem("intellirag_token");
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/documents`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(body.message);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", workspaceId] });
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...droppedFiles]);
  }, []);

  const handleUpload = async () => {
    for (const file of files) {
      await uploadMutation.mutateAsync(file);
    }
    setFiles([]);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          isDragging ? "border-primary-500 bg-primary-50" : "border-gray-300 hover:border-gray-400"
        }`}
      >
        <Upload size={32} className="mx-auto text-gray-400 mb-3" />
        <p className="text-sm text-gray-600">
          Drag & drop files here, or <span className="text-primary-600 font-medium">click to browse</span>
        </p>
        <p className="text-xs text-gray-400 mt-1">PDF, DOCX, XLSX, TXT, MD, CSV — up to 50MB</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.txt,.md,.csv"
          onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files || [])])}
          className="hidden"
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, i) => (
            <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-gray-500" />
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
              </div>
              <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">
                <X size={16} />
              </button>
            </div>
          ))}
          <button
            onClick={handleUpload}
            disabled={uploadMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
          >
            {uploadMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Upload {files.length} file{files.length > 1 ? "s" : ""}
          </button>
          {uploadMutation.error && (
            <p className="text-sm text-red-600">{uploadMutation.error.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
