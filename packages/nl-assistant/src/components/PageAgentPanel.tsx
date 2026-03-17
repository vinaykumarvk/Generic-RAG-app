import { useState, useRef, useEffect } from "react";
import type { AssistantConfig } from "../types";
import { usePageAgent } from "../hooks/usePageAgent";
import { MutationGuardModal } from "./MutationGuardModal";

interface Props {
  config: AssistantConfig;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export function PageAgentPanel({ config, t }: Props) {
  const {
    loading, actions, error,
    pendingMutation, confirmMutation, cancelMutation,
    executeInstruction,
  } = usePageAgent(config);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    if (!input.trim() || loading) return;
    executeInstruction(input);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <div className="assistant-body">
        {actions.length === 0 && !loading && !error && (
          <div className="assistant-empty">{t("assistant.agent_placeholder")}</div>
        )}

        {actions.map((action, i) => (
          <div key={i} className={`assistant-msg assistant-msg--assistant`}>
            <div>
              <strong>{action.actionType}</strong>: {action.instruction}
            </div>
            {action.targetSelector && (
              <div className="assistant-msg__meta">
                <span>Target: {action.targetSelector}</span>
              </div>
            )}
            <div className="assistant-msg__meta">
              <span>{action.classification === "MUTATION" ? (action.userConfirmed ? "Confirmed" : "Blocked") : "Auto-executed"}</span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="assistant-loading" aria-live="polite">
            <span className="assistant-loading__dot" />
            <span className="assistant-loading__dot" />
            <span className="assistant-loading__dot" />
            <span>{t("assistant.agent_thinking")}</span>
          </div>
        )}

        {error && (
          <div className="assistant-msg assistant-msg--assistant" style={{ borderLeft: "3px solid var(--color-danger, #ef4444)" }}>
            {error}
          </div>
        )}
      </div>

      <div className="assistant-input-bar">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("assistant.agent_placeholder")}
          disabled={loading || config.isOffline}
          aria-label={t("assistant.agent_placeholder")}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!input.trim() || loading || config.isOffline}
          aria-label={t("assistant.agent_execute")}
        >
          {t("assistant.agent_execute")}
        </button>
      </div>

      <MutationGuardModal
        action={pendingMutation}
        t={t}
        onConfirm={confirmMutation}
        onCancel={cancelMutation}
      />
    </>
  );
}
