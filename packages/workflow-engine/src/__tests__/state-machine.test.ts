import { describe, it, expect } from "vitest";
import {
  findTransition,
  findState,
  validateFromState,
  validateTrigger,
} from "../core/state-machine";
import type { WfDefinition } from "../types";

const sampleDef: WfDefinition = {
  workflowId: "TEST_WF",
  version: "1.0.0",
  states: [
    { stateId: "DRAFT", type: "DRAFT", taskRequired: false },
    { stateId: "SUBMITTED", type: "SYSTEM", taskRequired: false },
    { stateId: "PENDING_REVIEW", type: "TASK", taskRequired: true, roleId: "REVIEWER", slaDays: 3 },
    { stateId: "APPROVED", type: "END", taskRequired: false },
    { stateId: "REJECTED", type: "END", taskRequired: false },
  ],
  transitions: [
    { transitionId: "SUBMIT", fromStateId: "DRAFT", toStateId: "SUBMITTED", trigger: "manual" },
    { transitionId: "ASSIGN", fromStateId: "SUBMITTED", toStateId: "PENDING_REVIEW", trigger: "system", actions: ["ASSIGN_NEXT_TASK"] },
    { transitionId: "APPROVE", fromStateId: "PENDING_REVIEW", toStateId: "APPROVED", trigger: "manual" },
    { transitionId: "REJECT", fromStateId: "PENDING_REVIEW", toStateId: "REJECTED", trigger: "manual" },
  ],
};

describe("findTransition", () => {
  it("returns the matching transition", () => {
    const t = findTransition(sampleDef, "SUBMIT");
    expect(t).toBeDefined();
    expect(t!.fromStateId).toBe("DRAFT");
    expect(t!.toStateId).toBe("SUBMITTED");
  });

  it("returns undefined for unknown transition", () => {
    expect(findTransition(sampleDef, "NONEXISTENT")).toBeUndefined();
  });
});

describe("findState", () => {
  it("returns the matching state", () => {
    const s = findState(sampleDef, "PENDING_REVIEW");
    expect(s).toBeDefined();
    expect(s!.type).toBe("TASK");
    expect(s!.roleId).toBe("REVIEWER");
  });

  it("returns undefined for unknown state", () => {
    expect(findState(sampleDef, "NONEXISTENT")).toBeUndefined();
  });
});

describe("validateFromState", () => {
  it("returns true when current state matches transition fromState", () => {
    const t = findTransition(sampleDef, "SUBMIT")!;
    expect(validateFromState(t, "DRAFT")).toBe(true);
  });

  it("returns false when current state does not match", () => {
    const t = findTransition(sampleDef, "SUBMIT")!;
    expect(validateFromState(t, "SUBMITTED")).toBe(false);
  });
});

describe("validateTrigger", () => {
  it("returns true for manual transition with non-SYSTEM actor", () => {
    const t = findTransition(sampleDef, "SUBMIT")!;
    expect(validateTrigger(t, "CITIZEN")).toBe(true);
    expect(validateTrigger(t, "OFFICER")).toBe(true);
  });

  it("returns false for manual transition with SYSTEM actor", () => {
    const t = findTransition(sampleDef, "SUBMIT")!;
    expect(validateTrigger(t, "SYSTEM")).toBe(false);
  });

  it("returns true for system transition regardless of actor type", () => {
    const t = findTransition(sampleDef, "ASSIGN")!;
    expect(validateTrigger(t, "SYSTEM")).toBe(true);
    expect(validateTrigger(t, "OFFICER")).toBe(true);
    expect(validateTrigger(t, "CITIZEN")).toBe(true);
  });
});
