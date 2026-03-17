import { useState, useCallback, useRef } from "react";
import type { AssistantConfig, AgentAction } from "../types";
import { createAgentBridge } from "../page-agent/agent-bridge";

export function usePageAgent(config: AssistantConfig) {
  const [loading, setLoading] = useState(false);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Mutation confirmation state
  const [pendingMutation, setPendingMutation] = useState<AgentAction | null>(null);
  const mutationResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirmMutation = useCallback(() => {
    mutationResolveRef.current?.(true);
    mutationResolveRef.current = null;
    setPendingMutation(null);
  }, []);

  const cancelMutation = useCallback(() => {
    mutationResolveRef.current?.(false);
    mutationResolveRef.current = null;
    setPendingMutation(null);
  }, []);

  const executeInstruction = useCallback(async (instruction: string) => {
    if (!instruction.trim() || config.isOffline) return;

    setLoading(true);
    setError(null);

    const bridge = createAgentBridge({
      assistantConfig: config,
      mutationCallbacks: {
        onMutationDetected: (action) => {
          return new Promise<boolean>((resolve) => {
            setPendingMutation(action);
            mutationResolveRef.current = resolve;
          });
        },
        onAuditLog: (action) => {
          // Fire-and-forget audit log
          fetch(`${config.apiBaseUrl}/api/v1/page-agent/audit`, {
            method: "POST",
            headers: { ...config.authHeaders, "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              actionType: action.actionType,
              instruction: action.instruction,
              targetSelector: action.targetSelector,
              wasBlocked: action.wasBlocked ?? false,
              userConfirmed: action.userConfirmed ?? false,
              pageUrl: window.location.href,
            }),
          }).catch(() => {});
        },
      },
    });

    try {
      const result = await bridge.executeInstruction(instruction);
      setActions(result.actions);
      if (result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [config]);

  return {
    loading, actions, error,
    pendingMutation, confirmMutation, cancelMutation,
    executeInstruction,
  };
}
