import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { parseProjectIdentifier } from "../lib/filesystem.js";
import { getTrackedProjects, type TrackedProject } from "../lib/projects.js";
import { ghProjectView, ghProjectItemList, ghUpdateDraftIssue, ghDeleteItem, type ProjectItem } from "../lib/github.js";
import { parseMarkdownFile, computeChecksum, type ParsedMarkdown } from "../lib/markdown.js";
import { readdir, unlink } from "fs/promises";
import { join } from "path";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Show what would be pushed without making changes"),
});

export const args = z.tuple([
  z.string().optional().describe("owner/project-number (e.g., myorg/42). If omitted, pushes all tracked projects."),
]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

type PushResult = {
  project: TrackedProject;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  error?: string;
};

type PushState =
  | { status: "loading"; message: string }
  | { status: "success"; results: PushResult[] }
  | { status: "error"; message: string };

export default function Push({ options, args }: Props) {
  const [state, setState] = React.useState<PushState>({ status: "loading", message: "Starting push..." });

  React.useEffect(() => {
    async function push() {
      const baseDir = getBaseDir(options.baseDir);
      const identifier = args[0];

      // Get projects to push
      let projectsToPush: TrackedProject[];

      if (identifier) {
        // Push specific project
        const parsed = parseProjectIdentifier(identifier);
        if (!parsed) {
          setState({
            status: "error",
            message: `Invalid project identifier: "${identifier}". Expected format: owner/number (e.g., myorg/42)`,
          });
          return;
        }

        const trackedProjects = await getTrackedProjects(baseDir);
        const project = trackedProjects.find(
          (p) => p.owner === parsed.owner && p.number === parsed.number
        );

        if (!project) {
          setState({
            status: "error",
            message: `Project not tracked: ${parsed.owner}/${parsed.number}. Run \`gpfs attach ${parsed.owner}/${parsed.number}\` first.`,
          });
          return;
        }

        projectsToPush = [project];
      } else {
        // Push all tracked projects
        projectsToPush = await getTrackedProjects(baseDir);
        if (projectsToPush.length === 0) {
          setState({
            status: "error",
            message: "No tracked projects found. Run `gpfs attach <owner/number>` to start tracking a project.",
          });
          return;
        }
      }

      const results: PushResult[] = [];

      for (const project of projectsToPush) {
        setState({ status: "loading", message: `Pushing ${project.owner}/${project.number}...` });

        try {
          const result = await pushProject(project, options.dryRun);
          results.push(result);
        } catch (err) {
          results.push({
            project,
            created: 0,
            updated: 0,
            deleted: 0,
            unchanged: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      setState({ status: "success", results });
    }

    push();
  }, [args, options.baseDir, options.dryRun]);

  if (state.status === "loading") {
    return <Text>{state.message}</Text>;
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  const dryRunLabel = options.dryRun ? " (dry run)" : "";

  return (
    <Box flexDirection="column">
      {state.results.map((result, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Text bold>{result.project.owner}/{result.project.number}{dryRunLabel}</Text>
          {result.error ? (
            <Text color="red">  Error: {result.error}</Text>
          ) : (
            <Box flexDirection="column">
              <Text color="green">  {result.created} created</Text>
              <Text color="yellow">  {result.updated} updated</Text>
              {result.deleted > 0 && <Text color="red">  {result.deleted} deleted</Text>}
              <Text>  {result.unchanged} unchanged</Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

type LocalItem = {
  filename: string;
  parsed: ParsedMarkdown;
  currentChecksum: string;
};

async function pushProject(project: TrackedProject, dryRun: boolean): Promise<PushResult> {
  // Fetch project info to get the project ID
  const projectInfo = await ghProjectView(project.owner, project.number);
  if (!projectInfo.success) {
    throw new Error(projectInfo.message);
  }

  // Fetch current remote items
  const remoteResult = await ghProjectItemList(project.owner, project.number);
  if (!remoteResult.success) {
    throw new Error(remoteResult.message);
  }

  // Build map of remote items by ID
  const remoteItemsById = new Map<string, ProjectItem>();
  for (const item of remoteResult.items) {
    remoteItemsById.set(item.id, item);
  }

  // Read all local markdown files
  let files: string[];
  try {
    files = (await readdir(project.path)).filter((f) => f.endsWith(".md"));
  } catch {
    files = [];
  }

  const localItems: LocalItem[] = [];
  for (const filename of files) {
    const filePath = join(project.path, filename);
    const parsed = await parseMarkdownFile(filePath);
    if (parsed && parsed.frontmatter.id) {
      const currentChecksum = computeChecksum(parsed.body);
      localItems.push({ filename, parsed, currentChecksum });
    }
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let unchanged = 0;

  for (const local of localItems) {
    const itemId = local.parsed.frontmatter.id as string;
    const isDeleted = local.parsed.frontmatter.deleted === true;
    const remote = remoteItemsById.get(itemId);
    const storedChecksum = (local.parsed.frontmatter._sync as Record<string, unknown>)?.local_checksum as string | undefined;

    if (isDeleted) {
      // Item marked for deletion locally
      if (remote) {
        // Delete from GitHub
        if (!dryRun) {
          await ghDeleteItem(project.owner, project.number, itemId);
          // Remove the local file after successful delete
          await unlink(join(project.path, local.filename));
        }
        deleted++;
      } else {
        // Already deleted remotely, just remove local file
        if (!dryRun) {
          await unlink(join(project.path, local.filename));
        }
        deleted++;
      }
    } else if (!remote) {
      // Item doesn't exist remotely - create it
      // But only if it doesn't have an ID that starts with PVTI_ (which means it was deleted remotely)
      // For now, we'll skip items that have a PVTI_ ID but don't exist remotely
      // They may have been deleted on GitHub
      if (itemId.startsWith("PVTI_")) {
        // This item was synced before but is now missing remotely
        // Skip it - user should run pull to get the deleted status
        unchanged++;
      } else {
        // This is a locally-created item (no PVTI_ ID yet)
        // We don't support creating new items from local files yet
        // Items must be created via gpfs create command
        unchanged++;
      }
    } else {
      // Item exists both locally and remotely
      // Check if local body changed since last sync
      const localBody = local.parsed.body;
      const localTitle = local.parsed.frontmatter.title as string;

      if (storedChecksum && local.currentChecksum !== storedChecksum) {
        // Local body changed - push to remote
        const contentId = remote.contentId;
        if (contentId && remote.contentType === "DraftIssue") {
          if (!dryRun) {
            await ghUpdateDraftIssue(contentId, localTitle, localBody);
            // Update local file with new checksum
            await updateLocalChecksum(join(project.path, local.filename), local.parsed, local.currentChecksum);
          }
          updated++;
        } else {
          // Can't update non-draft issues via this method
          // Would need to use gh issue edit
          unchanged++;
        }
      } else {
        unchanged++;
      }
    }
  }

  return { project, created, updated, deleted, unchanged };
}

/**
 * Update the local checksum in a file's frontmatter.
 */
async function updateLocalChecksum(
  filePath: string,
  parsed: ParsedMarkdown,
  newChecksum: string
): Promise<void> {
  const { writeFile } = await import("fs/promises");

  // Update the _sync.local_checksum in frontmatter
  const sync = (parsed.frontmatter._sync as Record<string, unknown>) || {};
  sync.local_checksum = newChecksum;
  sync.remote_updated_at = new Date().toISOString();
  parsed.frontmatter._sync = sync;

  // Re-serialize the file
  const yaml = serializeFrontmatter(parsed.frontmatter);
  const content = `---\n${yaml}---\n\n${parsed.body}`;
  await writeFile(filePath, content);
}

/**
 * Serialize frontmatter object to YAML string.
 */
function serializeFrontmatter(obj: Record<string, unknown>, indent = 0): string {
  const prefix = "  ".repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${prefix}${key}: null`);
    } else if (typeof value === "string") {
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
          lines.push(`${prefix}  - ${item}`);
        }
      }
    } else if (typeof value === "object") {
      lines.push(`${prefix}${key}:`);
      lines.push(serializeFrontmatter(value as Record<string, unknown>, indent + 1));
    }
  }

  return lines.join("\n") + "\n";
}
