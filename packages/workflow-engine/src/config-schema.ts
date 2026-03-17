import { z } from "zod";
import { ConfigError } from "./errors";
import type { WfDefinition } from "./types";

export const WfGuardSchema = z.object({
  type: z.string(),
  params: z.record(z.string(), z.unknown()),
});

export const WfStateSchema = z.object({
  stateId: z.string(),
  type: z.string(),
  taskRequired: z.boolean(),
  roleId: z.string().optional(),
  slaDays: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const WfTransitionSchema = z.object({
  transitionId: z.string(),
  fromStateId: z.string(),
  toStateId: z.string(),
  trigger: z.enum(["manual", "system"]),
  guards: z.array(WfGuardSchema).optional(),
  actions: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const WfDefinitionSchema = z.object({
  workflowId: z.string(),
  version: z.string(),
  states: z.array(WfStateSchema),
  transitions: z.array(WfTransitionSchema),
});

export interface IntegrityError {
  type: "DANGLING_FROM_STATE" | "DANGLING_TO_STATE" | "DUPLICATE_STATE_ID" | "DUPLICATE_TRANSITION_ID" | "TASK_STATE_MISSING_ROLE";
  transitionId?: string;
  stateId?: string;
  message: string;
}

export function validateDefinitionIntegrity(def: WfDefinition): IntegrityError[] {
  const errors: IntegrityError[] = [];
  const stateIds = new Set(def.states.map((s) => s.stateId));

  // Check for duplicate state IDs
  const seenStates = new Set<string>();
  for (const state of def.states) {
    if (seenStates.has(state.stateId)) {
      errors.push({
        type: "DUPLICATE_STATE_ID",
        stateId: state.stateId,
        message: `Duplicate state ID: ${state.stateId}`,
      });
    }
    seenStates.add(state.stateId);
  }

  // Check for duplicate transition IDs
  const seenTransitions = new Set<string>();
  for (const t of def.transitions) {
    if (seenTransitions.has(t.transitionId)) {
      errors.push({
        type: "DUPLICATE_TRANSITION_ID",
        transitionId: t.transitionId,
        message: `Duplicate transition ID: ${t.transitionId}`,
      });
    }
    seenTransitions.add(t.transitionId);
  }

  // Check for dangling state references in transitions
  for (const t of def.transitions) {
    if (!stateIds.has(t.fromStateId)) {
      errors.push({
        type: "DANGLING_FROM_STATE",
        transitionId: t.transitionId,
        stateId: t.fromStateId,
        message: `Transition ${t.transitionId} references non-existent fromStateId: ${t.fromStateId}`,
      });
    }
    if (!stateIds.has(t.toStateId)) {
      errors.push({
        type: "DANGLING_TO_STATE",
        transitionId: t.transitionId,
        stateId: t.toStateId,
        message: `Transition ${t.transitionId} references non-existent toStateId: ${t.toStateId}`,
      });
    }
  }

  // Check that task-required states have a roleId
  for (const state of def.states) {
    if (state.taskRequired && !state.roleId) {
      errors.push({
        type: "TASK_STATE_MISSING_ROLE",
        stateId: state.stateId,
        message: `State ${state.stateId} has taskRequired=true but no roleId`,
      });
    }
  }

  return errors;
}

export function parseAndValidateDefinition(raw: unknown): WfDefinition {
  const parsed = WfDefinitionSchema.parse(raw);
  const errors = validateDefinitionIntegrity(parsed);
  if (errors.length > 0) {
    throw new ConfigError(
      `Workflow definition integrity errors:\n${errors.map((e) => `  - ${e.message}`).join("\n")}`
    );
  }
  return parsed;
}
