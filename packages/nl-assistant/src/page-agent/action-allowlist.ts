/**
 * Action classification for page agent mutation guard.
 *
 * SAFE (auto-execute): navigate, scroll, click filter/tab/link, fill fields, select, expand/collapse
 * MUTATION (require confirmation): submit, approve, reject, delete, confirm, pay, logout
 */

const MUTATION_KEYWORDS = [
  "submit", "approve", "reject", "delete", "remove", "confirm",
  "pay", "logout", "sign out", "sign-out", "cancel application",
  "revoke", "reset", "destroy", "disable", "archive", "finalize",
];

const MUTATION_SELECTORS = [
  'button[type="submit"]',
  ".btn--danger",
  ".btn-danger",
  '[data-action="submit"]',
  '[data-action="approve"]',
  '[data-action="reject"]',
  '[data-action="delete"]',
];

const SAFE_ACTION_TYPES = new Set([
  "navigate", "scroll", "click_link", "click_tab", "click_filter",
  "fill_input", "fill_search", "select_option", "expand", "collapse",
  "focus", "blur", "read", "highlight",
]);

export type ActionClassification = "SAFE" | "MUTATION";

export function classifyAction(
  actionType: string,
  instruction: string,
  targetSelector?: string,
  targetText?: string,
): ActionClassification {
  // Explicitly safe action types
  if (SAFE_ACTION_TYPES.has(actionType.toLowerCase())) return "SAFE";

  // Check instruction text for mutation keywords
  const instructionLower = instruction.toLowerCase();
  for (const keyword of MUTATION_KEYWORDS) {
    if (instructionLower.includes(keyword)) return "MUTATION";
  }

  // Check target element text for mutation keywords
  if (targetText) {
    const textLower = targetText.toLowerCase();
    for (const keyword of MUTATION_KEYWORDS) {
      if (textLower.includes(keyword)) return "MUTATION";
    }
  }

  // Check target selector for known mutation patterns
  if (targetSelector) {
    const selectorLower = targetSelector.toLowerCase();
    for (const sel of MUTATION_SELECTORS) {
      if (selectorLower.includes(sel.toLowerCase())) return "MUTATION";
    }
  }

  // Default: if action type includes "click" and we couldn't classify, be cautious
  if (actionType.toLowerCase().includes("click") || actionType.toLowerCase().includes("submit")) {
    // Check if it's a form submit context
    if (targetSelector?.includes("form") || actionType === "form_submit") return "MUTATION";
  }

  return "SAFE";
}
