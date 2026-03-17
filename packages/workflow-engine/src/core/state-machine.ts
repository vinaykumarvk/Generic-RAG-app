import type { WfDefinition, WfState, WfTransition } from "../types";

export function findTransition(
  def: WfDefinition,
  transitionId: string
): WfTransition | undefined {
  return def.transitions.find((t) => t.transitionId === transitionId);
}

export function findState(
  def: WfDefinition,
  stateId: string
): WfState | undefined {
  return def.states.find((s) => s.stateId === stateId);
}

export function validateFromState(
  transition: WfTransition,
  currentStateId: string
): boolean {
  return transition.fromStateId === currentStateId;
}

export function validateTrigger(
  transition: WfTransition,
  actorType: string
): boolean {
  if (transition.trigger === "manual" && actorType === "SYSTEM") {
    return false;
  }
  return true;
}
