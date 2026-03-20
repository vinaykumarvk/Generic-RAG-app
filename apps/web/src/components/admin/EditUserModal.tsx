import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiPatch } from "@/lib/api";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";

interface EditUserModalProps {
  user: {
    user_id: string;
    full_name: string;
    email: string;
    user_type: string;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

export function EditUserModal({ user, onSuccess, onCancel }: EditUserModalProps) {
  const [fullName, setFullName] = useState(user.full_name);
  const [userType, setUserType] = useState<"USER" | "ADMIN">(
    user.user_type === "ADMIN" ? "ADMIN" : "USER"
  );
  const firstInputRef = useRef<HTMLInputElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  const updateMutation = useMutation({
    mutationFn: (data: { full_name: string; user_type: string }) =>
      apiPatch(`/api/v1/users/${user.user_id}`, data),
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    updateMutation.mutate({ full_name: fullName.trim(), user_type: userType });
  };

  // Focus first input on mount, handle Escape + focus trap
  useEffect(() => {
    firstInputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }

      if (e.key === "Tab") {
        const container = modalContentRef.current;
        if (!container) return;
        const focusable = container.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const hasChanges = fullName.trim() !== user.full_name || userType !== user.user_type;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-modal-title"
    >
      <div
        ref={modalContentRef}
        className="bg-surface-primary border border-border-primary rounded-xl shadow-xl w-full max-w-md mx-4"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
          <h3 id="edit-user-modal-title" className="text-sm font-semibold text-text-primary">
            Edit User
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
            aria-label="Close modal"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="edit-user-email" className="block text-xs font-medium text-text-secondary mb-1">
              Email (read-only)
            </label>
            <input
              id="edit-user-email"
              type="email"
              value={user.email}
              disabled
              className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-surface-secondary text-text-tertiary cursor-not-allowed"
            />
          </div>

          <div>
            <label htmlFor="edit-user-fullname" className="block text-xs font-medium text-text-secondary mb-1">
              Full Name
            </label>
            <input
              ref={firstInputRef}
              id="edit-user-fullname"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            />
          </div>

          <div>
            <label htmlFor="edit-user-role" className="block text-xs font-medium text-text-secondary mb-1">
              Role
            </label>
            <select
              id="edit-user-role"
              value={userType}
              onChange={(e) => setUserType(e.target.value as "USER" | "ADMIN")}
              className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            >
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>

          {updateMutation.error && (
            <p className="text-sm text-danger" role="alert">
              {updateMutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm border border-border-primary rounded-lg text-text-secondary hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending || !fullName.trim() || !hasChanges}
              className="btn-primary"
            >
              {updateMutation.isPending && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
