/**
 * Shared field-level validators for Indian government forms.
 * Each validator returns an error message string or null if valid.
 */

// ── Verhoeff checksum tables (used for Aadhaar validation) ──────────────

const verhoeffD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const verhoeffP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffCheck(num: string): boolean {
  let c = 0;
  const digits = num.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = verhoeffD[c][verhoeffP[i % 8][digits[i]]];
  }
  return c === 0;
}

// ── Individual validators ───────────────────────────────────────────────

export function validateEmail(value: string): string | null {
  if (!value) return null; // emptiness handled by required check
  const atIdx = value.indexOf("@");
  if (atIdx < 1) return "validation.email";
  const dotIdx = value.indexOf(".", atIdx);
  if (dotIdx < 0 || dotIdx === value.length - 1) return "validation.email";
  return null;
}

export function validateMobile(value: string): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) return "validation.mobile";
  if (!/^[6-9]/.test(digits)) return "validation.mobile";
  return null;
}

export function validateAadhaar(value: string): string | null {
  if (!value) return null;
  const digits = value.replace(/\s/g, "");
  if (!/^\d{12}$/.test(digits)) return "validation.aadhaar";
  if (!verhoeffCheck(digits)) return "validation.aadhaar";
  return null;
}

export function validatePan(value: string): string | null {
  if (!value) return null;
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.toUpperCase())) return "validation.pan";
  return null;
}

export function validatePincode(value: string): string | null {
  if (!value) return null;
  if (!/^[1-9]\d{5}$/.test(value)) return "validation.pincode";
  return null;
}

export function validateName(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length < 2) return "validation.name_min";
  if (/\d/.test(trimmed)) return "validation.name_min";
  return null;
}

// ── Unified entry point ─────────────────────────────────────────────────

export type ValidationType = "email" | "mobile" | "aadhaar" | "pan" | "pincode" | "name";

const validators: Record<ValidationType, (v: string) => string | null> = {
  email: validateEmail,
  mobile: validateMobile,
  aadhaar: validateAadhaar,
  pan: validatePan,
  pincode: validatePincode,
  name: validateName,
};

/**
 * Validate a field value by type.
 * Returns an i18n key for the error message, or null if valid.
 */
export function validateField(value: string | undefined | null, type: ValidationType): string | null {
  if (!value) return null;
  return validators[type](value);
}
