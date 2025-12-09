import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { parseProjectIdentifier, sanitizeForFilesystem } from "../lib/filesystem.js";
import { ghProjectView, type ProjectInfo } from "../lib/github.js";
import { mkdir } from "fs/promises";
import { join } from "path";

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

type AttachState =
  | { status: "loading" }
  | { status: "success"; project: ProjectInfo; path: string }
  | { status: "error"; message: string };

export default function Attach({ options, args }: Props) {
  const [state, setState] = React.useState<AttachState>({ status: "loading" });

  React.useEffect(() => {
    async function attach() {
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

      // Fetch project info from GitHub
      const result = await ghProjectView(parsed.owner, parsed.number);
      if (!result.success) {
        setState({
          status: "error",
          message: result.message,
        });
        return;
      }

      const projectInfo = result.project;

      // Build directory path
      const baseDir = getBaseDir(options.baseDir);
      const sanitizedName = sanitizeForFilesystem(projectInfo.title);
      const projectDir = join(
        baseDir,
        projectInfo.owner,
        `${projectInfo.number}-${sanitizedName}`
      );

      // Create directory
      try {
        await mkdir(projectDir, { recursive: true });
      } catch (err) {
        setState({
          status: "error",
          message: `Failed to create directory: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      setState({
        status: "success",
        project: projectInfo,
        path: projectDir,
      });
    }

    attach();
  }, [args, options.baseDir]);

  if (state.status === "loading") {
    return <Text>Attaching project...</Text>;
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Successfully attached project!</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold>Project:</Text> {state.project.owner}/{state.project.number}
        </Text>
        <Text>
          <Text bold>Name:</Text> {state.project.title}
        </Text>
        <Text>
          <Text bold>Path:</Text> {state.path}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Run `gpfs pull {state.project.owner}/{state.project.number}` to sync items.</Text>
      </Box>
    </Box>
  );
}
