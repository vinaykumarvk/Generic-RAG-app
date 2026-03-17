/**
 * i18n key constants for the NL Assistant module.
 * Apps merge these into their locale files.
 */

export const assistantKeys = {
  // FAB & overlay
  "assistant.open": "assistant.open",
  "assistant.close": "assistant.close",
  "assistant.title": "assistant.title",
  "assistant.tab_query": "assistant.tab_query",
  "assistant.tab_agent": "assistant.tab_agent",

  // NL Query
  "assistant.query_placeholder": "assistant.query_placeholder",
  "assistant.query_send": "assistant.query_send",
  "assistant.query_empty": "assistant.query_empty",
  "assistant.query_loading": "assistant.query_loading",
  "assistant.query_error": "assistant.query_error",
  "assistant.query_no_results": "assistant.query_no_results",
  "assistant.query_source": "assistant.query_source",
  "assistant.query_time": "assistant.query_time",
  "assistant.query_history": "assistant.query_history",

  // Page Agent
  "assistant.agent_placeholder": "assistant.agent_placeholder",
  "assistant.agent_execute": "assistant.agent_execute",
  "assistant.agent_thinking": "assistant.agent_thinking",
  "assistant.agent_disabled": "assistant.agent_disabled",

  // Mutation Guard
  "assistant.mutation_title": "assistant.mutation_title",
  "assistant.mutation_message": "assistant.mutation_message",
  "assistant.mutation_confirm": "assistant.mutation_confirm",
  "assistant.mutation_cancel": "assistant.mutation_cancel",

  // Offline
  "assistant.offline": "assistant.offline",

  // Feature disabled
  "assistant.feature_disabled": "assistant.feature_disabled",
} as const;

/** English default values — apps should copy these into their locale files */
export const assistantEnDefaults: Record<string, string> = {
  "assistant.open": "Open Assistant",
  "assistant.close": "Close",
  "assistant.title": "Assistant",
  "assistant.tab_query": "Data Query",
  "assistant.tab_agent": "Page Helper",
  "assistant.query_placeholder": "Ask a question about your data...",
  "assistant.query_send": "Ask",
  "assistant.query_empty": "Ask a question to get started",
  "assistant.query_loading": "Searching...",
  "assistant.query_error": "Something went wrong. Please try again.",
  "assistant.query_no_results": "No results found",
  "assistant.query_source": "Source: {{source}}",
  "assistant.query_time": "{{ms}}ms",
  "assistant.query_history": "Recent Queries",
  "assistant.agent_placeholder": "Tell me what to do on this page...",
  "assistant.agent_execute": "Go",
  "assistant.agent_thinking": "Working...",
  "assistant.agent_disabled": "Page helper is not available",
  "assistant.mutation_title": "Confirm Action",
  "assistant.mutation_message": "The assistant wants to perform: {{action}}. This action may modify data. Do you want to proceed?",
  "assistant.mutation_confirm": "Yes, proceed",
  "assistant.mutation_cancel": "Cancel",
  "assistant.offline": "Assistant is unavailable offline",
  "assistant.feature_disabled": "This feature is not enabled",
};
