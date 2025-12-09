import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { parseProjectIdentifier } from "../lib/filesystem.js";
import { getTrackedProjects } from "../lib/projects.js";
import { rename } from "fs/promises";
import { join, dirname, basename } from "path";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
});

export const args = z.tuple([
  z.string().describe("owner/project-number (e.g., myorg/42)"),
]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

type DetachState =
  | { status: "loading" }
  | { status: "success"; owner: string; number: number; oldPath: string; newPath: string }
  | { status: "error"; message: string };

export default function Detach({ options, args }: Props) {
  const [state, setState] = React.useState<DetachState>({ status: "loading" });

  React.useEffect(() => {
    async function detach() {
      const identifier = args[0];

      // Parse owner/number format
      const parsed = parseProjectIdentifier(identifier);
      if (!parsed) {
        setState({
          status: "error",
          message: `Invalid project identifier: "${identifier}". Expected format: owner/number (e.g., myorg/42)`,
        });
        return;
      }

      // Find the tracked project
      const baseDir = getBaseDir(options.baseDir);
      const trackedProjects = await getTrackedProjects(baseDir);
      const project = trackedProjects.find(
        (p) => p.owner === parsed.owner && p.number === parsed.number
      );

      if (!project) {
        setState({
          status: "error",
          message: `Project not tracked: ${parsed.owner}/${parsed.number}`,
        });
        return;
      }

      // Rename directory to break the tracking pattern
      // Change from "42-project-name" to "detached-42-project-name"
      const parentDir = dirname(project.path);
      const currentDirName = basename(project.path);
      const newDirName = `detached-${currentDirName}`;
      const newPath = join(parentDir, newDirName);

      try {
        await rename(project.path, newPath);
      } catch (err) {
        setState({
          status: "error",
          message: `Failed to detach project: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      setState({
        status: "success",
        owner: parsed.owner,
        number: parsed.number,
        oldPath: project.path,
        newPath,
      });
    }

    detach();
  }, [args, options.baseDir]);

  if (state.status === "loading") {
    return <Text>Detaching project...</Text>;
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Successfully detached project!</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold>Project:</Text> {state.owner}/{state.number}
        </Text>
        <Text>
          <Text bold>Files moved to:</Text> {state.newPath}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Local files have been preserved. Run `gpfs attach {state.owner}/{state.number}` to reattach.</Text>
      </Box>
    </Box>
  );
}
