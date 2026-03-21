import { useState, useCallback, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, X, FileText, Loader2, FolderOpen, AlertCircle, CheckCircle, RotateCcw } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiFetch, apiUpload, setUploadInProgress, startSessionKeepalive, stopSessionKeepalive, refreshSession } from "@/lib/api";

const SUPPORTED_EXTENSIONS = [
  ".pdf", ".docx", ".xlsx", ".txt", ".md", ".csv", ".doc", ".xls",
  ".jpg", ".jpeg", ".png", ".tiff", ".bmp", ".gif", ".webp",
];
const MAX_FILES = 100;
const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024; // 250MB
const HIDDEN_FILES = [".DS_Store", "Thumbs.db", "desktop.ini"];
const MAX_CONCURRENT = 4;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface FileWithMeta {
  file: File;
  category: string;
  subcategory: string;
  sourcePath: string;
  metadata: Record<string, unknown>;
  sensitivityLevel?: string;
  caseReference?: string;
  orgUnitId?: string;
  language?: string;
}

interface FileProgress {
  name: string;
  percent: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

interface UploadProgress {
  total: number;
  completed: number;
  inProgress: string[];
  errors: { name: string; error: string }[];
  fileProgress: FileProgress[];
}

function extractFolderMetadata(file: File): Omit<FileWithMeta, "file"> {
  const relativePath = (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const parts = relativePath.split("/");

  // Strip root folder (index 0) and filename (last)
  const folderLevels = parts.slice(1, -1);

  const category = folderLevels[0] || "";
  const subcategory = folderLevels[1] || "";

  const metadata: Record<string, unknown> = {
    upload_root: parts[0] || "",
    folder_levels: folderLevels,
  };
  folderLevels.forEach((level, i) => {
    metadata[`folder_level_${i + 1}`] = level;
  });

  return { category, subcategory, sourcePath: relativePath, metadata };
}

function isSupported(file: File): boolean {
  const name = file.name.toLowerCase();
  if (HIDDEN_FILES.some((h) => name === h.toLowerCase())) return false;
  if (name.startsWith(".")) return false;
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

interface DocumentUploadProps {
  workspaceId: string;
}

export function DocumentUpload({ workspaceId }: DocumentUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [folderFiles, setFolderFiles] = useState<FileWithMeta[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [duplicateFile, setDuplicateFile] = useState<{ file: File; meta?: Omit<FileWithMeta, "file"> } | null>(null);
  const [oversizedFiles, setOversizedFiles] = useState<{ name: string; size: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const isFolderMode = folderFiles.length > 0;
  const isUploading = uploadProgress !== null && uploadProgress.completed < uploadProgress.total;

  // Navigation protection: warn before leaving during active uploads
  useEffect(() => {
    if (!isUploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isUploading]);

  const invalidateWorkspaceViews = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["documents", workspaceId] }),
      qc.invalidateQueries({ queryKey: ["analytics", workspaceId] }),
      qc.invalidateQueries({ queryKey: ["analytics-export", workspaceId] }),
      qc.invalidateQueries({ queryKey: ["ingestion-volume", workspaceId] }),
      qc.invalidateQueries({ queryKey: ["workspace-kpi", workspaceId] }),
      qc.invalidateQueries({ queryKey: ["workspaces", workspaceId] }),
      qc.invalidateQueries({ queryKey: ["workspaces"] }),
    ]);
  }, [qc, workspaceId]);

  const uploadFile = (
    file: File,
    meta?: Omit<FileWithMeta, "file">,
    onProgress?: (percent: number) => void,
  ): Promise<unknown> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", file.name);
    if (meta) {
      if (meta.category) formData.append("category", meta.category);
      if (meta.subcategory) formData.append("subcategory", meta.subcategory);
      if (meta.sourcePath) formData.append("source_path", meta.sourcePath);
      formData.append("metadata", JSON.stringify(meta.metadata));
      if (meta.sensitivityLevel) formData.append("sensitivity_level", meta.sensitivityLevel);
      if (meta.caseReference) formData.append("case_reference", meta.caseReference);
      if (meta.orgUnitId) formData.append("org_unit_id", meta.orgUnitId);
      if (meta.language) formData.append("language", meta.language);
    }

