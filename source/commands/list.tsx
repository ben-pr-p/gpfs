import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { getTrackedProjects, type TrackedProject } from "../lib/projects.js";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
});

type Props = {
  options: z.infer<typeof options>;
};

export default function List({ options }: Props) {
  const [projects, setProjects] = React.useState<TrackedProject[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function loadProjects() {
      try {
        const baseDir = getBaseDir(options.baseDir);
        const tracked = await getTrackedProjects(baseDir);
        setProjects(tracked);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    loadProjects();
  }, [options.baseDir]);

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }

  if (projects === null) {
    return <Text>Loading...</Text>;
  }

  if (projects.length === 0) {
    return <Text color="yellow">No tracked projects found.</Text>;
  }

  // Calculate column widths
  const projectColWidth = Math.max(
    "PROJECT".length,
    ...projects.map((p) => `${p.owner}/${p.number}`.length)
  );
  const nameColWidth = Math.max(
    "NAME".length,
    ...projects.map((p) => p.name.length)
  );
  const itemsColWidth = Math.max(
    "ITEMS".length,
    ...projects.map((p) => String(p.itemCount).length)
  );

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold color="cyan">
          {"PROJECT".padEnd(projectColWidth)}
        </Text>
        <Text>{"  "}</Text>
        <Text bold color="cyan">
          {"NAME".padEnd(nameColWidth)}
        </Text>
        <Text>{"  "}</Text>
        <Text bold color="cyan">
          {"ITEMS".padEnd(itemsColWidth)}
        </Text>
        <Text>{"  "}</Text>
        <Text bold color="cyan">
          PATH
        </Text>
      </Box>

      {/* Rows */}
      {projects.map((project) => (
        <Box key={`${project.owner}/${project.number}`}>
          <Text>
            {`${project.owner}/${project.number}`.padEnd(projectColWidth)}
          </Text>
          <Text>{"  "}</Text>
          <Text>{project.name.padEnd(nameColWidth)}</Text>
          <Text>{"  "}</Text>
          <Text>{String(project.itemCount).padEnd(itemsColWidth)}</Text>
          <Text>{"  "}</Text>
          <Text dimColor>{project.path}</Text>
        </Box>
      ))}

      {/* Summary */}
      <Box marginTop={1}>
        <Text dimColor>
          {projects.length} project{projects.length !== 1 ? "s" : ""} tracked
        </Text>
      </Box>
    </Box>
  );
}
