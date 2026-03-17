import type { Citation } from "../types";

interface Props {
  citation: Citation;
  onClick?: (type: string, id: string) => void;
}

export function CitationLink({ citation, onClick }: Props) {
  return (
    <button
      type="button"
      className="assistant-citation"
      onClick={() => onClick?.(citation.type, citation.id)}
      title={`${citation.type}: ${citation.id}`}
    >
      {citation.label}
    </button>
  );
}
