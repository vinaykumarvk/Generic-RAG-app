import { useState, useRef, useEffect } from "react";
import type { AssistantConfig } from "../types";
import { useNlQuery } from "../hooks/useNlQuery";
import { QueryMessage } from "./QueryMessage";

interface Props {
  config: AssistantConfig;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onCitationClick?: (type: string, id: string) => void;
}

export function NlQueryPanel({ config, t, onCitationClick }: Props) {
  const { messages, loading, sendQuery } = useNlQuery(config);
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    if (!input.trim() || loading) return;
    sendQuery(input);
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
      <div className="assistant-body" ref={bodyRef}>
        {messages.length === 0 && !loading && (
          <div className="assistant-empty">{t("assistant.query_empty")}</div>
        )}
        {messages.map((msg) => (
          <QueryMessage key={msg.id} message={msg} t={t} onCitationClick={onCitationClick} />
        ))}
        {loading && (
          <div className="assistant-loading" aria-live="polite">
            <span className="assistant-loading__dot" />
            <span className="assistant-loading__dot" />
            <span className="assistant-loading__dot" />
            <span>{t("assistant.query_loading")}</span>
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
          placeholder={t("assistant.query_placeholder")}
          disabled={loading || config.isOffline}
          aria-label={t("assistant.query_placeholder")}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!input.trim() || loading || config.isOffline}
          aria-label={t("assistant.query_send")}
        >
          {t("assistant.query_send")}
        </button>
      </div>
    </>
  );
}
