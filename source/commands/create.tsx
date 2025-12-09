import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { sanitizeForFilesystem } from "../lib/filesystem.js";
import { ghCreateProject, ghGetLoggedInUser } from "../lib/github.js";
import { mkdir } from "fs/promises";
import { join } from "path";

export const options = z.object({
  owner: z
    .string()
    .optional()
    .describe("Organization or user that owns the project (default: logged-in user)"),
  title: z
    .string()
    .describe("Title for the new project"),
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
});

export const args = z.tuple([]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

type CreateState =
  | { status: "creating"; message: string }
  | { status: "success"; project: { owner: string; number: number; title: string; path: string } }
  | { status: "error"; message: string };

export default function Create({ options }: Props) {
  const [state, setState] = React.useState<CreateState>({ status: "creating", message: "Creating project..." });

  React.useEffect(() => {
    async function create() {
      const baseDir = getBaseDir(options.baseDir);

      // Resolve owner - use provided value or get logged-in user
      let owner = options.owner;
      if (!owner) {
        setState({ status: "creating", message: "Getting logged-in user..." });
        const userResult = await ghGetLoggedInUser();
        if (!userResult.success) {
          setState({ status: "error", message: userResult.message });
          return;
        }
        owner = userResult.login;
      }

      // Create the project on GitHub
      setState({ status: "creating", message: `Creating project "${options.title}" for ${owner}...` });

      const result = await ghCreateProject(owner, options.title);

      if (!result.success) {
        setState({ status: "error", message: result.message });
        return;
      }

      const { number, title } = result.project;

      // Create local directory structure
      const sanitizedName = sanitizeForFilesystem(title);
      const projectPath = join(baseDir, owner, `${number}-${sanitizedName}`);

      try {
        await mkdir(projectPath, { recursive: true });
      } catch (err) {
        setState({
          status: "error",
          message: `Created project on GitHub but failed to create local directory: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      setState({
        status: "success",
        project: {
          owner,
          number,
          title,
          path: projectPath,
        },
      });
    }

    create();
  }, [options.owner, options.title, options.baseDir]);

  if (state.status === "creating") {
    return <Text>{state.message}</Text>;
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Created project: {state.project.owner}/{state.project.number}</Text>
      <Text>  Title: {state.project.title}</Text>
      <Text>  Path: {state.project.path}</Text>
    </Box>
  );
}
