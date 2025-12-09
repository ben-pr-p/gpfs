import * as React from "react";
import { Text, Box, useInput, useApp } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { getTrackedProjects } from "../lib/projects.js";
import { sanitizeForFilesystem } from "../lib/filesystem.js";
import {
  ghGetLoggedInUser,
  ghProjectList,
  type ProjectInfo,
} from "../lib/github.js";
import { mkdir } from "fs/promises";
import { join } from "path";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
  owner: z
    .string()
    .optional()
    .describe("GitHub owner to list projects for (default: logged-in user)"),
});

type Props = {
  options: z.infer<typeof options>;
};

type RemoteAttachAllState =
  | { status: "loading"; message: string }
  | { status: "no-unattached" }
  | {
      status: "asking";
      unattachedProjects: ProjectInfo[];
      currentIndex: number;
      attached: ProjectInfo[];
      skipped: ProjectInfo[];
    }
  | { status: "done"; attached: ProjectInfo[]; skipped: ProjectInfo[] }
  | { status: "error"; message: string };

export default function RemoteAttachAll({ options }: Props) {
  const { exit } = useApp();
  const [state, setState] = React.useState<RemoteAttachAllState>({
    status: "loading",
    message: "Getting logged-in user...",
  });
  const baseDirRef = React.useRef<string>("");

  React.useEffect(() => {
    async function loadProjects() {
      // Determine owner
      let owner = options.owner;
      if (!owner) {
        const userResult = await ghGetLoggedInUser();
        if (!userResult.success) {
          setState({ status: "error", message: userResult.message });
          return;
        }
        owner = userResult.login;
      }

      setState({ status: "loading", message: `Fetching projects for ${owner}...` });

      // Fetch all projects from GitHub
      const projectsResult = await ghProjectList(owner);
      if (!projectsResult.success) {
        setState({ status: "error", message: projectsResult.message });
        return;
      }

      // Get already attached projects
      const baseDir = getBaseDir(options.baseDir);
      baseDirRef.current = baseDir;
      const trackedProjects = await getTrackedProjects(baseDir);

      // Filter to unattached projects
      const attachedSet = new Set(
        trackedProjects.map((p) => `${p.owner}/${p.number}`)
      );
      const unattachedProjects = projectsResult.projects.filter(
        (p) => !attachedSet.has(`${p.owner}/${p.number}`)
      );

      if (unattachedProjects.length === 0) {
        setState({ status: "no-unattached" });
        return;
      }

      setState({
        status: "asking",
        unattachedProjects,
        currentIndex: 0,
        attached: [],
        skipped: [],
      });
    }

    loadProjects();
  }, [options.owner, options.baseDir]);

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (state.status !== "asking") return;

      const currentProject = state.unattachedProjects[state.currentIndex];
      if (!currentProject) return;

      const handleResponse = async (attach: boolean) => {
        const newAttached = attach
          ? [...state.attached, currentProject]
          : state.attached;
        const newSkipped = attach
          ? state.skipped
          : [...state.skipped, currentProject];

        // Attach the project if user said yes
        if (attach) {
          const sanitizedName = sanitizeForFilesystem(currentProject.title);
          const projectDir = join(
            baseDirRef.current,
            currentProject.owner,
            `${currentProject.number}-${sanitizedName}`
          );
          try {
            await mkdir(projectDir, { recursive: true });
          } catch {
            // If mkdir fails, still continue to next project
          }
        }

        const nextIndex = state.currentIndex + 1;
        if (nextIndex >= state.unattachedProjects.length) {
          setState({
            status: "done",
            attached: newAttached,
            skipped: newSkipped,
          });
        } else {
          setState({
            ...state,
            currentIndex: nextIndex,
            attached: newAttached,
            skipped: newSkipped,
          });
        }
      };

      if (input.toLowerCase() === "y") {
        handleResponse(true);
      } else if (input.toLowerCase() === "n") {
        handleResponse(false);
      } else if (input.toLowerCase() === "q" || key.escape) {
        setState({
          status: "done",
          attached: state.attached,
          skipped: [
            ...state.skipped,
            ...state.unattachedProjects.slice(state.currentIndex),
          ],
        });
      }
    },
    { isActive: state.status === "asking" }
  );

  // Exit when done
  React.useEffect(() => {
    if (state.status === "done" || state.status === "no-unattached" || state.status === "error") {
      const timer = setTimeout(() => exit(), 100);
      return () => clearTimeout(timer);
    }
  }, [state.status, exit]);

  if (state.status === "loading") {
    return <Text>{state.message}</Text>;
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  if (state.status === "no-unattached") {
    return <Text color="green">All accessible projects are already attached!</Text>;
  }

  if (state.status === "asking") {
    const current = state.unattachedProjects[state.currentIndex];
    if (!current) return null;

    return (
      <Box flexDirection="column">
        <Text dimColor>
          Project {state.currentIndex + 1} of {state.unattachedProjects.length}
        </Text>
        <Box marginTop={1}>
          <Text>
            Attach <Text color="cyan" bold>{current.owner}/{current.number}</Text> ({current.title})?{" "}
            <Text dimColor>[y/n/q]</Text>
          </Text>
        </Box>
        {state.attached.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor>Attached so far: {state.attached.length}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Done state
  return (
    <Box flexDirection="column">
      <Text color="green" bold>Done!</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold>Attached:</Text> {state.attached.length} project(s)
        </Text>
        {state.attached.map((p) => (
          <Text key={`${p.owner}/${p.number}`} dimColor>
            {"  "}- {p.owner}/{p.number} ({p.title})
          </Text>
        ))}
        <Text>
          <Text bold>Skipped:</Text> {state.skipped.length} project(s)
        </Text>
      </Box>
      {state.attached.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            Run `gpfs pull` to sync items from attached projects.
          </Text>
        </Box>
      )}
    </Box>
  );
}
