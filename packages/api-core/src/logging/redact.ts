/**
 * Sensitive-field key patterns — if an object key matches, the entire value
 * is replaced with "[REDACTED]" regardless of its content.
 */
const REDACT_KEY_PATTERN =
  /(password|passwd|token|jwt|secret|signature|authorization|cookie|session_id|aadhaar|pan|credit_?card|card_?number|bank_?account|account_?number|cvv|cvc|ssn)/i;

/**
 * Value-level patterns — applied to every string value that was NOT already
 * caught by key-based redaction.  Each entry replaces matched substrings
 * with "[REDACTED]" so surrounding context is preserved.
 */
const VALUE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Aadhaar: 12 digits, optionally separated by spaces or hyphens (e.g. 1234 5678 9012)
  { pattern: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: "[AADHAAR_REDACTED]" },
  // PAN: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)
  { pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g, replacement: "[PAN_REDACTED]" },
  // Credit / debit card numbers: 13-19 digits optionally separated by spaces or hyphens
  { pattern: /\b(?:\d[\s-]?){13,19}\b/g, replacement: "[CARD_REDACTED]" },
  // Bearer / token strings in header values (e.g. "Bearer eyJ...")
  { pattern: /\bBearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi, replacement: "Bearer [REDACTED]" },
];

const MAX_REDACTION_DEPTH = 6;

/** Scrub sensitive patterns from a string value. */
function redactString(str: string): string {
  let result = str;
  for (const { pattern, replacement } of VALUE_PATTERNS) {
    // Reset lastIndex for global regexps reused across calls
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACTION_DEPTH) return "[MAX_DEPTH]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((e) => redactValue(e, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACT_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(entry, depth + 1);
    }
    return output;
  }
  return value;
}
