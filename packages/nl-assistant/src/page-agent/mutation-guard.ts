/**
 * Mutation guard — intercepts page-agent actions and classifies them.
 * MUTATION actions are paused until user confirms via MutationGuardModal.
 */

import { classifyAction, type ActionClassification } from "./action-allowlist";
import type { AgentAction, AssistantConfig } from "../types";

export interface MutationGuardCallbacks {
  /** Called when a MUTATION action needs user confirmation */
  onMutationDetected: (action: AgentAction) => Promise<boolean>;
  /** Called to audit-log an action */
  onAuditLog: (action: AgentAction) => void;
}

export function createMutationGuard(config: AssistantConfig, callbacks: MutationGuardCallbacks) {
  /**
   * Evaluate an action. Returns true if action should proceed, false if blocked.
   */
  async function evaluate(
    actionType: string,
    instruction: string,
    targetSelector?: string,
    targetText?: string,
  ): Promise<{ proceed: boolean; action: AgentAction }> {
    const classification = classifyAction(actionType, instruction, targetSelector, targetText);

    const action: AgentAction = {
      actionType,
      instruction,
      targetSelector,
      classification,
    };

    if (classification === "SAFE") {
      action.wasBlocked = false;
      callbacks.onAuditLog(action);
      return { proceed: true, action };
    }

    // MUTATION — ask user
    const confirmed = await callbacks.onMutationDetected(action);
    action.userConfirmed = confirmed;
    action.wasBlocked = !confirmed;
    callbacks.onAuditLog(action);
    return { proceed: confirmed, action };
  }

  return { evaluate };
}
