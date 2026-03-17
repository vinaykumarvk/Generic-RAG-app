import { describe, it, expect } from "vitest";
import {
  ActorTypeGuardEvaluator,
  ActorRoleGuardEvaluator,
  evaluateAllGuards,
} from "../core/guard-evaluator";
import type { Actor, EntityState, GuardEvaluator, TransactionHandle, WfGuard } from "../types";

const mockTxn: TransactionHandle = { client: null };

const mockEntityState: EntityState = {
  entityId: "test-entity-1",
  entityType: "application",
  currentStateId: "PENDING_REVIEW",
  workflowId: "TEST_WF",
  workflowVersion: "1.0.0",
  rowVersion: 1,
};

describe("ActorTypeGuardEvaluator", () => {
  const evaluator = new ActorTypeGuardEvaluator();

  it("passes when actor type is in allowed list", async () => {
    const guard: WfGuard = {
      type: "ACTOR_TYPE",
      params: { allowedTypes: ["CITIZEN", "OFFICER"] },
    };
    const actor: Actor = { actorId: "u1", actorType: "CITIZEN", roles: [] };
    const result = await evaluator.evaluate(guard, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(true);
  });

  it("fails when actor type is not in allowed list", async () => {
    const guard: WfGuard = {
      type: "ACTOR_TYPE",
      params: { allowedTypes: ["CITIZEN"] },
    };
    const actor: Actor = { actorId: "u1", actorType: "OFFICER", roles: [] };
    const result = await evaluator.evaluate(guard, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(false);
    expect(result.errorCode).toBe("UNAUTHORIZED_ACTOR_TYPE");
  });

  it("passes when allowedTypes is empty", async () => {
    const guard: WfGuard = { type: "ACTOR_TYPE", params: { allowedTypes: [] } };
    const actor: Actor = { actorId: "u1", actorType: "ANALYST", roles: [] };
    const result = await evaluator.evaluate(guard, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(true);
  });

  it("passes when allowedTypes is not set", async () => {
    const guard: WfGuard = { type: "ACTOR_TYPE", params: {} };
    const actor: Actor = { actorId: "u1", actorType: "ANALYST", roles: [] };
    const result = await evaluator.evaluate(guard, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(true);
  });
});

describe("ActorRoleGuardEvaluator", () => {
  const evaluator = new ActorRoleGuardEvaluator();

  it("passes when actor has one of the allowed roles", async () => {
    const guard: WfGuard = {
      type: "ACTOR_ROLE",
      params: { allowedRoles: ["CLERK", "SDO"] },
    };
    const actor: Actor = { actorId: "u1", actorType: "OFFICER", roles: ["CLERK"] };
    const result = await evaluator.evaluate(guard, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(true);
  });

  it("fails when actor has none of the allowed roles", async () => {
    const guard: WfGuard = {
      type: "ACTOR_ROLE",
      params: { allowedRoles: ["CLERK", "SDO"] },
    };
    const actor: Actor = { actorId: "u1", actorType: "OFFICER", roles: ["JUNIOR_ENGINEER"] };
    const result = await evaluator.evaluate(guard, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(false);
    expect(result.errorCode).toBe("UNAUTHORIZED_ROLE");
  });

  it("passes when allowedRoles is empty", async () => {
    const guard: WfGuard = { type: "ACTOR_ROLE", params: { allowedRoles: [] } };
    const actor: Actor = { actorId: "u1", actorType: "OFFICER", roles: [] };
    const result = await evaluator.evaluate(guard, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(true);
  });

  it("passes when forActorType does not match (guard not applicable)", async () => {
    const guard: WfGuard = {
      type: "ACTOR_ROLE",
      params: { allowedRoles: ["CLERK"], forActorType: "OFFICER" },
    };
    const actor: Actor = { actorId: "u1", actorType: "CITIZEN", roles: [] };
    const result = await evaluator.evaluate(guard, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(true);
  });

  it("evaluates when forActorType matches", async () => {
    const guard: WfGuard = {
      type: "ACTOR_ROLE",
      params: { allowedRoles: ["CLERK"], forActorType: "OFFICER" },
    };
    const actorWithRole: Actor = { actorId: "u1", actorType: "OFFICER", roles: ["CLERK"] };
    const actorWithout: Actor = { actorId: "u2", actorType: "OFFICER", roles: ["SDO"] };

    expect((await evaluator.evaluate(guard, actorWithRole, mockEntityState, mockTxn)).passed).toBe(true);
    expect((await evaluator.evaluate(guard, actorWithout, mockEntityState, mockTxn)).passed).toBe(false);
  });
});

describe("evaluateAllGuards", () => {
  const typeEval = new ActorTypeGuardEvaluator();
  const roleEval = new ActorRoleGuardEvaluator();
  const evaluators: GuardEvaluator[] = [typeEval, roleEval];

  it("passes when all guards pass", async () => {
    const guards: WfGuard[] = [
      { type: "ACTOR_TYPE", params: { allowedTypes: ["OFFICER"] } },
      { type: "ACTOR_ROLE", params: { allowedRoles: ["CLERK"] } },
    ];
    const actor: Actor = { actorId: "u1", actorType: "OFFICER", roles: ["CLERK"] };
    const result = await evaluateAllGuards(guards, evaluators, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(true);
  });

  it("fails on first failing guard", async () => {
    const guards: WfGuard[] = [
      { type: "ACTOR_TYPE", params: { allowedTypes: ["CITIZEN"] } },
      { type: "ACTOR_ROLE", params: { allowedRoles: ["CLERK"] } },
    ];
    const actor: Actor = { actorId: "u1", actorType: "OFFICER", roles: ["CLERK"] };
    const result = await evaluateAllGuards(guards, evaluators, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(false);
    expect(result.errorCode).toBe("UNAUTHORIZED_ACTOR_TYPE");
  });

  it("passes when guards array is empty", async () => {
    const actor: Actor = { actorId: "u1", actorType: "OFFICER", roles: [] };
    const result = await evaluateAllGuards([], evaluators, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(true);
  });

  it("fails for unknown guard type", async () => {
    const guards: WfGuard[] = [
      { type: "CUSTOM_UNKNOWN", params: {} },
    ];
    const actor: Actor = { actorId: "u1", actorType: "OFFICER", roles: [] };
    const result = await evaluateAllGuards(guards, evaluators, actor, mockEntityState, mockTxn);
    expect(result.passed).toBe(false);
    expect(result.errorCode).toBe("UNKNOWN_GUARD_TYPE");
    expect(result.guardType).toBe("CUSTOM_UNKNOWN");
  });
});
