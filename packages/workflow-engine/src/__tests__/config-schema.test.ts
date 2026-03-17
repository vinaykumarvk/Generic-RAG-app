import { describe, it, expect } from "vitest";
import {
  WfDefinitionSchema,
  validateDefinitionIntegrity,
  parseAndValidateDefinition,
} from "../config-schema";
import { ConfigError } from "../errors";
import type { WfDefinition } from "../types";

const validDef: WfDefinition = {
  workflowId: "TEST_WF",
  version: "1.0.0",
  states: [
    { stateId: "DRAFT", type: "DRAFT", taskRequired: false },
    { stateId: "SUBMITTED", type: "SYSTEM", taskRequired: false },
    { stateId: "REVIEW", type: "TASK", taskRequired: true, roleId: "REVIEWER", slaDays: 3 },
    { stateId: "APPROVED", type: "END", taskRequired: false },
  ],
  transitions: [
    { transitionId: "SUBMIT", fromStateId: "DRAFT", toStateId: "SUBMITTED", trigger: "manual" },
    { transitionId: "ASSIGN", fromStateId: "SUBMITTED", toStateId: "REVIEW", trigger: "system", actions: ["ASSIGN_NEXT_TASK"] },
    { transitionId: "APPROVE", fromStateId: "REVIEW", toStateId: "APPROVED", trigger: "manual" },
  ],
};

describe("WfDefinitionSchema", () => {
  it("parses a valid definition", () => {
    const result = WfDefinitionSchema.parse(validDef);
    expect(result.workflowId).toBe("TEST_WF");
    expect(result.states).toHaveLength(4);
    expect(result.transitions).toHaveLength(3);
  });

  it("parses definition with guards", () => {
    const defWithGuards = {
      ...validDef,
      transitions: [
        ...validDef.transitions.slice(0, 2),
        {
          transitionId: "APPROVE",
          fromStateId: "REVIEW",
          toStateId: "APPROVED",
          trigger: "manual",
          guards: [
            { type: "ACTOR_TYPE", params: { allowedTypes: ["OFFICER"] } },
            { type: "ACTOR_ROLE", params: { allowedRoles: ["REVIEWER"] } },
          ],
        },
      ],
    };
    const result = WfDefinitionSchema.parse(defWithGuards);
    expect(result.transitions[2].guards).toHaveLength(2);
  });

  it("parses definition with state metadata", () => {
    const defWithMeta = {
      ...validDef,
      states: [
        ...validDef.states.slice(0, 2),
        {
          stateId: "REVIEW",
          type: "TASK",
          taskRequired: true,
          roleId: "REVIEWER",
          slaDays: 3,
          metadata: {
            taskUi: { remarksRequired: true, checklist: [] },
          },
        },
        validDef.states[3],
      ],
    };
    const result = WfDefinitionSchema.parse(defWithMeta);
    expect(result.states[2].metadata).toBeDefined();
  });

  it("rejects missing workflowId", () => {
    const { workflowId, ...noId } = validDef;
    expect(() => WfDefinitionSchema.parse(noId)).toThrow();
  });

  it("rejects invalid trigger value", () => {
    const badTrigger = {
      ...validDef,
      transitions: [
        { transitionId: "BAD", fromStateId: "DRAFT", toStateId: "SUBMITTED", trigger: "auto" },
      ],
    };
    expect(() => WfDefinitionSchema.parse(badTrigger)).toThrow();
  });
});

describe("validateDefinitionIntegrity", () => {
  it("returns no errors for a valid definition", () => {
    const errors = validateDefinitionIntegrity(validDef);
    expect(errors).toHaveLength(0);
  });

  it("detects dangling fromStateId", () => {
    const badDef: WfDefinition = {
      ...validDef,
      transitions: [
        { transitionId: "BAD", fromStateId: "NONEXISTENT", toStateId: "SUBMITTED", trigger: "manual" },
      ],
    };
    const errors = validateDefinitionIntegrity(badDef);
    expect(errors.some((e) => e.type === "DANGLING_FROM_STATE")).toBe(true);
    expect(errors[0].stateId).toBe("NONEXISTENT");
  });

  it("detects dangling toStateId", () => {
    const badDef: WfDefinition = {
      ...validDef,
      transitions: [
        { transitionId: "BAD", fromStateId: "DRAFT", toStateId: "NONEXISTENT", trigger: "manual" },
      ],
    };
    const errors = validateDefinitionIntegrity(badDef);
    expect(errors.some((e) => e.type === "DANGLING_TO_STATE")).toBe(true);
  });

  it("detects duplicate state IDs", () => {
    const badDef: WfDefinition = {
      ...validDef,
      states: [
        ...validDef.states,
        { stateId: "DRAFT", type: "DRAFT", taskRequired: false },
      ],
    };
    const errors = validateDefinitionIntegrity(badDef);
    expect(errors.some((e) => e.type === "DUPLICATE_STATE_ID")).toBe(true);
  });

  it("detects duplicate transition IDs", () => {
    const badDef: WfDefinition = {
      ...validDef,
      transitions: [
        ...validDef.transitions,
        { transitionId: "SUBMIT", fromStateId: "SUBMITTED", toStateId: "REVIEW", trigger: "system" },
      ],
    };
    const errors = validateDefinitionIntegrity(badDef);
    expect(errors.some((e) => e.type === "DUPLICATE_TRANSITION_ID")).toBe(true);
  });

  it("detects task state missing roleId", () => {
    const badDef: WfDefinition = {
      ...validDef,
      states: [
        validDef.states[0],
        validDef.states[1],
        { stateId: "REVIEW", type: "TASK", taskRequired: true, slaDays: 3 },
        validDef.states[3],
      ],
    };
    const errors = validateDefinitionIntegrity(badDef);
    expect(errors.some((e) => e.type === "TASK_STATE_MISSING_ROLE")).toBe(true);
  });
});

describe("parseAndValidateDefinition", () => {
  it("returns parsed definition for valid input", () => {
    const result = parseAndValidateDefinition(validDef);
    expect(result.workflowId).toBe("TEST_WF");
  });

  it("throws ConfigError for integrity errors", () => {
    const badDef = {
      ...validDef,
      transitions: [
        { transitionId: "BAD", fromStateId: "NONEXISTENT", toStateId: "SUBMITTED", trigger: "manual" },
      ],
    };
    expect(() => parseAndValidateDefinition(badDef)).toThrow(ConfigError);
  });

  it("throws Zod error for structurally invalid input", () => {
    expect(() => parseAndValidateDefinition({ workflowId: 123 })).toThrow();
  });
});
