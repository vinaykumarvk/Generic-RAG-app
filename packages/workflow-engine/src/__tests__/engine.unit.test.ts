import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowEngine } from "../core/engine";
import type {
  ActionHandler,
  Actor,
  AuditWriter,
  EntityState,
  PostCommitHook,
  StorageAdapter,
  TaskManager,
  TransactionHandle,
  TransactionManager,
  WfDefinition,
  WorkflowEngineOptions,
} from "../types";
import { ActorTypeGuardEvaluator, ActorRoleGuardEvaluator } from "../core/guard-evaluator";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const testDefinition: WfDefinition = {
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
    {
      transitionId: "SUBMIT",
      fromStateId: "DRAFT",
      toStateId: "SUBMITTED",
      trigger: "manual",
      guards: [{ type: "ACTOR_TYPE", params: { allowedTypes: ["CITIZEN"] } }],
    },
    {
      transitionId: "ASSIGN_REVIEW",
      fromStateId: "SUBMITTED",
      toStateId: "PENDING_REVIEW",
      trigger: "system",
      actions: ["ASSIGN_NEXT_TASK"],
    },
    {
      transitionId: "APPROVE",
      fromStateId: "PENDING_REVIEW",
      toStateId: "APPROVED",
      trigger: "manual",
      guards: [{ type: "ACTOR_ROLE", params: { allowedRoles: ["REVIEWER"] } }],
      actions: ["RECORD_DECISION"],
    },
    {
      transitionId: "REJECT",
      fromStateId: "PENDING_REVIEW",
      toStateId: "REJECTED",
      trigger: "manual",
      guards: [{ type: "ACTOR_ROLE", params: { allowedRoles: ["REVIEWER"] } }],
      actions: ["RECORD_DECISION"],
    },
  ],
};

function makeEntityState(overrides?: Partial<EntityState>): EntityState {
  return {
    entityId: "entity-1",
    entityType: "application",
    currentStateId: "DRAFT",
    workflowId: "TEST_WF",
    workflowVersion: "1.0.0",
    rowVersion: 1,
    ...overrides,
  };
}

const citizenActor: Actor = { actorId: "citizen-1", actorType: "CITIZEN", roles: [] };
const officerActor: Actor = { actorId: "officer-1", actorType: "OFFICER", roles: ["REVIEWER"] };
const systemActor: Actor = { actorId: "system", actorType: "SYSTEM", roles: [] };

// ── Mock Implementations ──────────────────────────────────────────────────────

function createMockTxnManager(): TransactionManager {
  return {
    async runInTransaction<T>(fn: (txn: TransactionHandle) => Promise<T>, existingTxn?: TransactionHandle): Promise<T> {
      const txn: TransactionHandle = existingTxn ?? { client: "mock-client" };
      return fn(txn);
    },
  };
}

