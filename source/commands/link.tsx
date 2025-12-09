import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { getTrackedProjects, type TrackedProject } from "../lib/projects.js";
import { createProjectSymlink } from "../lib/symlink.js";
import { getProjectSkillContent } from "../lib/claude-md.js";
import { join, resolve, dirname, basename } from "path";
import { stat, writeFile, readFile, appendFile, mkdir } from "fs/promises";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
  relative: z
    .boolean()
    .default(false)
    .describe("Create a relative symlink instead of absolute"),
});

export const args = z.tuple([
  z.string().optional().describe("owner/project-number (e.g., myorg/42)"),
  z.string().optional().describe("Target path for symlink (default: cwd)"),
]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

type LinkState =
  | { status: "loading" }
  | { status: "selecting"; projects: TrackedProject[] }
  | { status: "success"; projectPath: string; linkPath: string; skillPath?: string; addedToGitignore?: boolean }
  | { status: "error"; message: string };

export default function Link({ options, args }: Props) {
  const [state, setState] = React.useState<LinkState>({ status: "loading" });

  React.useEffect(() => {
    async function doLink() {
      const baseDir = getBaseDir(options.baseDir);
      const projects = await getTrackedProjects(baseDir);

      const [projectId, targetPath] = args;

      // If no project specified, need interactive selection
      if (!projectId) {
        if (projects.length === 0) {
          setState({ status: "error", message: "No tracked projects found." });
          return;
        }
        setState({ status: "selecting", projects });
        return;
      }

      // Parse project identifier
      const match = projectId.match(/^([^/]+)\/(\d+)$/);
      if (!match) {
        setState({
          status: "error",
          message: `Invalid project identifier: "${projectId}". Expected format: owner/number`,
        });
        return;
      }

      const owner = match[1]!;
      const number = parseInt(match[2]!, 10);

      // Find project
      const project = projects.find(
        (p) => p.owner === owner && p.number === number
      );

      if (!project) {
        setState({
          status: "error",
          message: `Project ${projectId} is not attached. Run 'gpfs attach ${projectId}' first.`,
        });
        return;
      }

      // Determine link path
      let linkPath = targetPath ? resolve(targetPath) : process.cwd();

      // If linkPath is an existing directory, put symlink inside it
      try {
        const stats = await stat(linkPath);
        if (stats.isDirectory()) {
          linkPath = join(linkPath, `${project.number}-${project.name}`);
        }
      } catch {
        // Path doesn't exist, use as-is
      }

      // Create symlink
      try {
        await createProjectSymlink(project.path, linkPath, options.relative);
      } catch (err) {
        setState({
          status: "error",
          message: `Failed to create symlink: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      // Create Claude skill file in .claude/skills/ directory of the parent
      let skillPath: string | undefined;
      const parentDir = dirname(linkPath);
      const linkName = basename(linkPath);
      const skillDir = join(parentDir, ".claude", "skills");
      const skillFile = join(skillDir, `${linkName}.md`);

      try {
        await mkdir(skillDir, { recursive: true });
        const skillContent = getProjectSkillContent(owner, number, project.name);
        await writeFile(skillFile, skillContent);
        skillPath = skillFile;
      } catch {
        // Non-fatal: skill file creation failed
      }

      // Add symlink to .gitignore if it exists
      let addedToGitignore = false;
      const gitignorePath = join(parentDir, ".gitignore");
      try {
        const gitignoreContent = await readFile(gitignorePath, "utf-8");
        // Check if already in gitignore
        const lines = gitignoreContent.split("\n");
        if (!lines.some((line) => line.trim() === linkName || line.trim() === `/${linkName}`)) {
          // Add to gitignore
          const newEntry = gitignoreContent.endsWith("\n") ? `${linkName}\n` : `\n${linkName}\n`;
          await appendFile(gitignorePath, newEntry);
          addedToGitignore = true;
        }
      } catch {
        // .gitignore doesn't exist or not readable, skip
      }

      setState({
        status: "success",
        projectPath: project.path,
        linkPath,
        skillPath,
        addedToGitignore,
      });
    }

    doLink();
  }, [args, options]);

  if (state.status === "loading") {
    return <Text>Loading...</Text>;
  }

  if (state.status === "selecting") {
    // TODO: Interactive project selection with ink-select-input
    return (
      <Box flexDirection="column">
        <Text>
          Interactive selection not yet implemented. Please specify a project.
        </Text>
        <Text dimColor>Available projects:</Text>
        {state.projects.map((p) => (
          <Text key={`${p.owner}/${p.number}`}>
            {" "}
            - {p.owner}/{p.number} ({p.name})
          </Text>
        ))}
      </Box>
    );
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Symlink created!</Text>
      <Text>
        {state.linkPath} → {state.projectPath}
      </Text>
      {state.skillPath && (
        <Text dimColor>Claude skill: {state.skillPath}</Text>
      )}
      {state.addedToGitignore && (
        <Text dimColor>Added to .gitignore</Text>
      )}
    </Box>
  );
}
