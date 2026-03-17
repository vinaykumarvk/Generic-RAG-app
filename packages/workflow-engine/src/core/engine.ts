import { TransitionError, GuardError } from "../errors";
import type {
  ActionContext,
  Actor,
  EngineLogger,
  EntityRef,
  PostCommitHook,
  TransactionHandle,
  TransitionRequest,
  TransitionResult,
  WfDefinition,
  WfState,
  WorkflowEngineOptions,
} from "../types";
import { findState, findTransition, validateFromState, validateTrigger } from "./state-machine";
import { evaluateAllGuards, ActorTypeGuardEvaluator, ActorRoleGuardEvaluator } from "./guard-evaluator";
import { ActionDispatcher } from "./action-dispatcher";

const noopLogger: EngineLogger = {
  info() {},
  warn() {},
  error() {},
};

export class WorkflowEngine {
  private opts: WorkflowEngineOptions;
  private actionDispatcher: ActionDispatcher;
  private logger: EngineLogger;

  constructor(opts: WorkflowEngineOptions) {
    this.opts = opts;
    this.logger = opts.logger ?? noopLogger;
    this.actionDispatcher = new ActionDispatcher(
      opts.actionHandlers ?? [],
      this.logger
    );
  }

  async executeTransition(
    request: TransitionRequest,
    existingTxn?: TransactionHandle
  ): Promise<TransitionResult> {
    const { entityRef, transitionId, actor, remarks, payload } = request;

    try {
      const result = await this.opts.transactionManager.runInTransaction(
        async (txn) => {
          // 1. Load entity with lock
          const entityState = await this.opts.storageAdapter.loadEntityForUpdate(
            entityRef,
            txn
          );
          if (!entityState) {
            return {
              success: false as const,
              error: "Entity not found",
              errorCode: "ENTITY_NOT_FOUND",
            };
          }

          this.logger.info("Entity loaded for transition", {
            entityId: entityRef.entityId,
            entityType: entityRef.entityType,
            currentStateId: entityState.currentStateId,
            transitionId,
          });

          // 2. Load workflow definition
          const definition = await this.opts.storageAdapter.loadWorkflowDefinition(
            entityState,
            txn
          );
          if (!definition) {
            return {
              success: false as const,
              error: "Workflow definition not found",
              errorCode: "DEFINITION_NOT_FOUND",
            };
          }

          // 3. Find transition
          const transition = findTransition(definition, transitionId);
          if (!transition) {
            return {
              success: false as const,
              error: `Transition not found: ${transitionId}`,
              errorCode: "TRANSITION_NOT_FOUND",
            };
          }

          // 4. Validate from-state
          if (!validateFromState(transition, entityState.currentStateId)) {
            return {
              success: false as const,
              error: `Invalid state: entity is in ${entityState.currentStateId}, transition requires ${transition.fromStateId}`,
              errorCode: "INVALID_STATE",
            };
          }

          // 5. Validate trigger
          if (!validateTrigger(transition, actor.actorType)) {
            return {
              success: false as const,
              error: "SYSTEM actors cannot trigger manual transitions",
              errorCode: "INVALID_TRIGGER",
            };
          }

          // 6. Evaluate guards
          if (transition.guards && transition.guards.length > 0) {
            const guardEvaluators = this.opts.guardEvaluators ?? [];
            const guardResult = await evaluateAllGuards(
              transition.guards,
              guardEvaluators,
              actor,
              entityState,
              txn
            );
            if (!guardResult.passed) {
              return {
                success: false as const,
                error: `Guard check failed: ${guardResult.errorCode}`,
                errorCode: guardResult.errorCode ?? "GUARD_FAILED",
              };
            }
          }

          // 7. Fire onBeforeTransition lifecycle hook
          const newStateId = transition.toStateId;
          const newRowVersion = entityState.rowVersion + 1;

          if (this.opts.onBeforeTransition) {
            await this.opts.onBeforeTransition({
              entityRef,
              transitionId,
              actor,
              remarks,
              payload,
              entityState,
              definition,
              fromStateId: entityState.currentStateId,
              toStateId: newStateId,
            });
          }

          // 8. Update entity state
          await this.opts.storageAdapter.updateEntityState(
            entityRef,
            newStateId,
            newRowVersion,
            txn
          );

          // 8. Dispatch transition actions
          const transitionActions = transition.actions ?? [];
          const targetState = findState(definition, newStateId);

          for (const actionKey of transitionActions) {
            const actionCtx: ActionContext = {
              entityRef,
              entityState,
              fromStateId: entityState.currentStateId,
              toStateId: newStateId,
              targetState: targetState ?? {
                stateId: newStateId,
                type: "UNKNOWN",
                taskRequired: false,
              },
              definition,
              actor,
              payload,
              remarks,
              txn,
            };
            await this.actionDispatcher.dispatch(actionKey, actionCtx);
          }

          // 9. Safety net: auto-create task if target state requires one
          //    and no ASSIGN_NEXT_TASK action was configured
          if (
            targetState?.taskRequired &&
            targetState.roleId &&
            !transitionActions.includes("ASSIGN_NEXT_TASK") &&
            this.opts.taskManager
          ) {
            const hasTask = await this.opts.taskManager.hasOpenTask(
              entityRef,
              newStateId,
              txn
            );
            if (!hasTask) {
              this.logger.warn(
                "Safety net: auto-creating task for state missing ASSIGN_NEXT_TASK action",
                { stateId: newStateId, entityId: entityRef.entityId }
              );

              let slaDueAt: Date | null = null;
              if (targetState.slaDays && this.opts.slaCalculator) {
                slaDueAt = await this.opts.slaCalculator.calculateDueDate(
                  new Date(),
                  targetState.slaDays,
                  entityState.metadata ?? {},
                  txn
                );
              } else if (targetState.slaDays) {
                slaDueAt = new Date(
                  Date.now() + targetState.slaDays * 24 * 60 * 60 * 1000
                );
              }

              await this.opts.taskManager.createTask(
                entityRef,
                newStateId,
                targetState.roleId,
                slaDueAt,
                targetState.metadata ?? {},
                txn
              );
            }
          }

          // 10. Complete current task if actor is not SYSTEM
          if (actor.actorType !== "SYSTEM" && this.opts.taskManager) {
            const decision =
              (payload?.decision as string) ?? "FORWARD";
            await this.opts.taskManager.completeCurrentTask(
              entityRef,
              actor,
              decision,
              remarks,
              txn
            );
          }

          // 11. Write audit event (after actions and task management)
          await this.opts.auditWriter.writeTransitionEvent(
            entityRef,
            entityState.currentStateId,
            newStateId,
            transitionId,
            actor,
            remarks,
            txn
          );

          return {
            success: true as const,
            newStateId,
            _postCommit: {
              fromStateId: entityState.currentStateId,
              toStateId: newStateId,
              transitionId,
              actor,
              entityRef,
              payload,
              newRowVersion,
            },
          };
        },
        existingTxn
      );

      // 12. Fire post-commit hooks (only when engine owns the transaction;
      //     when joining an existing transaction, the caller hasn't committed yet)
      const ownsTransaction = !existingTxn;
      if (ownsTransaction && result.success && this.opts.postCommitHooks) {
        await this.firePostCommitHooks(
          this.opts.postCommitHooks,
          result._postCommit
        );
      }

      // 13. Fire onAfterTransition lifecycle hook
      if (result.success && this.opts.onAfterTransition) {
        const pcd = result._postCommit;
        try {
          await this.opts.onAfterTransition({
            entityRef: pcd.entityRef,
            transitionId: pcd.transitionId,
            actor: pcd.actor,
            remarks,
            payload,
            fromStateId: pcd.fromStateId,
            toStateId: pcd.toStateId,
            newRowVersion: pcd.newRowVersion,
          });
        } catch (hookErr: any) {
          this.logger.error("onAfterTransition hook failed", {
            entityId: entityRef.entityId,
            error: hookErr?.message ?? "unknown_error",
          });
        }
      }

      return {
        success: result.success,
        newStateId: result.newStateId,
        error: result.success ? undefined : result.error,
        errorCode: result.success ? undefined : result.errorCode,
      };
    } catch (err: any) {
      this.logger.error("Workflow transition failed", {
        entityId: entityRef.entityId,
        entityType: entityRef.entityType,
        transitionId,
        error: err?.message ?? "unknown_error",
      });

      // Fire onTransitionError lifecycle hook
      if (this.opts.onTransitionError) {
        try {
          await this.opts.onTransitionError({
            entityRef,
            transitionId,
            actor,
            remarks,
            payload,
            error: err,
            errorCode: err instanceof TransitionError || err instanceof GuardError
              ? err.errorCode
              : undefined,
          });
        } catch (hookErr: any) {
          this.logger.error("onTransitionError hook failed", {
            entityId: entityRef.entityId,
            error: hookErr?.message ?? "unknown_error",
          });
        }
      }

      if (err instanceof TransitionError || err instanceof GuardError) {
        return {
          success: false,
          error: err.message,
          errorCode: err.errorCode,
        };
      }

      return {
        success: false,
        error: err.message ?? "unknown_error",
      };
    }
  }

  private async firePostCommitHooks(
    hooks: PostCommitHook[],
    data: {
      fromStateId: string;
      toStateId: string;
      transitionId: string;
      actor: Actor;
      entityRef: EntityRef;
      payload?: Record<string, unknown>;
    }
  ): Promise<void> {
    for (const hook of hooks) {
      try {
        await hook.execute(
          data.entityRef,
          data.fromStateId,
          data.toStateId,
          data.transitionId,
          data.actor,
          data.payload
        );
      } catch (err: any) {
        this.logger.error(`Post-commit hook ${hook.hookId} failed`, {
          hookId: hook.hookId,
          entityId: data.entityRef.entityId,
          error: err?.message ?? "unknown_error",
        });
        // Post-commit hook failures are logged, not thrown
      }
    }
  }
}
