/**
 * PII Masking Engine (FR-002)
 * Regex + entity-based masking for sensitive data in answers and exports.
 */

/** Mask patterns for different PII types */
const MASK_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Indian phone numbers (10-digit, optional +91/0 prefix)
  { pattern: /(?:\+91[\s-]?|0)?[6-9]\d{9}/g, replacement: "[MASKED_PHONE]" },
  // Aadhaar numbers (12 digits, grouped as 4-4-4)
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: "[MASKED_AADHAAR]" },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: "[MASKED_EMAIL]" },
  // Badge/ID numbers (alphanumeric patterns like BP-1234, ID/1234)
  { pattern: /\b[A-Z]{2,4}[\/-]\d{3,8}\b/g, replacement: "[MASKED_ID]" },
  // PAN numbers (Indian: 5 letters, 4 digits, 1 letter)
  { pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g, replacement: "[MASKED_PAN]" },
];

/**
 * Apply PII masking to text content.
 */
export function maskPii(text: string): string {
  let masked = text;
  for (const { pattern, replacement } of MASK_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

/**
 * Mask specific entity names found in text.
 */
export function maskEntities(
  text: string,
  entities: Array<{ name: string; type: string }>,
): string {
  let masked = text;
  for (const entity of entities) {
    if (entity.type === "PERSON" || entity.type === "WITNESS" || entity.type === "SUSPECT") {
      const escaped = entity.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      masked = masked.replace(new RegExp(escaped, "gi"), "[MASKED_NAME]");
    }
  }
  return masked;
}

/**
 * Apply full masking pipeline: PII patterns + entity names.
 */
export function applyMasking(
  text: string,
  entities?: Array<{ name: string; type: string }>,
): string {
  let result = maskPii(text);
  if (entities?.length) {
    result = maskEntities(result, entities);
  }
  return result;
}
