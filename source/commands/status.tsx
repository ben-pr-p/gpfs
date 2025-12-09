import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { parseProjectIdentifier } from "../lib/filesystem.js";
import { getTrackedProjects, type TrackedProject } from "../lib/projects.js";
import { ghProjectItemList, type ProjectItem } from "../lib/github.js";
import { parseMarkdownFile, computeChecksum } from "../lib/markdown.js";
import { readdir } from "fs/promises";
import { join } from "path";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
});

export const args = z.tuple([
  z.string().optional().describe("owner/project-number (e.g., myorg/42). If omitted, shows status for all tracked projects."),
]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

type LocalFileInfo = {
  filename: string;
  itemId: string;
  title: string;
  body: string;
  storedChecksum: string | null;
  currentChecksum: string;
  deleted: boolean;
  contentType: string;
  contentId: string | null;
};

type StatusInfo = {
  localModified: LocalFileInfo[];      // Files changed locally (pending push)
  remoteModified: ProjectItem[];       // Items changed remotely (pending pull)
  localNew: LocalFileInfo[];           // Local files without PVTI_ ID
  remoteNew: ProjectItem[];            // Remote items not in local files
  localDeleted: LocalFileInfo[];       // Files marked deleted: true
  remoteDeleted: LocalFileInfo[];      // Items deleted remotely but still local
};

type ProjectStatus = {
  project: TrackedProject;
  status: StatusInfo;
  error?: string;
};

type StatusState =
  | { status: "loading"; message: string }
  | { status: "success"; results: ProjectStatus[] }
  | { status: "error"; message: string };

export default function Status({ options, args }: Props) {
  const [state, setState] = React.useState<StatusState>({ status: "loading", message: "Checking status..." });

  React.useEffect(() => {
    async function checkStatus() {
      const baseDir = getBaseDir(options.baseDir);
      const identifier = args[0];

      // Get projects to check
      let projectsToCheck: TrackedProject[];

      if (identifier) {
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

        projectsToCheck = [project];
      } else {
        projectsToCheck = await getTrackedProjects(baseDir);
        if (projectsToCheck.length === 0) {
          setState({
            status: "error",
            message: "No tracked projects found. Run `gpfs attach <owner/number>` to start tracking a project.",
          });
          return;
        }
      }

      const results: ProjectStatus[] = [];

      for (const project of projectsToCheck) {
        setState({ status: "loading", message: `Checking ${project.owner}/${project.number}...` });

        try {
          const status = await getProjectStatus(project);
          results.push({ project, status });
        } catch (err) {
          results.push({
            project,
            status: {
              localModified: [],
              remoteModified: [],
              localNew: [],
              remoteNew: [],
              localDeleted: [],
              remoteDeleted: [],
            },
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      setState({ status: "success", results });
    }

    checkStatus();
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
        <ProjectStatusDisplay key={i} result={result} />
      ))}
    </Box>
  );
}

function ProjectStatusDisplay({ result }: { result: ProjectStatus }) {
  const { project, status, error } = result;

  if (error) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{project.owner}/{project.number}</Text>
        <Text color="red">  Error: {error}</Text>
      </Box>
    );
  }

  const hasChanges =
    status.localModified.length > 0 ||
    status.remoteModified.length > 0 ||
    status.localNew.length > 0 ||
    status.remoteNew.length > 0 ||
    status.localDeleted.length > 0 ||
    status.remoteDeleted.length > 0;

  if (!hasChanges) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{project.owner}/{project.number}</Text>
        <Text color="green">  Up to date</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{project.owner}/{project.number}</Text>

      {status.localModified.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color="yellow">Modified locally (pending push):</Text>
          {status.localModified.map((item, i) => (
            <Text key={i} color="yellow">  M {item.filename}</Text>
          ))}
        </Box>
      )}

      {status.localDeleted.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color="red">Marked for deletion (pending push):</Text>
          {status.localDeleted.map((item, i) => (
            <Text key={i} color="red">  D {item.filename}</Text>
          ))}
        </Box>
      )}

      {status.remoteModified.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color="cyan">Modified remotely (pending pull):</Text>
          {status.remoteModified.map((item, i) => (
            <Text key={i} color="cyan">  M {item.title}</Text>
          ))}
        </Box>
      )}

      {status.remoteNew.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color="green">New on GitHub (pending pull):</Text>
          {status.remoteNew.map((item, i) => (
            <Text key={i} color="green">  + {item.title}</Text>
          ))}
        </Box>
      )}

      {status.remoteDeleted.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color="red">Deleted on GitHub (pending pull):</Text>
          {status.remoteDeleted.map((item, i) => (
            <Text key={i} color="red">  - {item.filename}</Text>
          ))}
        </Box>
      )}

      {status.localNew.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text color="magenta">Local only (not synced):</Text>
          {status.localNew.map((item, i) => (
            <Text key={i} color="magenta">  ? {item.filename}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

async function getProjectStatus(project: TrackedProject): Promise<StatusInfo> {
  // Fetch remote items
  const remoteResult = await ghProjectItemList(project.owner, project.number);
  if (!remoteResult.success) {
    throw new Error(remoteResult.message);
  }

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

  const localFiles: LocalFileInfo[] = [];
  for (const filename of files) {
    const filePath = join(project.path, filename);
    const parsed = await parseMarkdownFile(filePath);
    if (parsed) {
      const itemId = parsed.frontmatter.id as string | undefined;
      const sync = parsed.frontmatter._sync as Record<string, unknown> | undefined;
      localFiles.push({
        filename,
        itemId: itemId || "",
        title: (parsed.frontmatter.title as string) || "",
        body: parsed.body,
        storedChecksum: (sync?.local_checksum as string) || null,
        currentChecksum: computeChecksum(parsed.body),
        deleted: parsed.frontmatter.deleted === true,
        contentType: (parsed.frontmatter.content_type as string) || "",
        contentId: (parsed.frontmatter.content_id as string) || null,
      });
    }
  }

  const localModified: LocalFileInfo[] = [];
  const remoteModified: ProjectItem[] = [];
  const localNew: LocalFileInfo[] = [];
  const remoteNew: ProjectItem[] = [];
  const localDeleted: LocalFileInfo[] = [];
  const remoteDeleted: LocalFileInfo[] = [];

  const localItemIds = new Set<string>();

  // Check local files
  for (const local of localFiles) {
    if (!local.itemId || !local.itemId.startsWith("PVTI_")) {
      // Local file without a valid item ID - not synced
      localNew.push(local);
      continue;
    }

    localItemIds.add(local.itemId);
    const remote = remoteItemsById.get(local.itemId);

    if (local.deleted) {
      // Marked for deletion locally
      if (remote) {
        localDeleted.push(local);
      }
      // If !remote, it's already deleted on both sides - nothing to do
      continue;
    }

    if (!remote) {
      // Exists locally but not remotely - deleted on GitHub
      remoteDeleted.push(local);
      continue;
    }

    // Both exist - check for changes
    const localChanged = local.storedChecksum && local.currentChecksum !== local.storedChecksum;
    const remoteChanged = remote.title !== local.title || remote.body !== local.body;

    if (localChanged) {
      localModified.push(local);
    }
    if (remoteChanged && !localChanged) {
      // Only show as remote modified if local hasn't also changed
      // If both changed, we show it as local modified (local takes precedence on push)
      remoteModified.push(remote);
    }
  }

  // Check for new remote items
  for (const [itemId, item] of remoteItemsById) {
    if (!localItemIds.has(itemId)) {
      remoteNew.push(item);
    }
  }

  return {
    localModified,
    remoteModified,
    localNew,
    remoteNew,
    localDeleted,
    remoteDeleted,
  };
}
