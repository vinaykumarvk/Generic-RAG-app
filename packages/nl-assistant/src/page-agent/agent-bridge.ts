/**
 * Page Agent Bridge — wraps page-agent library interaction.
 *
 * - Configures LLM proxy (API key stays server-side)
 * - Intercepts actions through mutation guard
 * - Provides a clean interface for the React hook
 */

import type { AssistantConfig, AgentAction } from "../types";
import { createMutationGuard, type MutationGuardCallbacks } from "./mutation-guard";

export interface AgentBridgeConfig {
  assistantConfig: AssistantConfig;
  mutationCallbacks: MutationGuardCallbacks;
}

export interface AgentBridgeResult {
  success: boolean;
  actions: AgentAction[];
  error?: string;
}

export function createAgentBridge(bridgeConfig: AgentBridgeConfig) {
  const { assistantConfig, mutationCallbacks } = bridgeConfig;
  const guard = createMutationGuard(assistantConfig, mutationCallbacks);

  /**
   * Execute a natural language instruction via the page agent.
   * The page agent library (if loaded) analyzes the DOM and produces actions.
   * Each action is evaluated by the mutation guard before execution.
   */
  async function executeInstruction(instruction: string): Promise<AgentBridgeResult> {
    const actions: AgentAction[] = [];

    try {
      // Call the backend LLM proxy to interpret the instruction
      const res = await fetch(`${assistantConfig.apiBaseUrl}/api/v1/page-agent/complete`, {
        method: "POST",
        headers: { ...assistantConfig.authHeaders, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: `You are a UI automation assistant. The user wants to interact with a web page.
Analyze the instruction and return a JSON array of actions to take.
Each action: { "actionType": "click|fill|scroll|navigate|select", "instruction": "what to do", "targetSelector": "CSS selector", "targetText": "element text content" }
Only return safe, read-oriented actions. For any destructive action (submit, delete, approve, reject), still include it — the system will ask for confirmation.`,
            },
            { role: "user", content: `Page URL: ${window.location.href}\nInstruction: ${instruction}` },
          ],
          maxTokens: 1024,
          temperature: 0.1,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ message: "Request failed" }));
        return { success: false, actions, error: errBody.message || `HTTP ${res.status}` };
      }

      const data = await res.json();
      let parsedActions: Array<{ actionType: string; instruction: string; targetSelector?: string; targetText?: string }>;

      try {
        const content = data.content.trim();
        // Try to extract JSON from the response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        parsedActions = jsonMatch ? JSON.parse(jsonMatch[0]) : [{ actionType: "info", instruction: content }];
      } catch {
        // If not valid JSON, treat as a text response
        return { success: true, actions: [{ actionType: "info", instruction: data.content, classification: "SAFE" as const }] };
      }

      // Process each action through the mutation guard
      for (const rawAction of parsedActions) {
        const { proceed, action } = await guard.evaluate(
          rawAction.actionType,
          rawAction.instruction,
          rawAction.targetSelector,
          rawAction.targetText,
        );

        actions.push(action);

        if (proceed && action.classification === "SAFE") {
          // Execute safe DOM actions
          executeDomAction(rawAction);
        } else if (proceed && action.classification === "MUTATION") {
          // User confirmed mutation — execute it
          executeDomAction(rawAction);
        }
        // If !proceed, action was blocked — already logged by guard
      }

      return { success: true, actions };
    } catch (err) {
      return {
        success: false,
        actions,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  return { executeInstruction };
}

/** Execute a DOM action (best-effort) */
function executeDomAction(action: { actionType: string; targetSelector?: string; instruction?: string }) {
  if (!action.targetSelector) return;

  try {
    const el = document.querySelector(action.targetSelector) as HTMLElement | null;
    if (!el) return;

    switch (action.actionType) {
      case "click":
      case "click_link":
      case "click_tab":
      case "click_filter":
        el.click();
        break;
      case "fill":
      case "fill_input":
      case "fill_search":
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          // Use native input setter to trigger React's onChange
          const nativeSetter = Object.getOwnPropertyDescriptor(
            el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(el, action.instruction || "");
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        break;
      case "scroll":
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      case "select":
      case "select_option":
        if (el instanceof HTMLSelectElement && action.instruction) {
          el.value = action.instruction;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        break;
      case "focus":
        el.focus();
        break;
    }
  } catch {
    // DOM manipulation errors are non-fatal
  }
}
