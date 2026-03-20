/**
 * Filename sanitization — strip special chars, limit length.
 * FR-001/BR-02: sanitize uploaded filenames.
 */

/**
 * Sanitize a filename:
 * - Strips path traversal characters
 * - Replaces special chars with underscores
 * - Truncates to 255 chars (preserving extension)
 */
export function sanitizeFilename(filename: string): string {
  // Remove path components
  let name = filename.replace(/^.*[\\/]/, "");

  // Replace special characters (keep alphanumeric, dots, hyphens, underscores)
  name = name.replace(/[^a-zA-Z0-9._-]/g, "_");

  // Collapse multiple underscores/dots
  name = name.replace(/_{2,}/g, "_").replace(/\.{2,}/g, ".");

  // Remove leading dots/underscores
  name = name.replace(/^[._]+/, "");

  // Ensure we have a name
  if (!name || name === "") {
    name = "unnamed_file";
  }

  // Truncate to 255 chars preserving extension
  if (name.length > 255) {
    const lastDot = name.lastIndexOf(".");
    if (lastDot > 0) {
      const ext = name.slice(lastDot);
      const base = name.slice(0, 255 - ext.length);
      name = base + ext;
    } else {
      name = name.slice(0, 255);
    }
  }

  return name;
}
