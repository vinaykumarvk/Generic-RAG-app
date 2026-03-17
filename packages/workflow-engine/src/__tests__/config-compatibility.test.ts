/**
 * Config compatibility test — validates that ALL PUDA service-pack workflow.json
 * files parse correctly through the legacy-to-new config converter, Zod schema,
 * and integrity validation. Zero failures = pass.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { WfDefinitionSchema, validateDefinitionIntegrity } from "../config-schema";
import type { WfDefinition } from "../types";

// ── Legacy types (matching service-pack JSON format) ──────────────────────────

interface LegacyWorkflowState {
  stateId: string;
  type: string;
  taskRequired: boolean;
  systemRoleId?: string;
  slaDays?: number;
  [key: string]: unknown;
}

interface LegacyWorkflowTransition {
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  trigger: "manual" | "system";
  allowedActorTypes?: string[];
  allowedSystemRoleIds?: string[];
  actions?: string[];
  [key: string]: unknown;
}

interface LegacyWorkflowConfig {
  workflowId: string;
  version: string;
  states: LegacyWorkflowState[];
  transitions: LegacyWorkflowTransition[];
}

// ── Converter (duplicated here to keep this test self-contained) ──────────────

function convertLegacyConfig(legacy: LegacyWorkflowConfig): WfDefinition {
  const states = legacy.states.map((s) => {
    const { stateId, type, taskRequired, systemRoleId, slaDays, taskUi, ...rest } = s;
    const metadata: Record<string, unknown> = { ...rest };
    if (taskUi) metadata.taskUi = taskUi;

    return {
      stateId,
      type,
      taskRequired,
      roleId: systemRoleId,
      slaDays,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  });

  const transitions = legacy.transitions.map((t) => {
    const { transitionId, fromStateId, toStateId, trigger, allowedActorTypes, allowedSystemRoleIds, actions, ...rest } = t;

    const guards: { type: string; params: Record<string, unknown> }[] = [];
    if (allowedActorTypes && allowedActorTypes.length > 0) {
      guards.push({ type: "ACTOR_TYPE", params: { allowedTypes: allowedActorTypes } });
    }
    if (allowedSystemRoleIds && allowedSystemRoleIds.length > 0) {
      guards.push({ type: "ACTOR_ROLE", params: { allowedRoles: allowedSystemRoleIds, forActorType: "OFFICER" } });
    }

    return {
      transitionId,
      fromStateId,
      toStateId,
      trigger,
      guards: guards.length > 0 ? guards : undefined,
      actions,
      metadata: Object.keys(rest).length > 0 ? rest : undefined,
    };
  });

  return {
    workflowId: legacy.workflowId,
    version: legacy.version,
    states,
    transitions,
  };
}

// ── Load all service packs ────────────────────────────────────────────────────

function loadAllServicePackWorkflows(): { serviceKey: string; filePath: string; raw: LegacyWorkflowConfig }[] {
  const servicePacksDir = path.resolve(__dirname, "../../../../service-packs");
  if (!fs.existsSync(servicePacksDir)) {
    throw new Error(`service-packs directory not found at ${servicePacksDir}`);
  }

  const entries = fs.readdirSync(servicePacksDir, { withFileTypes: true });
  const results: { serviceKey: string; filePath: string; raw: LegacyWorkflowConfig }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workflowPath = path.join(servicePacksDir, entry.name, "workflow.json");
    if (!fs.existsSync(workflowPath)) continue;

    const raw = JSON.parse(fs.readFileSync(workflowPath, "utf-8"));
    results.push({ serviceKey: entry.name, filePath: workflowPath, raw });
  }

  return results;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Config compatibility — all 30 service packs", () => {
  const workflows = loadAllServicePackWorkflows();

  it("found at least 30 service pack workflow.json files", () => {
    expect(workflows.length).toBeGreaterThanOrEqual(30);
  });

  describe.each(workflows)("$serviceKey", ({ serviceKey, raw }) => {
    it("converts from legacy format without error", () => {
      const converted = convertLegacyConfig(raw);
      expect(converted.workflowId).toBeTruthy();
      expect(converted.states.length).toBeGreaterThan(0);
      expect(converted.transitions.length).toBeGreaterThan(0);
    });

    it("passes WfDefinitionSchema.parse()", () => {
      const converted = convertLegacyConfig(raw);
      const parsed = WfDefinitionSchema.parse(converted);
      expect(parsed.workflowId).toBe(converted.workflowId);
      expect(parsed.states).toHaveLength(converted.states.length);
      expect(parsed.transitions).toHaveLength(converted.transitions.length);
    });

    it("passes validateDefinitionIntegrity() with zero errors", () => {
      const converted = convertLegacyConfig(raw);
      const parsed = WfDefinitionSchema.parse(converted);
      const errors = validateDefinitionIntegrity(parsed);
      expect(
        errors,
        `Integrity errors for ${serviceKey}:\n${errors.map((e) => `  - ${e.message}`).join("\n")}`
      ).toHaveLength(0);
    });

    it("preserves all state IDs through conversion", () => {
      const converted = convertLegacyConfig(raw);
      const originalStateIds = new Set(raw.states.map((s) => s.stateId));
      const convertedStateIds = new Set(converted.states.map((s) => s.stateId));
      expect(convertedStateIds).toEqual(originalStateIds);
    });

    it("preserves all transition IDs through conversion", () => {
      const converted = convertLegacyConfig(raw);
      const originalTransIds = new Set(raw.transitions.map((t) => t.transitionId));
      const convertedTransIds = new Set(converted.transitions.map((t) => t.transitionId));
      expect(convertedTransIds).toEqual(originalTransIds);
    });

    it("maps systemRoleId → roleId for task states", () => {
      const converted = convertLegacyConfig(raw);
      for (const origState of raw.states) {
        if (origState.taskRequired && origState.systemRoleId) {
          const newState = converted.states.find((s) => s.stateId === origState.stateId);
          expect(newState?.roleId).toBe(origState.systemRoleId);
        }
      }
    });

    it("converts allowedActorTypes → ACTOR_TYPE guard", () => {
      const converted = convertLegacyConfig(raw);
      for (const origTrans of raw.transitions) {
        if (origTrans.allowedActorTypes && origTrans.allowedActorTypes.length > 0) {
          const newTrans = converted.transitions.find((t) => t.transitionId === origTrans.transitionId);
          const actorTypeGuard = newTrans?.guards?.find((g) => g.type === "ACTOR_TYPE");
          expect(actorTypeGuard, `Missing ACTOR_TYPE guard on ${origTrans.transitionId}`).toBeDefined();
          expect(actorTypeGuard!.params.allowedTypes).toEqual(origTrans.allowedActorTypes);
        }
      }
    });

    it("converts allowedSystemRoleIds → ACTOR_ROLE guard with forActorType=OFFICER", () => {
      const converted = convertLegacyConfig(raw);
      for (const origTrans of raw.transitions) {
        if (origTrans.allowedSystemRoleIds && origTrans.allowedSystemRoleIds.length > 0) {
          const newTrans = converted.transitions.find((t) => t.transitionId === origTrans.transitionId);
          const roleGuard = newTrans?.guards?.find((g) => g.type === "ACTOR_ROLE");
          expect(roleGuard, `Missing ACTOR_ROLE guard on ${origTrans.transitionId}`).toBeDefined();
          expect(roleGuard!.params.allowedRoles).toEqual(origTrans.allowedSystemRoleIds);
          expect(roleGuard!.params.forActorType).toBe("OFFICER");
        }
      }
    });
  });
});
