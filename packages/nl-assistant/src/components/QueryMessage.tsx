import type { QueryMessage as QueryMessageType } from "../types";
import { QueryResultTable } from "./QueryResultTable";
import { CitationLink } from "./CitationLink";

interface Props {
  message: QueryMessageType;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onCitationClick?: (type: string, id: string) => void;
}

export function QueryMessage({ message, t, onCitationClick }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`assistant-msg assistant-msg--${message.role}`}>
      <div>{message.content}</div>

      {!isUser && message.data && message.data.length > 0 && (
        <QueryResultTable data={message.data} />
      )}

      {!isUser && message.citations && message.citations.length > 0 && (
        <div className="assistant-citations">
          {message.citations.map((c, i) => (
            <CitationLink key={i} citation={c} onClick={onCitationClick} />
          ))}
        </div>
      )}

      {!isUser && (message.source || message.executionTimeMs) && (
        <div className="assistant-msg__meta">
          {message.source && message.source !== "NONE" && (
            <span>{t("assistant.query_source", { source: message.source })}</span>
          )}
          {message.executionTimeMs != null && (
            <span>{t("assistant.query_time", { ms: message.executionTimeMs })}</span>
          )}
        </div>
      )}
    </div>
  );
}