function createMockStorage(entityState: EntityState | null, definition: WfDefinition | null): StorageAdapter {
  return {
    loadEntityForUpdate: vi.fn().mockResolvedValue(entityState),
    loadWorkflowDefinition: vi.fn().mockResolvedValue(definition),
    updateEntityState: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAuditWriter(): AuditWriter {
  return {
    writeTransitionEvent: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockTaskManager(): TaskManager {
  return {
    createTask: vi.fn().mockResolvedValue("task-1"),
    completeCurrentTask: vi.fn().mockResolvedValue(undefined),
    hasOpenTask: vi.fn().mockResolvedValue(false),
  };
}

function createEngine(overrides?: Partial<WorkflowEngineOptions>): WorkflowEngine {
  const defaults: WorkflowEngineOptions = {
    storageAdapter: createMockStorage(makeEntityState(), testDefinition),
    transactionManager: createMockTxnManager(),
    auditWriter: createMockAuditWriter(),
    guardEvaluators: [new ActorTypeGuardEvaluator(), new ActorRoleGuardEvaluator()],
    actionHandlers: [],
    taskManager: createMockTaskManager(),
  };
  return new WorkflowEngine({ ...defaults, ...overrides });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkflowEngine.executeTransition", () => {
  it("executes a valid CITIZEN SUBMIT transition", async () => {
    const engine = createEngine();
    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: citizenActor,
    });
    expect(result.success).toBe(true);
    expect(result.newStateId).toBe("SUBMITTED");
  });

  it("calls storageAdapter.updateEntityState with correct params", async () => {
    const storage = createMockStorage(makeEntityState(), testDefinition);
    const engine = createEngine({ storageAdapter: storage });

    await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: citizenActor,
    });

    expect(storage.updateEntityState).toHaveBeenCalledWith(
      { entityId: "entity-1", entityType: "application" },
      "SUBMITTED",
      2, // rowVersion + 1
      expect.anything()
    );
  });

  it("writes an audit event", async () => {
    const audit = createMockAuditWriter();
    const engine = createEngine({ auditWriter: audit });

    await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: citizenActor,
      remarks: "Submitting",
    });

    expect(audit.writeTransitionEvent).toHaveBeenCalledWith(
      { entityId: "entity-1", entityType: "application" },
      "DRAFT",
      "SUBMITTED",
      "SUBMIT",
      citizenActor,
      "Submitting",
      expect.anything()
    );
  });

  it("returns ENTITY_NOT_FOUND when entity does not exist", async () => {
    const storage = createMockStorage(null, testDefinition);
    const engine = createEngine({ storageAdapter: storage });

    const result = await engine.executeTransition({
      entityRef: { entityId: "nonexistent", entityType: "application" },
      transitionId: "SUBMIT",
      actor: citizenActor,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("ENTITY_NOT_FOUND");
  });

  it("returns DEFINITION_NOT_FOUND when workflow definition is missing", async () => {
    const storage = createMockStorage(makeEntityState(), null);
    const engine = createEngine({ storageAdapter: storage });

    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: citizenActor,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("DEFINITION_NOT_FOUND");
  });

  it("returns TRANSITION_NOT_FOUND for unknown transition", async () => {
    const engine = createEngine();
    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "NONEXISTENT",
      actor: citizenActor,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("TRANSITION_NOT_FOUND");
  });

  it("returns INVALID_STATE when entity is in wrong state", async () => {
    const storage = createMockStorage(
      makeEntityState({ currentStateId: "SUBMITTED" }),
      testDefinition
    );
    const engine = createEngine({ storageAdapter: storage });

    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: citizenActor,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INVALID_STATE");
  });

  it("returns INVALID_TRIGGER when SYSTEM tries manual transition", async () => {
    const engine = createEngine();
    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: systemActor,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INVALID_TRIGGER");
  });

  it("allows SYSTEM actor on system transitions", async () => {
    const storage = createMockStorage(
      makeEntityState({ currentStateId: "SUBMITTED" }),
      testDefinition
    );
    const engine = createEngine({ storageAdapter: storage });

    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "ASSIGN_REVIEW",
      actor: systemActor,
    });

    expect(result.success).toBe(true);
    expect(result.newStateId).toBe("PENDING_REVIEW");
  });

  it("enforces ACTOR_TYPE guard", async () => {
    const engine = createEngine();
    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: officerActor, // OFFICER, but guard requires CITIZEN
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("UNAUTHORIZED_ACTOR_TYPE");
  });

  it("enforces ACTOR_ROLE guard", async () => {
    const storage = createMockStorage(
      makeEntityState({ currentStateId: "PENDING_REVIEW" }),
      testDefinition
    );
    const engine = createEngine({ storageAdapter: storage });

    const badOfficer: Actor = { actorId: "o2", actorType: "OFFICER", roles: ["CLERK"] };
    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "APPROVE",
      actor: badOfficer,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("UNAUTHORIZED_ROLE");
  });

  it("dispatches action handlers", async () => {
    const handler: ActionHandler = {
      actionKey: "RECORD_DECISION",
      execute: vi.fn().mockResolvedValue(undefined),
    };

    const storage = createMockStorage(
      makeEntityState({ currentStateId: "PENDING_REVIEW" }),
      testDefinition
    );
    const engine = createEngine({
      storageAdapter: storage,
      actionHandlers: [handler],
    });

    await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "APPROVE",
      actor: officerActor,
      payload: { decision: "APPROVE" },
    });

    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(handler.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStateId: "PENDING_REVIEW",
        toStateId: "APPROVED",
        actor: officerActor,
      })
    );
  });

  it("does not throw for unregistered action keys (logs warning)", async () => {
    const storage = createMockStorage(
      makeEntityState({ currentStateId: "SUBMITTED" }),
      testDefinition
    );
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const engine = createEngine({
      storageAdapter: storage,
      actionHandlers: [], // No handler for ASSIGN_NEXT_TASK
      logger,
    });

    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "ASSIGN_REVIEW",
      actor: systemActor,
    });

    expect(result.success).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("auto-creates task via safety net when target state requires it", async () => {
    // Definition where ASSIGN_REVIEW goes to PENDING_REVIEW but has NO ASSIGN_NEXT_TASK action
    const defNoAction: WfDefinition = {
      ...testDefinition,
      transitions: testDefinition.transitions.map((t) =>
        t.transitionId === "ASSIGN_REVIEW"
          ? { ...t, actions: [] } // Remove ASSIGN_NEXT_TASK
          : t
      ),
    };
    const storage = createMockStorage(
      makeEntityState({ currentStateId: "SUBMITTED" }),
      defNoAction
    );
    const taskManager = createMockTaskManager();
    const engine = createEngine({ storageAdapter: storage, taskManager });

    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "ASSIGN_REVIEW",
      actor: systemActor,
    });

    expect(result.success).toBe(true);
    // Safety net should have called createTask
    expect(taskManager.createTask).toHaveBeenCalledWith(
      { entityId: "entity-1", entityType: "application" },
      "PENDING_REVIEW",
      "REVIEWER",
      expect.any(Date), // SLA fallback to calendar days
      {},
      expect.anything()
    );
  });

  it("completes current task for non-SYSTEM actors", async () => {
    const storage = createMockStorage(
      makeEntityState({ currentStateId: "PENDING_REVIEW" }),
      testDefinition
    );
    const taskManager = createMockTaskManager();
    const engine = createEngine({ storageAdapter: storage, taskManager });

    await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "APPROVE",
      actor: officerActor,
      payload: { decision: "APPROVE" },
      remarks: "Looks good",
    });

    expect(taskManager.completeCurrentTask).toHaveBeenCalledWith(
      { entityId: "entity-1", entityType: "application" },
      officerActor,
      "APPROVE",
      "Looks good",
      expect.anything()
    );
  });

  it("does not complete task for SYSTEM actors", async () => {
    const storage = createMockStorage(
      makeEntityState({ currentStateId: "SUBMITTED" }),
      testDefinition
    );
    const taskManager = createMockTaskManager();
    const engine = createEngine({ storageAdapter: storage, taskManager });

    await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "ASSIGN_REVIEW",
      actor: systemActor,
    });

    expect(taskManager.completeCurrentTask).not.toHaveBeenCalled();
  });

  it("fires post-commit hooks after successful transition", async () => {
    const hook: PostCommitHook = {
      hookId: "test-hook",
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const engine = createEngine({ postCommitHooks: [hook] });

    await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: citizenActor,
    });

    expect(hook.execute).toHaveBeenCalledWith(
      { entityId: "entity-1", entityType: "application" },
      "DRAFT",
      "SUBMITTED",
      "SUBMIT",
      citizenActor,
      undefined
    );
  });

  it("does not fire post-commit hooks on failed transition", async () => {
    const hook: PostCommitHook = {
      hookId: "test-hook",
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const storage = createMockStorage(null, testDefinition);
    const engine = createEngine({ storageAdapter: storage, postCommitHooks: [hook] });

    await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: citizenActor,
    });

    expect(hook.execute).not.toHaveBeenCalled();
  });

  it("catches post-commit hook errors without failing the result", async () => {
    const hook: PostCommitHook = {
      hookId: "failing-hook",
      execute: vi.fn().mockRejectedValue(new Error("hook failed")),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const engine = createEngine({ postCommitHooks: [hook], logger });

    const result = await engine.executeTransition({
      entityRef: { entityId: "entity-1", entityType: "application" },
      transitionId: "SUBMIT",
      actor: citizenActor,
    });

    expect(result.success).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it("joins existing transaction without creating a new one", async () => {
    const existingTxn: TransactionHandle = { client: "existing-client" };
    const storage = createMockStorage(makeEntityState(), testDefinition);
    const txnManager: TransactionManager = {
      runInTransaction: vi.fn(async (fn, existing) => fn(existing ?? existingTxn)),
    };
    const engine = createEngine({ storageAdapter: storage, transactionManager: txnManager });

    await engine.executeTransition(
      {
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      },
      existingTxn
    );

    expect(txnManager.runInTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      existingTxn
    );
  });

  it("does not fire post-commit hooks when joining an existing transaction", async () => {
    const hook: PostCommitHook = {
      hookId: "test-hook",
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const existingTxn: TransactionHandle = { client: "existing-client" };
    const engine = createEngine({ postCommitHooks: [hook] });

    await engine.executeTransition(
      {
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      },
      existingTxn
    );

    expect(hook.execute).not.toHaveBeenCalled();
  });
});

// ── Lifecycle Hook Tests ──────────────────────────────────────────────────────

describe("WorkflowEngine lifecycle hooks", () => {
  describe("onBeforeTransition", () => {
    it("fires before a successful transition with correct context", async () => {
      const onBeforeTransition = vi.fn();
      const engine = createEngine({ onBeforeTransition });

      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
        remarks: "Please process",
        payload: { urgent: true },
      });

      expect(onBeforeTransition).toHaveBeenCalledTimes(1);
      expect(onBeforeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityRef: { entityId: "entity-1", entityType: "application" },
          transitionId: "SUBMIT",
          actor: citizenActor,
          remarks: "Please process",
          payload: { urgent: true },
          fromStateId: "DRAFT",
          toStateId: "SUBMITTED",
          entityState: expect.objectContaining({ currentStateId: "DRAFT" }),
          definition: expect.objectContaining({ workflowId: "TEST_WF" }),
        })
      );
    });

    it("fires before state update (state still shows old value)", async () => {
      const storage = createMockStorage(makeEntityState(), testDefinition);
      const callOrder: string[] = [];

      (storage.updateEntityState as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push("updateEntityState");
      });

      const onBeforeTransition = vi.fn().mockImplementation(() => {
        callOrder.push("onBeforeTransition");
      });

      const engine = createEngine({ storageAdapter: storage, onBeforeTransition });

      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      });

      expect(callOrder).toEqual(["onBeforeTransition", "updateEntityState"]);
    });

    it("does not fire when validation fails (e.g. ENTITY_NOT_FOUND)", async () => {
      const onBeforeTransition = vi.fn();
      const storage = createMockStorage(null, testDefinition);
      const engine = createEngine({ storageAdapter: storage, onBeforeTransition });

      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      });

      expect(onBeforeTransition).not.toHaveBeenCalled();
    });

    it("does not fire when guard fails", async () => {
      const onBeforeTransition = vi.fn();
      const engine = createEngine({ onBeforeTransition });

      // OFFICER can't SUBMIT (guard requires CITIZEN)
      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: officerActor,
      });

      expect(onBeforeTransition).not.toHaveBeenCalled();
    });

    it("aborts transition if hook throws", async () => {
      const onBeforeTransition = vi.fn().mockRejectedValue(new Error("Blocked by hook"));
      const storage = createMockStorage(makeEntityState(), testDefinition);
      const engine = createEngine({ storageAdapter: storage, onBeforeTransition });

      const result = await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Blocked by hook");
      // State should NOT have been updated
      expect(storage.updateEntityState).not.toHaveBeenCalled();
    });
  });

  describe("onAfterTransition", () => {
    it("fires after a successful transition with correct context", async () => {
      const onAfterTransition = vi.fn();
      const engine = createEngine({ onAfterTransition });

      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
        remarks: "Done",
        payload: { extra: "data" },
      });

      expect(onAfterTransition).toHaveBeenCalledTimes(1);
      expect(onAfterTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          entityRef: { entityId: "entity-1", entityType: "application" },
          transitionId: "SUBMIT",
          actor: citizenActor,
          remarks: "Done",
          payload: { extra: "data" },
          fromStateId: "DRAFT",
          toStateId: "SUBMITTED",
          newRowVersion: 2,
        })
      );
    });

    it("fires after post-commit hooks", async () => {
      const callOrder: string[] = [];

      const hook: PostCommitHook = {
        hookId: "test-hook",
        execute: vi.fn().mockImplementation(async () => {
          callOrder.push("postCommitHook");
        }),
      };

      const onAfterTransition = vi.fn().mockImplementation(() => {
        callOrder.push("onAfterTransition");
      });

      const engine = createEngine({ postCommitHooks: [hook], onAfterTransition });

      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      });

      expect(callOrder).toEqual(["postCommitHook", "onAfterTransition"]);
    });

    it("does not fire on failed transition", async () => {
      const onAfterTransition = vi.fn();
      const storage = createMockStorage(null, testDefinition);
      const engine = createEngine({ storageAdapter: storage, onAfterTransition });

      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      });

      expect(onAfterTransition).not.toHaveBeenCalled();
    });

    it("does not fail the result if hook throws (error is logged)", async () => {
      const onAfterTransition = vi.fn().mockRejectedValue(new Error("After hook failed"));
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const engine = createEngine({ onAfterTransition, logger });

      const result = await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      });

      // Transition still succeeds — onAfterTransition failure is non-fatal
      expect(result.success).toBe(true);
      expect(result.newStateId).toBe("SUBMITTED");
      expect(logger.error).toHaveBeenCalledWith(
        "onAfterTransition hook failed",
        expect.objectContaining({ entityId: "entity-1" })
      );
    });
  });

  describe("onTransitionError", () => {
    it("fires when an action handler throws", async () => {
      const onTransitionError = vi.fn();
      const failingHandler: ActionHandler = {
        actionKey: "RECORD_DECISION",
        execute: vi.fn().mockRejectedValue(new Error("DB connection lost")),
      };

      const storage = createMockStorage(
        makeEntityState({ currentStateId: "PENDING_REVIEW" }),
        testDefinition
      );
      const engine = createEngine({
        storageAdapter: storage,
        actionHandlers: [failingHandler],
        onTransitionError,
      });

      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "APPROVE",
        actor: officerActor,
      });

      expect(onTransitionError).toHaveBeenCalledTimes(1);
      expect(onTransitionError).toHaveBeenCalledWith(
        expect.objectContaining({
          entityRef: { entityId: "entity-1", entityType: "application" },
          transitionId: "APPROVE",
          actor: officerActor,
          error: expect.objectContaining({ message: "DB connection lost" }),
        })
      );
    });

    it("includes errorCode when the thrown error is a TransitionError", async () => {
      const { TransitionError } = await import("../errors");
      const onTransitionError = vi.fn();
      const failingHandler: ActionHandler = {
        actionKey: "RECORD_DECISION",
        execute: vi.fn().mockRejectedValue(
          new TransitionError("Custom failure", "CUSTOM_CODE")
        ),
      };

      const storage = createMockStorage(
        makeEntityState({ currentStateId: "PENDING_REVIEW" }),
        testDefinition
      );
      const engine = createEngine({
        storageAdapter: storage,
        actionHandlers: [failingHandler],
        onTransitionError,
      });

      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "APPROVE",
        actor: officerActor,
      });

      expect(onTransitionError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "CUSTOM_CODE",
        })
      );
    });

    it("does not fire on successful transitions", async () => {
      const onTransitionError = vi.fn();
      const engine = createEngine({ onTransitionError });

      await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      });

      expect(onTransitionError).not.toHaveBeenCalled();
    });

    it("does not fire for soft failures (ENTITY_NOT_FOUND etc.)", async () => {
      const onTransitionError = vi.fn();
      const storage = createMockStorage(null, testDefinition);
      const engine = createEngine({ storageAdapter: storage, onTransitionError });

      const result = await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "SUBMIT",
        actor: citizenActor,
      });

      // Soft failure — returned from inside the transaction, not thrown
      expect(result.success).toBe(false);
      expect(onTransitionError).not.toHaveBeenCalled();
    });

    it("logs an error if the hook itself throws", async () => {
      const onTransitionError = vi.fn().mockRejectedValue(new Error("Hook also broke"));
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const failingHandler: ActionHandler = {
        actionKey: "RECORD_DECISION",
        execute: vi.fn().mockRejectedValue(new Error("Original error")),
      };

      const storage = createMockStorage(
        makeEntityState({ currentStateId: "PENDING_REVIEW" }),
        testDefinition
      );
      const engine = createEngine({
        storageAdapter: storage,
        actionHandlers: [failingHandler],
        onTransitionError,
        logger,
      });

      const result = await engine.executeTransition({
        entityRef: { entityId: "entity-1", entityType: "application" },
        transitionId: "APPROVE",
        actor: officerActor,
      });

      // Original error is still returned
      expect(result.success).toBe(false);
      expect(result.error).toContain("Original error");
      // Hook failure is logged
      expect(logger.error).toHaveBeenCalledWith(
        "onTransitionError hook failed",
        expect.objectContaining({ entityId: "entity-1" })
      );
    });
  });
});
