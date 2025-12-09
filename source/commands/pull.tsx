import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { parseProjectIdentifier, sanitizeForFilesystem } from "../lib/filesystem.js";
import { getTrackedProjects, type TrackedProject } from "../lib/projects.js";
import { ghProjectView, ghProjectItemList, type ProjectItem } from "../lib/github.js";
import { serializeItemToMarkdown, parseMarkdownFile } from "../lib/markdown.js";
import { writeFile, readdir } from "fs/promises";
import { join } from "path";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
});

export const args = z.tuple([
  z.string().optional().describe("owner/project-number (e.g., myorg/42). If omitted, pulls all tracked projects."),
]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

type PullResult = {
  project: TrackedProject;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  error?: string;
};

type PullState =
  | { status: "loading"; message: string }
  | { status: "success"; results: PullResult[] }
  | { status: "error"; message: string };

export default function Pull({ options, args }: Props) {
  const [state, setState] = React.useState<PullState>({ status: "loading", message: "Starting pull..." });

  React.useEffect(() => {
    async function pull() {
      const baseDir = getBaseDir(options.baseDir);
      const identifier = args[0];

      // Get projects to pull
      let projectsToPull: TrackedProject[];

      if (identifier) {
        // Pull specific project
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

        projectsToPull = [project];
      } else {
        // Pull all tracked projects
        projectsToPull = await getTrackedProjects(baseDir);
        if (projectsToPull.length === 0) {
          setState({
            status: "error",
            message: "No tracked projects found. Run `gpfs attach <owner/number>` to start tracking a project.",
          });
          return;
        }
      }

      const results: PullResult[] = [];

      for (const project of projectsToPull) {
        setState({ status: "loading", message: `Pulling ${project.owner}/${project.number}...` });

        try {
          const result = await pullProject(project);
          results.push(result);
        } catch (err) {
          results.push({
            project,
            created: 0,
            updated: 0,
            unchanged: 0,
            deleted: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      setState({ status: "success", results });
    }

    pull();
  }, [args, options.baseDir]);

  if (state.status === "loading") {
    return <Text>{state.message}</Text>;
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  return (
    <Box flexDirection="column">
      {state.results.map((result, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          <Text bold>{result.project.owner}/{result.project.number}</Text>
          {result.error ? (
            <Text color="red">  Error: {result.error}</Text>
          ) : (
            <Box flexDirection="column">
              <Text color="green">  {result.created} created</Text>
              <Text color="yellow">  {result.updated} updated</Text>
              <Text>  {result.unchanged} unchanged</Text>
              {result.deleted > 0 && <Text color="red">  {result.deleted} marked deleted</Text>}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

async function pullProject(project: TrackedProject): Promise<PullResult> {
  // Fetch project info to get the project ID
  const projectInfo = await ghProjectView(project.owner, project.number);
  if (!projectInfo.success) {
    throw new Error(projectInfo.message);
  }

  // Fetch all items from GitHub
  const itemsResult = await ghProjectItemList(project.owner, project.number);
  if (!itemsResult.success) {
    throw new Error(itemsResult.message);
  }

  const remoteItems = itemsResult.items;
  const remoteItemIds = new Set(remoteItems.map((item) => item.id));

  // Read existing local files
  let existingFiles: string[];
  try {
    existingFiles = (await readdir(project.path)).filter((f) => f.endsWith(".md"));
  } catch {
    existingFiles = [];
  }

  // Build map of existing item IDs to filenames
  const localItemMap = new Map<string, { filename: string; checksum: string }>();
  for (const filename of existingFiles) {
    const filePath = join(project.path, filename);
    const parsed = await parseMarkdownFile(filePath);
    if (parsed && parsed.frontmatter.id) {
      localItemMap.set(parsed.frontmatter.id, {
        filename,
        checksum: parsed.frontmatter._sync?.local_checksum || "",
      });
    }
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let deleted = 0;

  // Track used filenames to handle collisions
  const usedFilenames = new Set(existingFiles);

  // Process remote items
  for (const item of remoteItems) {
    const existingLocal = localItemMap.get(item.id);

    const markdown = serializeItemToMarkdown(item, {
      projectId: projectInfo.project.id,
      projectOwner: project.owner,
      projectNumber: project.number,
    });

    if (existingLocal) {
      // Item exists locally - check if update needed
      const filePath = join(project.path, existingLocal.filename);
      const currentParsed = await parseMarkdownFile(filePath);

      // Compare content (excluding _sync metadata)
      const currentBody = currentParsed?.body || "";
      const currentFrontmatter = { ...currentParsed?.frontmatter };
      delete currentFrontmatter._sync;

      const newFrontmatter = { ...item };

      // Simple comparison: if title or body changed, update
      if (currentFrontmatter.title !== item.title || currentBody !== item.body) {
        await writeFile(filePath, markdown);
        updated++;
      } else {
        unchanged++;
      }
    } else {
      // New item - create file
      const baseFilename = sanitizeForFilesystem(item.title || "untitled");
      const filename = getUniqueFilename(baseFilename, usedFilenames);
      usedFilenames.add(filename);

      const filePath = join(project.path, filename);
      await writeFile(filePath, markdown);
      created++;
    }
  }

  // Mark deleted items (items that exist locally but not remotely)
  for (const [itemId, { filename }] of localItemMap) {
    if (!remoteItemIds.has(itemId)) {
      const filePath = join(project.path, filename);
      const parsed = await parseMarkdownFile(filePath);
      if (parsed && !parsed.frontmatter.deleted) {
        // Mark as deleted in frontmatter
        const updatedFrontmatter = { ...parsed.frontmatter, deleted: true };
        const yaml = Object.entries(updatedFrontmatter)
          .map(([k, v]) => `${k}: ${formatYamlValue(v)}`)
          .join("\n");
        const markdown = `---\n${yaml}\n---\n\n${parsed.body}`;
        await writeFile(filePath, markdown);
        deleted++;
      }
    }
  }

  return { project, created, updated, unchanged, deleted };
}

function getUniqueFilename(base: string, existing: Set<string>): string {
  let filename = `${base}.md`;
  if (!existing.has(filename)) {
    return filename;
  }

  let counter = 2;
  while (existing.has(`${base}-${counter}.md`)) {
    counter++;
  }
  return `${base}-${counter}.md`;
}

function formatYamlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    // Quote strings that might be misinterpreted
    if (value.includes(":") || value.includes("#") || value.includes("\n") || value === "") {
      return JSON.stringify(value);
    }
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "\n" + value.map((v) => `  - ${formatYamlValue(v)}`).join("\n");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
