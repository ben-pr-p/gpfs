/**
 * Markdown serialization and parsing utilities.
 */

import { readFile } from "fs/promises";
import type { ProjectItem } from "./github.js";
import { createHash } from "crypto";

export type ProjectContext = {
  projectId: string;
  projectOwner: string;
  projectNumber: number;
};

export type ParsedMarkdown = {
  frontmatter: Record<string, unknown>;
  body: string;
};

/**
 * Serialize a project item to markdown with YAML frontmatter.
 */
export function serializeItemToMarkdown(
  item: ProjectItem,
  context: ProjectContext
): string {
  const frontmatter: Record<string, unknown> = {
    id: item.id,
    project_id: context.projectId,
    project_owner: context.projectOwner,
    project_number: context.projectNumber,
    title: item.title,
    status: item.status,
    content_type: item.contentType,
    content_id: item.contentId,
    deleted: false,
    _sync: {
      remote_updated_at: new Date().toISOString(),
      local_checksum: computeChecksum(item.body),
    },
  };

  const yaml = serializeYaml(frontmatter);
  return `---\n${yaml}---\n\n${item.body}`;
}

/**
 * Parse a markdown file with YAML frontmatter.
 */
export async function parseMarkdownFile(
  filePath: string
): Promise<ParsedMarkdown | null> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  return parseMarkdownString(content);
}

/**
 * Parse a markdown string with YAML frontmatter.
 */
export function parseMarkdownString(content: string): ParsedMarkdown | null {
  // Check for frontmatter
  if (!content.startsWith("---\n")) {
    return { frontmatter: {}, body: content };
  }

  // Find end of frontmatter
  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = content.slice(4, endIndex);
  const body = content.slice(endIndex + 5).trim();

  const frontmatter = parseYaml(yamlContent);

  return { frontmatter, body };
}

/**
 * Compute a checksum for content.
 */
export function computeChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/**
 * Simple YAML serializer for frontmatter.
 * Handles strings, numbers, booleans, nulls, arrays, and objects.
 */
function serializeYaml(obj: Record<string, unknown>, indent = 0): string {
  const prefix = "  ".repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${prefix}${key}: null`);
    } else if (typeof value === "string") {
      // Handle multiline or special strings
      if (value.includes("\n") || value.includes(":") || value.includes("#") || value === "") {
        lines.push(`${prefix}${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`${prefix}${key}: ${value}`);
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      lines.push(`${prefix}${key}: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${prefix}${key}: []`);
      } else {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          if (typeof item === "object" && item !== null) {
            lines.push(`${prefix}  - ${serializeYaml(item as Record<string, unknown>, indent + 2).trim()}`);
          } else {
            lines.push(`${prefix}  - ${item}`);
          }
        }
      }
    } else if (typeof value === "object") {
      lines.push(`${prefix}${key}:`);
      lines.push(serializeYaml(value as Record<string, unknown>, indent + 1));
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Simple YAML parser for frontmatter.
 * Handles basic YAML structure used in frontmatter.
 */
function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Get indentation level
    const indent = line.match(/^(\s*)/)?.[1].length || 0;

    // Parse key-value
    const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!match) {
      i++;
      continue;
    }

    const key = match[2].trim();
    let value: unknown = match[3].trim();

    // Handle different value types
    if (value === "" || value === undefined) {
      // Could be an object or array, check next line
      const nextLine = lines[i + 1];
      if (nextLine && nextLine.match(/^\s+-\s/)) {
        // It's an array
        const arr: unknown[] = [];
        i++;
        while (i < lines.length) {
          const itemLine = lines[i];
          const itemMatch = itemLine.match(/^\s+-\s*(.*)$/);
          if (!itemMatch) break;
          arr.push(parseYamlValue(itemMatch[1]));
          i++;
        }
        result[key] = arr;
        continue;
      } else if (nextLine && nextLine.match(/^\s+\w+:/)) {
        // It's a nested object
        const nestedLines: string[] = [];
        i++;
        const baseIndent = lines[i]?.match(/^(\s*)/)?.[1].length || 0;
        while (i < lines.length) {
          const nestedLine = lines[i];
          const nestedIndent = nestedLine.match(/^(\s*)/)?.[1].length || 0;
          if (nestedLine.trim() === "" || nestedIndent >= baseIndent) {
            nestedLines.push(nestedLine.slice(baseIndent));
            i++;
          } else {
            break;
          }
        }
        result[key] = parseYaml(nestedLines.join("\n"));
        continue;
      }
    }

    result[key] = parseYamlValue(value as string);
    i++;
  }

  return result;
}

function parseYamlValue(value: string): unknown {
  if (value === "null" || value === "~" || value === "") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "[]") {
    return [];
  }
  // Check for number
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }
  // Check for quoted string
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}