    return apiUpload(
      `/api/v1/workspaces/${workspaceId}/documents`,
      formData,
      { onProgress }
    ).catch((error) => {
      if (error instanceof Error && error.message === "Duplicate document detected") {
        throw new Error("DUPLICATE_DETECTED");
      }
      throw error;
    });
  };

  // FR-001/FH-01: Retry with exponential backoff (3 attempts, 1s/2s/4s)
  const uploadFileWithRetry = async (
    file: File,
    meta?: Omit<FileWithMeta, "file">,
    onProgress?: (percent: number) => void,
  ): Promise<unknown> => {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await uploadFile(file, meta, onProgress);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed";
        // On session expiry, attempt token refresh then retry once
        if (message === "SESSION_EXPIRED") {
          const refreshed = await refreshSession();
          if (refreshed) continue; // retry same attempt (don't increment)
          throw err; // refresh failed — bubble up
        }
        // Don't retry on duplicate or client errors
        if (message === "DUPLICATE_DETECTED" || attempt === MAX_RETRIES) throw err;
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error("Upload failed after retries");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    const oversized = droppedFiles.filter((f) => f.size > MAX_FILE_SIZE_BYTES);
    const validFiles = droppedFiles.filter((f) => f.size <= MAX_FILE_SIZE_BYTES);
    if (oversized.length > 0) {
      setOversizedFiles(oversized.map((f) => ({ name: f.name, size: f.size })));
    }
    setFiles((prev) => {
      const combined = [...prev, ...validFiles];
      return combined.slice(0, MAX_FILES);
    });
  }, []);

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const supported = selected.filter(isSupported);
    const oversized = supported.filter((f) => f.size > MAX_FILE_SIZE_BYTES);
    const validFiles = supported.filter((f) => f.size <= MAX_FILE_SIZE_BYTES);
    if (oversized.length > 0) {
      setOversizedFiles(oversized.map((f) => ({ name: f.name, size: f.size })));
    }
    const withMeta = validFiles.map((file) => ({
      file,
      ...extractFolderMetadata(file),
    }));
    setFolderFiles(withMeta);
    setFiles([]);
  };

  const handleUploadFiles = async () => {
    const fileProgress: FileProgress[] = files.map((f) => ({ name: f.name, percent: 0, status: "pending" }));
    const progress: UploadProgress = { total: files.length, completed: 0, inProgress: [], errors: [], fileProgress };
    setUploadProgress({ ...progress });

    setUploadInProgress(true);
    startSessionKeepalive();
    try {
      const queue = files.map((f, i) => ({ file: f, index: i }));
      const run = async () => {
        while (queue.length > 0) {
          const item = queue.shift()!;
          progress.inProgress.push(item.file.name);
          progress.fileProgress[item.index].status = "uploading";
          setUploadProgress({ ...progress });
          try {
            await uploadFileWithRetry(item.file, undefined, (pct) => {
              progress.fileProgress[item.index].percent = pct;
              setUploadProgress({ ...progress });
            });
            progress.fileProgress[item.index].status = "done";
            progress.fileProgress[item.index].percent = 100;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed";
            progress.errors.push({ name: item.file.name, error: msg });
            progress.fileProgress[item.index].status = "error";
            progress.fileProgress[item.index].error = msg;
          }
          progress.inProgress = progress.inProgress.filter((n) => n !== item.file.name);
          progress.completed++;
          setUploadProgress({ ...progress });
        }
      };

      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, files.length) }, () => run()));
    } finally {
      stopSessionKeepalive();
      setUploadInProgress(false);
    }
    await invalidateWorkspaceViews();
    // Keep failed files for retry — only clear successful ones
    if (progress.errors.length > 0) {
      const failedNames = new Set(progress.errors.map((e) => e.name));
      setFiles((prev) => prev.filter((f) => failedNames.has(f.name)));
    } else {
      setFiles([]);
    }
  };

  const handleUploadFolder = async () => {
    const fileProgress: FileProgress[] = folderFiles.map((f) => ({ name: f.file.name, percent: 0, status: "pending" }));
    const progress: UploadProgress = { total: folderFiles.length, completed: 0, inProgress: [], errors: [], fileProgress };
    setUploadProgress({ ...progress });

    setUploadInProgress(true);
    startSessionKeepalive();
    try {
      const queue = folderFiles.map((f, i) => ({ item: f, index: i }));
      const run = async () => {
        while (queue.length > 0) {
          const entry = queue.shift()!;
          progress.inProgress.push(entry.item.file.name);
          progress.fileProgress[entry.index].status = "uploading";
          setUploadProgress({ ...progress });
          try {
            await uploadFileWithRetry(entry.item.file, entry.item, (pct) => {
              progress.fileProgress[entry.index].percent = pct;
              setUploadProgress({ ...progress });
            });
            progress.fileProgress[entry.index].status = "done";
            progress.fileProgress[entry.index].percent = 100;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed";
            progress.errors.push({ name: entry.item.file.name, error: msg });
            progress.fileProgress[entry.index].status = "error";
            progress.fileProgress[entry.index].error = msg;
          }
          progress.inProgress = progress.inProgress.filter((n) => n !== entry.item.file.name);
          progress.completed++;
          setUploadProgress({ ...progress });
        }
      };

      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, folderFiles.length) }, () => run()));
    } finally {
      stopSessionKeepalive();
      setUploadInProgress(false);
    }
    await invalidateWorkspaceViews();
    // Keep failed files for retry — only clear successful ones
    if (progress.errors.length > 0) {
      const failedNames = new Set(progress.errors.map((e) => e.name));
      setFolderFiles((prev) => prev.filter((f) => failedNames.has(f.file.name)));
    } else {
      setFolderFiles([]);
    }
  };

  const handleRetryFailed = () => {
    setUploadProgress(null);
    // files/folderFiles already contain only the failed items (kept from previous upload)
    // User clicks the normal upload button again to re-upload
  };

  const handleCancel = () => {
    setFiles([]);
    setFolderFiles([]);
    setUploadProgress(null);
    setOversizedFiles([]);
  };

  return (
    <div className="space-y-4">
      {/* Drop zone + folder button */}
      <div className="flex flex-col gap-3 sm:flex-row" data-tour="document-upload">
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex-1 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            isDragging ? "border-primary-500 surface-brand-soft" : "border-border-primary hover:border-primary-300"
          }`}
        >
          <Upload size={32} className="mx-auto text-text-tertiary mb-3" />
          <p className="text-sm text-text-secondary">
            Drag & drop files here, or <span className="text-primary-600 font-medium">click to browse</span>
          </p>
          <p className="text-xs text-text-tertiary mt-1">PDF, DOCX, XLSX, TXT, MD, CSV, images — up to 250MB (max {MAX_FILES} files)</p>
          {/* FR-016/AC-02: Always-visible Browse Files button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            className="btn-primary mt-3"
          >
            Browse Files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md,.csv,.jpg,.jpeg,.png,.tiff,.bmp,.gif,.webp"
            onChange={(e) => {
              const newFiles = Array.from(e.target.files || []);
              const oversized = newFiles.filter((f) => f.size > MAX_FILE_SIZE_BYTES);
              if (oversized.length > 0) setOversizedFiles(oversized.map((f) => ({ name: f.name, size: f.size })));
              setFiles((prev) => [...prev, ...newFiles.filter((f) => f.size <= MAX_FILE_SIZE_BYTES)].slice(0, MAX_FILES));
            }}
            className="hidden"
          />
        </div>

        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 px-6 py-5 border-2 border-dashed border-border-primary rounded-xl hover:border-primary-400 hover-surface-brand-soft transition-colors cursor-pointer sm:py-0"
        >
          <FolderOpen size={28} className="text-text-tertiary" />
          <span className="text-xs text-text-secondary font-medium">Upload Folder</span>
          <input
            ref={folderInputRef}
            type="file"
            {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
            onChange={handleFolderSelect}
            className="hidden"
          />
        </button>
      </div>

      {/* Oversized files warning */}
      {oversizedFiles.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30">
          <AlertCircle size={16} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-warning">{oversizedFiles.length} file{oversizedFiles.length > 1 ? "s" : ""} excluded (exceeds 250 MB limit)</p>
            <ul className="mt-1 text-xs text-text-secondary space-y-0.5">
              {oversizedFiles.map((f) => (
                <li key={f.name}>{f.name} ({formatFileSize(f.size)})</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setOversizedFiles([])}
              className="text-xs text-text-tertiary hover:text-text-primary mt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Folder preview table */}
      {isFolderMode && !isUploading && (
        <div className="space-y-3">
          <div className="bg-surface-primary border border-border-primary rounded-xl overflow-hidden max-h-80 overflow-y-auto">
            <div className="md:hidden space-y-3 p-3">
              {folderFiles.map((item, i) => (
                <article key={i} className="border border-border-primary rounded-xl p-3 space-y-3 bg-surface-secondary">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex items-start gap-2">
                      <FileText size={16} className="text-text-tertiary shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <h4 className="font-medium text-text-primary break-all">{item.file.name}</h4>
                        {item.category && (
                          <span className="inline-block mt-2 px-2 py-0.5 badge-brand rounded text-xs font-medium">
                            {item.category}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFolderFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="text-text-tertiary hover-text-danger"
                      aria-label={`Remove ${item.file.name}`}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <dl className="space-y-2 text-xs">
                    <div>
                      <dt className="text-text-tertiary">Subcategory</dt>
                      <dd className="text-text-primary mt-0.5 break-words">{item.subcategory || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-text-tertiary">Path</dt>
                      <dd className="text-text-primary mt-0.5 break-all">{item.sourcePath}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary border-b border-border-primary sticky top-0">
                  <tr>
                    <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">File Name</th>
                    <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">Category</th>
                    <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">Subcategory</th>
                    <th scope="col" className="text-left px-4 py-2 font-medium text-text-secondary">Path</th>
                    <th scope="col" className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-primary">
                  {folderFiles.map((item, i) => (
                    <tr key={i} className="hover:bg-surface-secondary">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <FileText size={14} className="text-text-tertiary shrink-0" />
                          <span className="font-medium truncate max-w-[200px]">{item.file.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {item.category && (
                          <span className="inline-block px-2 py-0.5 badge-brand rounded text-xs font-medium">
                            {item.category}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-secondary truncate max-w-[200px]">{item.subcategory}</td>
                      <td className="px-4 py-2 text-xs text-text-tertiary truncate max-w-[250px]">{item.sourcePath}</td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => setFolderFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="text-text-tertiary hover-text-danger"
                          aria-label={`Remove ${item.file.name}`}
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleUploadFolder}
              className="btn-primary"
            >
              <Upload size={16} aria-hidden="true" />
              Upload {folderFiles.length} file{folderFiles.length > 1 ? "s" : ""}
            </button>
            <button type="button" onClick={handleCancel} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Individual file list (non-folder mode) */}
      {files.length > 0 && !isFolderMode && !isUploading && (
        <div className="space-y-2">
          {files.length >= MAX_FILES && (
            <p className="text-xs text-warning">Maximum {MAX_FILES} files reached</p>
          )}
          {files.map((file, i) => (
            <div key={i} className="flex items-center justify-between p-3 bg-surface-secondary rounded-lg">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-text-tertiary" aria-hidden="true" />
                <span className="text-sm font-medium text-text-primary">{file.name}</span>
                <span className="text-xs text-text-tertiary">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
              </div>
              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-text-tertiary hover-text-danger" aria-label={`Remove ${file.name}`}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUploadFiles}
              className="btn-primary"
            >
              <Upload size={16} aria-hidden="true" />
              Upload {files.length} file{files.length > 1 ? "s" : ""}
            </button>
            {files.length < MAX_FILES && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 text-sm border border-border-primary rounded-lg text-text-secondary hover:bg-surface-secondary transition-colors"
              >
                Browse more files
              </button>
            )}
          </div>
        </div>
      )}

      {/* Upload progress */}
      {uploadProgress && (
        <div className="space-y-2 p-4 bg-surface-secondary rounded-xl">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-text-primary">
              {uploadProgress.completed < uploadProgress.total ? "Uploading..." : "Upload Complete"}
            </span>
            <span className="text-text-secondary">{uploadProgress.completed} / {uploadProgress.total}</span>
          </div>
          {/* Overall progress bar */}
          <div className="w-full bg-surface-primary rounded-full h-2">
            <div
              className="bg-primary-700 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(uploadProgress.completed / uploadProgress.total) * 100}%` }}
            />
          </div>
          {/* Per-file progress bars (FR-016/AC-02) */}
          <div className="space-y-1.5 mt-2 max-h-40 overflow-y-auto">
            {uploadProgress.fileProgress.map((fp) => (
              <div key={fp.name} className="flex items-center gap-2 text-xs">
                {fp.status === "uploading" && <Loader2 size={10} className="animate-spin text-primary-500 shrink-0" aria-hidden="true" />}
                {fp.status === "done" && <CheckCircle size={10} className="text-success shrink-0" aria-hidden="true" />}
                {fp.status === "error" && <AlertCircle size={10} className="text-danger shrink-0" aria-hidden="true" />}
                {fp.status === "pending" && <div className="w-2.5 h-2.5 rounded-full bg-surface-primary shrink-0" />}
                <span className="truncate text-text-secondary flex-1">{fp.name}</span>
                {fp.status === "uploading" && (
                  <div className="w-20 bg-surface-primary rounded-full h-1.5">
                    <div className="bg-primary-500 h-1.5 rounded-full transition-all" style={{ width: `${fp.percent}%` }} />
                  </div>
                )}
                {fp.status === "error" && (
                  <span className="text-danger truncate max-w-[120px]">{fp.error}</span>
                )}
              </div>
            ))}
          </div>
          {uploadProgress.completed === uploadProgress.total && uploadProgress.errors.length === 0 && (
            <div className="flex items-center gap-1.5 text-sm text-success mt-1">
              <CheckCircle size={14} aria-hidden="true" /> All files uploaded successfully
            </div>
          )}
          {uploadProgress.completed === uploadProgress.total && (
            <div className="flex items-center gap-3 mt-1">
              {uploadProgress.errors.length > 0 && (
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  Retry {uploadProgress.errors.length} failed file{uploadProgress.errors.length > 1 ? "s" : ""}
                </button>
              )}
              <button type="button" onClick={() => setUploadProgress(null)} className="text-xs text-text-tertiary hover:text-text-primary">
                Dismiss
              </button>
              <button type="button" onClick={handleCancel} className="text-xs text-text-tertiary hover:text-text-primary">
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {/* Duplicate detection dialog (FR-001/BR-01) */}
      {duplicateFile && (
        <ConfirmDialog
          title="Duplicate document detected"
          message={`"${duplicateFile.file.name}" appears to already exist in this workspace. Upload anyway?`}
          confirmLabel="Upload duplicate"
          variant="default"
          onConfirm={async () => {
            const { file, meta } = duplicateFile;
            setDuplicateFile(null);
            // Re-upload with ?force=true by appending to URL
            const formData = new FormData();
            formData.append("file", file);
            formData.append("title", file.name);
            if (meta) {
              if (meta.category) formData.append("category", meta.category);
              if (meta.subcategory) formData.append("subcategory", meta.subcategory);
              if (meta.sourcePath) formData.append("source_path", meta.sourcePath);
              formData.append("metadata", JSON.stringify(meta.metadata));
              if (meta.sensitivityLevel) formData.append("sensitivity_level", meta.sensitivityLevel);
              if (meta.caseReference) formData.append("case_reference", meta.caseReference);
              if (meta.orgUnitId) formData.append("org_unit_id", meta.orgUnitId);
              if (meta.language) formData.append("language", meta.language);
            }
            try {
              await apiFetch(`/api/v1/workspaces/${workspaceId}/documents?force=true`, {
                method: "POST",
                body: formData,
              });
              await invalidateWorkspaceViews();
            } catch {
              // Non-critical
            }
          }}
          onCancel={() => setDuplicateFile(null)}
        />
      )}
    </div>
  );
}
