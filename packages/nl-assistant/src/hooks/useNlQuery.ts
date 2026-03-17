import { useState, useCallback, useRef } from "react";
import type { QueryMessage, AssistantConfig } from "../types";

let messageIdCounter = 0;
function nextId() { return `msg_${++messageIdCounter}_${Date.now()}`; }

export function useNlQuery(config: AssistantConfig) {
  const [messages, setMessages] = useState<QueryMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendQuery = useCallback(async (question: string) => {
    if (!question.trim() || config.isOffline) return;

    const userMsg: QueryMessage = {
      id: nextId(), role: "user", content: question.trim(), timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/v1/query`, {
        method: "POST",
        headers: { ...config.authHeaders, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question: question.trim() }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      // Strip methodology-style summaries — show clean direct answers
      const hasData = Array.isArray(data.data) && data.data.length > 0;
      const isMethodology = /\b(using trigram|trigram|fuzzy match|joins?\s+\w+\s+table|queries the|node_type|edge_type|relationship edges|ranked by|Lists up to \d+|SELECT|FROM\s+\w+|CTE|subquery)\b/i.test(data.summary || "");
      const cleanSummary = (hasData && isMethodology)
        ? `Found ${data.data.length} result${data.data.length === 1 ? "" : "s"}.`
        : (data.summary || "No results");
      const assistantMsg: QueryMessage = {
        id: nextId(), role: "assistant", content: cleanSummary,
        data: data.data, citations: data.citations, source: data.source,
        executionTimeMs: data.executionTimeMs, timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setMessages((prev) => [...prev, {
        id: nextId(), role: "assistant", content: msg, timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [config.apiBaseUrl, config.authHeaders, config.isOffline]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, loading, error, sendQuery, clearMessages };
}
