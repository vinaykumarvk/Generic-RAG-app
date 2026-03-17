/** NL Assistant shared types */

export interface QueryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  data?: Record<string, unknown>[];
  citations?: Citation[];
  source?: "LLM" | "REGEX" | "NONE";
  executionTimeMs?: number;
  timestamp: number;
}

export interface Citation {
  type: string;
  id: string;
  label: string;
}

export interface AgentAction {
  actionType: string;
  instruction: string;
  targetSelector?: string;
  classification: "SAFE" | "MUTATION";
  wasBlocked?: boolean;
  userConfirmed?: boolean;
}

export interface FeatureFlags {
  nl_query: boolean;
  page_agent: boolean;
}

export interface AssistantConfig {
  appId: string;
  userType: string;
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  isOffline: boolean;
  locale?: string;
}

export type AssistantTab = "query" | "agent";
