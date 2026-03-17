// Types
export type {
  WfState,
  WfGuard,
  WfTransition,
  WfDefinition,
  EntityRef,
  Actor,
  TransitionRequest,
  TransitionResult,
  EntityState,
  TransactionHandle,
  PgTransactionHandle,
  TransactionManager,
  StorageAdapter,
  GuardEvaluator,
  ActionHandler,
  ActionContext,
  AuditWriter,
  TaskManager,
  SLACalculator,
  PostCommitHook,
  EngineLogger,
  LifecycleContext,
  BeforeTransitionContext,
  AfterTransitionContext,
  TransitionErrorContext,
  WorkflowEngineOptions,
} from "./types";

// Errors
export { WorkflowError, TransitionError, GuardError, ConfigError } from "./errors";

// Config schema + validation
export {
  WfStateSchema,
  WfGuardSchema,
  WfTransitionSchema,
  WfDefinitionSchema,
  validateDefinitionIntegrity,
  parseAndValidateDefinition,
} from "./config-schema";
export type { IntegrityError } from "./config-schema";

// Core — state machine
export {
  findTransition,
  findState,
  validateFromState,
  validateTrigger,
} from "./core/state-machine";

// Core — guard evaluators
export {
  ActorTypeGuardEvaluator,
  ActorRoleGuardEvaluator,
  evaluateAllGuards,
} from "./core/guard-evaluator";

// Core — action dispatcher
export { ActionDispatcher } from "./core/action-dispatcher";

// Core — engine
export { WorkflowEngine } from "./core/engine";

// Adapters
export { PgTransactionManager } from "./adapters/pg-transaction-manager";
