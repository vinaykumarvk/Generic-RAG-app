import type {
  Actor,
  EntityState,
  GuardEvaluator,
  TransactionHandle,
  WfGuard,
} from "../types";

export class ActorTypeGuardEvaluator implements GuardEvaluator {
  readonly guardType = "ACTOR_TYPE";

  async evaluate(
    guard: WfGuard,
    actor: Actor,
    _entityState: EntityState,
    _txn: TransactionHandle
  ): Promise<{ passed: boolean; errorCode?: string }> {
    const allowedTypes = guard.params.allowedTypes as string[] | undefined;
    if (!allowedTypes || allowedTypes.length === 0) {
      return { passed: true };
    }
    if (allowedTypes.includes(actor.actorType)) {
      return { passed: true };
    }
    return { passed: false, errorCode: "UNAUTHORIZED_ACTOR_TYPE" };
  }
}

export class ActorRoleGuardEvaluator implements GuardEvaluator {
  readonly guardType = "ACTOR_ROLE";

  async evaluate(
    guard: WfGuard,
    actor: Actor,
    _entityState: EntityState,
    _txn: TransactionHandle
  ): Promise<{ passed: boolean; errorCode?: string }> {
    const allowedRoles = guard.params.allowedRoles as string[] | undefined;
    if (!allowedRoles || allowedRoles.length === 0) {
      return { passed: true };
    }

    // Optionally scope to a specific actor type
    const forActorType = guard.params.forActorType as string | undefined;
    if (forActorType && actor.actorType !== forActorType) {
      // Guard not applicable to this actor type — pass
      return { passed: true };
    }

    const hasRole = allowedRoles.some((role) => actor.roles.includes(role));
    if (hasRole) {
      return { passed: true };
    }
    return { passed: false, errorCode: "UNAUTHORIZED_ROLE" };
  }
}

export async function evaluateAllGuards(
  guards: WfGuard[],
  evaluators: GuardEvaluator[],
  actor: Actor,
  entityState: EntityState,
  txn: TransactionHandle
): Promise<{ passed: boolean; errorCode?: string; guardType?: string }> {
  const evaluatorMap = new Map(evaluators.map((e) => [e.guardType, e]));

  for (const guard of guards) {
    const evaluator = evaluatorMap.get(guard.type);
    if (!evaluator) {
      return {
        passed: false,
        errorCode: "UNKNOWN_GUARD_TYPE",
        guardType: guard.type,
      };
    }
    const result = await evaluator.evaluate(guard, actor, entityState, txn);
    if (!result.passed) {
      return {
        passed: false,
        errorCode: result.errorCode,
        guardType: guard.type,
      };
    }
  }

  return { passed: true };
}
