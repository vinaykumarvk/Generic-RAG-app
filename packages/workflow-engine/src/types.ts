import type { PoolClient } from "pg";

// ── Configuration ──────────────────────────────────────────────────────────────

export interface WfState {
  stateId: string;
  type: string;
  taskRequired: boolean;
  roleId?: string;
  slaDays?: number;
  metadata?: Record<string, unknown>;
}

export interface WfGuard {
  type: string;
  params: Record<string, unknown>;
}

export interface WfTransition {
  transitionId: string;
  fromStateId: string;
  toStateId: string;
  trigger: "manual" | "system";
  guards?: WfGuard[];
  actions?: string[];
  metadata?: Record<string, unknown>;
}

export interface WfDefinition {
  workflowId: string;
  version: string;
  states: WfState[];
  transitions: WfTransition[];
}

// ── Runtime ────────────────────────────────────────────────────────────────────

export interface EntityRef {
  entityId: string;
  entityType: string;
}

export interface Actor {
  actorId: string;
  actorType: string;
  roles: string[];
  metadata?: Record<string, unknown>;
}

export interface TransitionRequest {
  entityRef: EntityRef;
  transitionId: string;
  actor: Actor;
  remarks?: string;
  payload?: Record<string, unknown>;
}

export interface TransitionResult {
  success: boolean;
  newStateId?: string;
  error?: string;
  errorCode?: string;
}

export interface EntityState {
  entityId: string;
  entityType: string;
  currentStateId: string;
  workflowId: string;
  workflowVersion: string;
  rowVersion: number;
  metadata?: Record<string, unknown>;
}

// ── Extension Point Interfaces ─────────────────────────────────────────────────

export interface TransactionHandle {
  client: unknown;
}

export interface PgTransactionHandle extends TransactionHandle {
  client: PoolClient;
}

export interface TransactionManager {
  runInTransaction<T>(
    fn: (txn: TransactionHandle) => Promise<T>,
    existingTxn?: TransactionHandle
  ): Promise<T>;
}

export interface StorageAdapter {
  loadEntityForUpdate(
    entityRef: EntityRef,
    txn: TransactionHandle
  ): Promise<EntityState | null>;

  loadWorkflowDefinition(
    entityState: EntityState,
    txn: TransactionHandle
  ): Promise<WfDefinition | null>;

  updateEntityState(
    entityRef: EntityRef,
    newStateId: string,
    newRowVersion: number,
    txn: TransactionHandle
  ): Promise<void>;
}

export interface GuardEvaluator {
  guardType: string;
  evaluate(
    guard: WfGuard,
    actor: Actor,
    entityState: EntityState,
    txn: TransactionHandle
  ): Promise<{ passed: boolean; errorCode?: string }>;
}

export interface ActionHandler {
  actionKey: string;
  execute(ctx: ActionContext): Promise<void>;
}

export interface ActionContext {
  entityRef: EntityRef;
  entityState: EntityState;
  fromStateId: string;
  toStateId: string;
  targetState: WfState;
  definition: WfDefinition;
  actor: Actor;
  payload?: Record<string, unknown>;
  remarks?: string;
  txn: TransactionHandle;
}

export interface AuditWriter {
  writeTransitionEvent(
    entityRef: EntityRef,
    fromStateId: string,
    toStateId: string,
    transitionId: string,
    actor: Actor,
    remarks: string | undefined,
    txn: TransactionHandle
  ): Promise<void>;
}

export interface TaskManager {
  createTask(
    entityRef: EntityRef,
    stateId: string,
    roleId: string,
    slaDueAt: Date | null,
    metadata: Record<string, unknown>,
    txn: TransactionHandle
  ): Promise<string>;

  completeCurrentTask(
    entityRef: EntityRef,
    actor: Actor,
    decision: string,
    remarks: string | undefined,
    txn: TransactionHandle
  ): Promise<void>;

  hasOpenTask(
    entityRef: EntityRef,
    stateId: string,
    txn: TransactionHandle
  ): Promise<boolean>;
}

export interface SLACalculator {
  calculateDueDate(
    startDate: Date,
    workingDays: number,
    context: Record<string, unknown>,
    txn: TransactionHandle
  ): Promise<Date>;
}

export interface PostCommitHook {
  hookId: string;
  execute(
    entityRef: EntityRef,
    fromStateId: string,
    toStateId: string,
    transitionId: string,
    actor: Actor,
    payload?: Record<string, unknown>
  ): Promise<void>;
}

export interface EngineLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface LifecycleContext {
  entityRef: EntityRef;
  transitionId: string;
  actor: Actor;
  remarks?: string;
  payload?: Record<string, unknown>;
}

export interface BeforeTransitionContext extends LifecycleContext {
  entityState: EntityState;
  definition: WfDefinition;
  fromStateId: string;
  toStateId: string;
}

export interface AfterTransitionContext extends LifecycleContext {
  fromStateId: string;
  toStateId: string;
  newRowVersion: number;
}

export interface TransitionErrorContext extends LifecycleContext {
  error: Error;
  errorCode?: string;
}

export interface WorkflowEngineOptions {
  storageAdapter: StorageAdapter;
  transactionManager: TransactionManager;
  auditWriter: AuditWriter;
  guardEvaluators?: GuardEvaluator[];
  actionHandlers?: ActionHandler[];
  taskManager?: TaskManager;
  slaCalculator?: SLACalculator;
  postCommitHooks?: PostCommitHook[];
  logger?: EngineLogger;
  onBeforeTransition?: (ctx: BeforeTransitionContext) => Promise<void> | void;
  onAfterTransition?: (ctx: AfterTransitionContext) => Promise<void> | void;
  onTransitionError?: (ctx: TransitionErrorContext) => Promise<void> | void;
}
