import React, {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "warning" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

type AlertVariant = "info" | "success" | "warning" | "error";

type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: AlertVariant;
};

type FieldProps = {
  label: ReactNode;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
};

type ModalProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  open: boolean;
  title: string;
  description?: string;
  actions?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
};

type FieldContextValue = {
  controlId: string;
  hintId?: string;
  errorId?: string;
  hasError: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function mergeDescribedBy(existing: string | undefined, extras: Array<string | undefined>): string | undefined {
  const values = [
    ...(existing ? existing.split(/\s+/).filter(Boolean) : []),
    ...extras.filter((value): value is string => Boolean(value))
  ];
  if (values.length === 0) return undefined;
  return Array.from(new Set(values)).join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "ui-btn",
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        fullWidth && "ui-btn--full",
        className
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const fieldContext = useContext(FieldContext);
  const { id, "aria-describedby": ariaDescribedByProp, "aria-invalid": ariaInvalidProp, ...rest } = props;
  const ariaDescribedBy = mergeDescribedBy(ariaDescribedByProp, [
    fieldContext?.hintId,
    fieldContext?.errorId
  ]);
  const ariaInvalid = ariaInvalidProp ?? (fieldContext?.hasError ? true : undefined);

  return (
    <input
      {...rest}
      id={id ?? fieldContext?.controlId}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      className={cx("ui-input", className)}
    />
  );
}

export function PasswordInput({ className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const fieldContext = useContext(FieldContext);
  const { id, "aria-describedby": ariaDescribedByProp, "aria-invalid": ariaInvalidProp, ...rest } = props;
  const ariaDescribedBy = mergeDescribedBy(ariaDescribedByProp, [
    fieldContext?.hintId,
    fieldContext?.errorId
  ]);
  const ariaInvalid = ariaInvalidProp ?? (fieldContext?.hasError ? true : undefined);

  return (
    <div className="ui-password-wrapper">
      <input
        {...rest}
        type={visible ? "text" : "password"}
        id={id ?? fieldContext?.controlId}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className={cx("ui-input", "ui-input--has-toggle", className)}
      />
      <button
        type="button"
        className="ui-password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        tabIndex={0}
      >
        {visible ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldContext = useContext(FieldContext);
  const { id, "aria-describedby": ariaDescribedByProp, "aria-invalid": ariaInvalidProp, ...rest } = props;
  const ariaDescribedBy = mergeDescribedBy(ariaDescribedByProp, [
    fieldContext?.hintId,
    fieldContext?.errorId
  ]);
  const ariaInvalid = ariaInvalidProp ?? (fieldContext?.hasError ? true : undefined);

  return (
    <select
      {...rest}
      id={id ?? fieldContext?.controlId}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      className={cx("ui-select", className)}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fieldContext = useContext(FieldContext);
  const { id, "aria-describedby": ariaDescribedByProp, "aria-invalid": ariaInvalidProp, ...rest } = props;
  const ariaDescribedBy = mergeDescribedBy(ariaDescribedByProp, [
    fieldContext?.hintId,
    fieldContext?.errorId
  ]);
  const ariaInvalid = ariaInvalidProp ?? (fieldContext?.hasError ? true : undefined);

  return (
    <textarea
      {...rest}
      id={id ?? fieldContext?.controlId}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      className={cx("ui-textarea", className)}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("ui-card", className)} {...props} />;
}

export function Alert({ variant = "info", className, role, ...props }: AlertProps) {
  const resolvedRole = role ?? (variant === "error" ? "alert" : "status");
  return (
    <div
      className={cx("ui-alert", `ui-alert--${variant}`, className)}
      role={resolvedRole}
      {...props}
    />
  );
}

export function Field({ label, htmlFor, required, hint, error, children }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const contextValue = useMemo<FieldContextValue>(
    () => ({
      controlId: htmlFor,
      hintId,
      errorId,
      hasError: Boolean(error)
    }),
    [error, errorId, hintId, htmlFor]
  );

  return (
    <div className="ui-field">
      <label htmlFor={htmlFor} className="ui-field__label">
        {label}
        {required ? <span className="ui-field__required"> *</span> : null}
      </label>
      <FieldContext.Provider value={contextValue}>{children}</FieldContext.Provider>
      {hint ? (
        <small id={hintId} className="ui-field__hint">
          {hint}
        </small>
      ) : null}
      {error ? (
        <p id={errorId} className="ui-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  description,
  actions,
  onClose,
  closeLabel = "Close dialog",
  className,
  children,
  ...props
}: ModalProps) {
  const generatedId = useId();
  const baseId = `ui-modal-${generatedId.replace(/[:]/g, "")}`;
  const titleId = `${baseId}-title`;
  const descriptionId = description ? `${baseId}-description` : undefined;
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const timer = requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      first?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(timer);
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="ui-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cx("ui-modal", className)}
        {...props}
      >
        <div className="ui-modal__header">
          <h2 id={titleId} className="ui-modal__title">
            {title}
          </h2>
          <Button type="button" variant="ghost" size="sm" className="ui-modal__close" onClick={onClose}>
            <span aria-hidden="true">×</span>
            <span className="sr-only">{closeLabel}</span>
          </Button>
        </div>
        {description ? (
          <p id={descriptionId} className="ui-modal__description">
            {description}
          </p>
        ) : null}
        {children ? <div className="ui-modal__body">{children}</div> : null}
        {actions ? <div className="ui-modal__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastMessage = {
  id: string;
  variant: ToastVariant;
  text: string;
};

type ToastContextValue = {
  showToast: (variant: ToastVariant, text: string, durationMs?: number) => void;
};

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children: kids }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<(ToastMessage & { expiresAt: number })[]>([]);
  const counterRef = useRef(0);

  const showToast = useCallback((variant: ToastVariant, text: string, durationMs = 4500) => {
    const id = `toast-${++counterRef.current}`;
    const expiresAt = Date.now() + durationMs;
    setToasts((prev) => [...prev.slice(-4), { id, variant, text, expiresAt }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {kids}
      {toasts.length > 0 && (
        <div className="ui-toast-container" aria-live="polite" role="status">
          {toasts.map((toast) => (
            <div key={toast.id} className={cx("ui-toast", `ui-toast--${toast.variant}`)}>
              <span className="ui-toast__text">{toast.text}</span>
              <button
                type="button"
                className="ui-toast__dismiss"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function Breadcrumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="ui-breadcrumb">
      <ol>
        {items.map((item, i) => (
          <li key={i}>
            {i < items.length - 1 && item.onClick ? (
              <button type="button" className="ui-breadcrumb__link" onClick={item.onClick}>
                {item.label}
              </button>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined}>{item.label}</span>
            )}
            {i < items.length - 1 && <span className="ui-breadcrumb__sep" aria-hidden="true">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="ui-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Step ${current} of ${total}`}>
      <div className="ui-progress__label">Step {current} of {total}</div>
      <div className="ui-progress__track">
        <div className="ui-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SkeletonBlock({ height = "1rem", width = "100%", className }: { height?: string; width?: string; className?: string }) {
  return <div className={cx("ui-skeleton", className)} style={{ height, width }} aria-hidden="true" />;
}

type DropZoneProps = {
  accept?: string;
  disabled?: boolean;
  className?: string;
  onFileSelected: (file: File) => void;
  label?: string;
};

export function DropZone({
  accept = ".pdf,.jpg,.jpeg,.png",
  disabled = false,
  className,
  onFileSelected,
  label = "Drop file here or click to browse",
}: DropZoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setDragActive(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  }, [disabled, onFileSelected]);

  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    // Reset so the same file can be selected again
    e.target.value = "";
  }, [onFileSelected]);

  return (
    <div
      className={cx(
        "ui-dropzone",
        dragActive && "ui-dropzone--active",
        disabled && "ui-dropzone--disabled",
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
      aria-label={label}
    >
      <div className="ui-dropzone__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <span className="ui-dropzone__label">{label}</span>
      <span className="ui-dropzone__hint">PDF, JPEG, or PNG</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        style={{ display: "none" }}
        disabled={disabled}
        tabIndex={-1}
      />
    </div>
  );
}

type UploadConfirmProps = {
  file: File;
  onConfirm: () => void;
  onCancel: () => void;
  uploading?: boolean;
  progress?: number;
};

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";

    // Set inert on main content so screen readers / Tab ignore it
    const root = document.getElementById("root");
    if (root) root.setAttribute("inert", "");

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      // Focus trap
      if (e.key === "Tab" && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // Auto-focus first focusable element
    requestAnimationFrame(() => {
      const first = drawerRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    });

    return () => {
      document.body.style.overflow = "";
      if (root) root.removeAttribute("inert");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <nav ref={drawerRef} className={`drawer ${open ? "drawer--open" : ""}`} aria-label="Navigation menu" role="dialog" aria-modal="true">
        {children}
      </nav>
    </>,
    document.body
  );
}

type PaginationProps = {
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
};

export function Pagination({ page, total, limit, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;
  return (
    <nav className="ui-pagination" aria-label="Pagination">
      <Button
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        ← Prev
      </Button>
      <span className="ui-pagination__info">
        Page {page} of {totalPages} ({total} total)
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        Next →
      </Button>
    </nav>
  );
}

export function UploadConfirm({ file, onConfirm, onCancel, uploading = false, progress = 0 }: UploadConfirmProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setThumbUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setThumbUrl(null);
  }, [file]);

  const sizeStr = file.size < 1024
    ? `${file.size} B`
    : file.size < 1048576
    ? `${(file.size / 1024).toFixed(1)} KB`
    : `${(file.size / 1048576).toFixed(1)} MB`;

  return (
    <div className="ui-upload-confirm">
      {thumbUrl ? (
        <img src={thumbUrl} alt={file.name} className="ui-upload-confirm__thumb" />
      ) : (
        <div className="ui-upload-confirm__icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 3h7l5 5v13H7z" />
            <path d="M14 3v6h5" />
          </svg>
        </div>
      )}
      <div className="ui-upload-confirm__info">
        <div className="ui-upload-confirm__name">{file.name}</div>
        <div className="ui-upload-confirm__meta">{sizeStr} · {file.type || "Unknown type"}</div>
        {uploading && progress > 0 && (
          <div className="ui-upload-confirm__progress">
            <div className="ui-upload-confirm__progress-track">
              <div className="ui-upload-confirm__progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="ui-upload-confirm__actions">
        <Button size="sm" variant="primary" onClick={onConfirm} disabled={uploading}>
          {uploading ? "Uploading..." : "Confirm Upload"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={uploading}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type TabItem = {
  key: string;
  label: string;
  content: ReactNode;
};

type TabsProps = {
  tabs: TabItem[];
  defaultTab?: string;
  className?: string;
};

export function Tabs({ tabs, defaultTab, className }: TabsProps) {
  const [activeKey, setActiveKey] = useState(defaultTab || tabs[0]?.key || "");
  const baseId = useId().replace(/[:]/g, "");
  const activeTab = tabs.find((t) => t.key === activeKey) || tabs[0];
  const tablistRef = useRef<HTMLDivElement>(null);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent) => {
    const tabButtons = tablistRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    if (!tabButtons || tabButtons.length === 0) return;
    const currentIdx = Array.from(tabButtons).findIndex((el) => el === document.activeElement);
    let nextIdx = -1;
    switch (e.key) {
      case "ArrowRight": nextIdx = (currentIdx + 1) % tabButtons.length; break;
      case "ArrowLeft": nextIdx = (currentIdx - 1 + tabButtons.length) % tabButtons.length; break;
      case "Home": nextIdx = 0; break;
      case "End": nextIdx = tabButtons.length - 1; break;
      default: return;
    }
    e.preventDefault();
    tabButtons[nextIdx].focus();
    setActiveKey(tabs[nextIdx].key);
  }, [tabs]);

  return (
    <div className={cx("ui-tabs", className)}>
      <div className="ui-tabs__list" role="tablist" ref={tablistRef} onKeyDown={handleTabKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${baseId}-${tab.key}`}
            aria-selected={tab.key === activeKey}
            aria-controls={`tabpanel-${baseId}-${tab.key}`}
            tabIndex={tab.key === activeKey ? 0 : -1}
            className={cx("ui-tabs__tab", tab.key === activeKey && "ui-tabs__tab--active")}
            onClick={() => setActiveKey(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab && (
        <div
          role="tabpanel"
          id={`tabpanel-${baseId}-${activeTab.key}`}
          aria-labelledby={`tab-${baseId}-${activeTab.key}`}
          className="ui-tabs__panel"
        >
          {activeTab.content}
        </div>
      )}
    </div>
  );
}

type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({ variant = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cx("ui-badge", `ui-badge--${variant}`, className)}
      {...props}
    />
  );
}

type MaskedFieldProps = {
  value: string;
  label: ReactNode;
  maskChar?: string;
  visibleChars?: number;
  className?: string;
};

export function MaskedField({ value, label, maskChar = "•", visibleChars = 4, className }: MaskedFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const masked = value.length > visibleChars
    ? maskChar.repeat(value.length - visibleChars) + value.slice(-visibleChars)
    : value;

  return (
    <div className={cx("ui-masked-field", className)}>
      <span className="ui-masked-field__label">{label}</span>
      <span className="ui-masked-field__value">{revealed ? value : masked}</span>
      <button
        type="button"
        className="ui-masked-field__toggle"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? "Hide value" : "Reveal value"}
      >
        {revealed ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={variant === "danger" ? "danger" : variant === "warning" ? "warning" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

type DataFreshnessProps = {
  updatedAt: string;
  className?: string;
};

export function DataFreshness({ updatedAt, className }: DataFreshnessProps) {
  const ago = timeAgo(updatedAt);
  const date = new Date(updatedAt);
  const isStale = Date.now() - date.getTime() > 5 * 60 * 1000;
  return (
    <span className={cx("ui-data-freshness", isStale && "ui-data-freshness--stale", className)} title={date.toLocaleString()}>
      {ago}
    </span>
  );
}

type SlaCountdownProps = {
  dueAt: string;
  className?: string;
};

export function SlaCountdown({ dueAt, className }: SlaCountdownProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const due = new Date(dueAt).getTime();
  const diff = due - now;
  const isOverdue = diff < 0;
  const absDiff = Math.abs(diff);
  const hours = Math.floor(absDiff / 3_600_000);
  const minutes = Math.floor((absDiff % 3_600_000) / 60_000);

  const label = isOverdue
    ? `Overdue by ${hours}h ${minutes}m`
    : hours > 0
    ? `${hours}h ${minutes}m remaining`
    : `${minutes}m remaining`;

  const variant = isOverdue ? "danger" : hours < 2 ? "warning" : "success";

  return (
    <span className={cx("ui-sla-countdown", `ui-sla-countdown--${variant}`, className)}>
      {label}
    </span>
  );
}

type ConfidenceScoreProps = {
  score: number;
  label?: string;
  className?: string;
};

export function ConfidenceScore({ score, label, className }: ConfidenceScoreProps) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const variant = pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger";

  return (
    <div className={cx("ui-confidence", className)}>
      {label && <span className="ui-confidence__label">{label}</span>}
      <div className="ui-confidence__bar">
        <div className={cx("ui-confidence__fill", `ui-confidence__fill--${variant}`)} style={{ width: `${pct}%` }} />
      </div>
      <span className="ui-confidence__value">{pct}%</span>
    </div>
  );
}

/* ── useIdleTimeout hook ── */

type IdleTimeoutOptions = {
  warningMs?: number;
  timeoutMs?: number;
};

export function useIdleTimeout(
  onTimeout: () => void,
  { warningMs = 14 * 60 * 1000, timeoutMs = 15 * 60 * 1000 }: IdleTimeoutOptions = {},
) {
  const [showWarning, setShowWarning] = useState(false);
  const warningRef = useRef<ReturnType<typeof setTimeout>>();
  const logoutRef = useRef<ReturnType<typeof setTimeout>>();
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    const resetTimers = () => {
      clearTimeout(warningRef.current);
      clearTimeout(logoutRef.current);
      setShowWarning(false);
      warningRef.current = setTimeout(() => setShowWarning(true), warningMs);
      logoutRef.current = setTimeout(() => onTimeoutRef.current(), timeoutMs);
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, resetTimers, { passive: true }));
    resetTimers();
    return () => {
      clearTimeout(warningRef.current);
      clearTimeout(logoutRef.current);
      events.forEach((e) => window.removeEventListener(e, resetTimers));
    };
  }, [warningMs, timeoutMs]);

  return { showWarning, dismissWarning: useCallback(() => setShowWarning(false), []) };
}
