/**
 * Filesystem utilities for path and filename handling.
 */

export type ProjectIdentifier = {
  owner: string;
  number: number;
};

/**
 * Parse a project identifier string in "owner/number" format.
 * Returns null if the format is invalid.
 */
export function parseProjectIdentifier(
  identifier: string
): ProjectIdentifier | null {
  const match = identifier.match(/^([^/]+)\/(\d+)$/);
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  return {
    owner: match[1],
    number: parseInt(match[2], 10),
  };
}

/**
 * Sanitize a string for use as a filesystem name.
 * - Replaces unsafe characters with dashes
 * - Converts to lowercase
 * - Collapses multiple dashes
 * - Trims leading/trailing dashes
 * - Truncates to maxLength characters
 */
export function sanitizeForFilesystem(
  str: string,
  maxLength: number = 100
): string {
  return str
    .toLowerCase()
    .replace(/[/\\:*?"<>|]/g, "-") // Replace unsafe characters
    .replace(/\s+/g, "-") // Replace whitespace with dashes
    .replace(/-+/g, "-") // Collapse multiple dashes
    .replace(/^-|-$/g, "") // Trim leading/trailing dashes
    .slice(0, maxLength);
}
