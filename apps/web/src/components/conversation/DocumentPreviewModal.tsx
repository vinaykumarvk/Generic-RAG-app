import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface DocumentPreviewModalProps {
  documentTitle: string;
  pageNumber: number | null;
  excerpt: string;
  onClose: () => void;
}

export function DocumentPreviewModal({ documentTitle, pageNumber, excerpt, onClose }: DocumentPreviewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-preview-title"
    >
      <div
        ref={dialogRef}
        className="bg-surface rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-skin">
          <h2 id="doc-preview-title" className="text-sm font-semibold text-skin-base truncate">
            {documentTitle}{pageNumber ? `, Page ${pageNumber}` : ""}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-surface-alt transition-colors"
            aria-label="Close preview"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          <p className="text-sm text-skin-base whitespace-pre-wrap">{excerpt}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
