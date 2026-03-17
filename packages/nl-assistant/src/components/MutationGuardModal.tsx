import type { AgentAction } from "../types";

interface Props {
  action: AgentAction | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MutationGuardModal({ action, t, onConfirm, onCancel }: Props) {
  if (!action) return null;

  return (
    <div className="assistant-overlay" role="dialog" aria-modal="true" aria-label={t("assistant.mutation_title")}>
      <div className="assistant-panel" style={{ maxHeight: "auto" }}>
        <div className="assistant-mutation-guard">
          <h3 style={{ margin: 0, fontSize: "1.125rem" }}>{t("assistant.mutation_title")}</h3>
          <p>{t("assistant.mutation_message", { action: action.instruction })}</p>
          <div className="assistant-mutation-guard__action">
            {action.actionType}: {action.instruction}
            {action.targetSelector && (
              <div style={{ marginTop: "0.25rem", opacity: 0.7 }}>
                Target: {action.targetSelector}
              </div>
            )}
          </div>
          <div className="assistant-mutation-guard__buttons">
            <button
              type="button"
              onClick={onCancel}
              className="assistant-input-bar"
              style={{
                background: "var(--color-surface-alt, #f3f4f6)",
                color: "var(--color-text, #111827)",
                border: "1px solid var(--color-border, #e5e7eb)",
                minHeight: "2.75rem",
                padding: "0.5rem 1rem",
                borderRadius: "var(--radius-md, 0.5rem)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {t("assistant.mutation_cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              style={{
                background: "var(--color-warning, #f59e0b)",
                color: "#fff",
                border: "none",
                minHeight: "2.75rem",
                padding: "0.5rem 1rem",
                borderRadius: "var(--radius-md, 0.5rem)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {t("assistant.mutation_confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
