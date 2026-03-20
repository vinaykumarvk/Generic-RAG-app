import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const ICON_MAP: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const STYLE_MAP: Record<ToastType, string> = {
  success: "border-success-soft surface-success-soft text-success",
  error: "border-danger-soft surface-danger-soft text-danger",
  info: "border-primary-400 surface-brand-soft text-primary-700",
};

const ICON_COLOR_MAP: Record<ToastType, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-primary-500",
};

function ToastEntry({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [exiting, setExiting] = useState(false);
  const Icon = ICON_MAP[toast.type];

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    const timer = setTimeout(dismiss, 5000);
    return () => clearTimeout(timer);
  }, [dismiss]);

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 px-4 py-3 border rounded-lg shadow-lg max-w-sm transition-all duration-200 ${
        STYLE_MAP[toast.type]
      } ${exiting ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0"}`}
    >
      <Icon size={16} className={`shrink-0 mt-0.5 ${ICON_COLOR_MAP[toast.type]}`} aria-hidden="true" />
      <p className="text-sm flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 p-0.5 rounded hover:opacity-70 transition-opacity"
        aria-label="Dismiss notification"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastEntry key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}
