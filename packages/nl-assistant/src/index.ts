// Components
export { AssistantFab } from "./components/AssistantFab";
export { AssistantOverlay } from "./components/AssistantOverlay";
export { NlQueryPanel } from "./components/NlQueryPanel";
export { PageAgentPanel } from "./components/PageAgentPanel";
export { QueryMessage } from "./components/QueryMessage";
export { QueryResultTable } from "./components/QueryResultTable";
export { CitationLink } from "./components/CitationLink";
export { MutationGuardModal } from "./components/MutationGuardModal";

// Hooks
export { useAssistantState } from "./hooks/useAssistantState";
export { useNlQuery } from "./hooks/useNlQuery";
export { usePageAgent } from "./hooks/usePageAgent";
export { useFeatureFlags } from "./hooks/useFeatureFlags";
export { useKeyboardShortcut } from "./hooks/useKeyboardShortcut";

// Types
export type {
  QueryMessage as QueryMessageType,
  Citation,
  AgentAction,
  FeatureFlags,
  AssistantConfig,
  AssistantTab,
} from "./types";

// i18n
export { assistantKeys, assistantEnDefaults } from "./i18n-keys";

// Page Agent
export { classifyAction } from "./page-agent/action-allowlist";
export type { ActionClassification } from "./page-agent/action-allowlist";

// CSS (apps import this)
// import "@puda/nl-assistant/src/nl-assistant.css"
