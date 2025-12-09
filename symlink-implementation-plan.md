# Symlink Feature Implementation Plan

This document outlines the implementation steps for `gpfs link`, `gpfs unlink`, and the `--link` flag on `gpfs attach`.

## Overview

Symlinks allow users to access project files from convenient locations while keeping canonical data in `~/.gpfs/`. The symlink points from the user's preferred location to the gpfs directory.

```
~/projects/roadmap  →  ~/.gpfs/myorg/42-roadmap/
```

## Files to Create

### 1. `source/lib/symlink.ts`

Utility functions for symlink operations:

```typescript
import { symlink, readlink, unlink, lstat } from "fs/promises";
import { dirname, resolve, relative, join } from "path";

/**
 * Create a symlink from linkPath to targetPath.
 * @param targetPath - The gpfs project directory (e.g., ~/.gpfs/myorg/42-roadmap)
 * @param linkPath - Where to create the symlink (e.g., ~/projects/roadmap)
 * @param useRelative - If true, create a relative symlink
 */
export async function createProjectSymlink(
  targetPath: string,
  linkPath: string,
  useRelative: boolean = false
): Promise<void> {
  const target = useRelative
    ? relative(dirname(linkPath), targetPath)
    : resolve(targetPath);

  await symlink(target, linkPath, "dir");
}

/**
 * Check if a path is a symlink pointing to a gpfs project.
 * Returns the resolved project path if valid, null otherwise.
 */
export async function resolveGpfsSymlink(
  linkPath: string,
  baseDir: string
): Promise<string | null> {
  try {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink()) return null;

    const target = await readlink(linkPath);
    const resolved = resolve(dirname(linkPath), target);

    // Check if it points into baseDir
    if (!resolved.startsWith(resolve(baseDir))) return null;

    return resolved;
  } catch {
    return null;
  }
}

/**
 * Remove a symlink if it points to a gpfs project.
 * Throws if not a symlink or doesn't point to gpfs.
 */
export async function removeProjectSymlink(
  linkPath: string,
  baseDir: string
): Promise<void> {
  const resolved = await resolveGpfsSymlink(linkPath, baseDir);
  if (!resolved) {
    throw new Error(
      `${linkPath} is not a symlink to a gpfs project`
    );
  }

  await unlink(linkPath);
}

/**
 * Parse project info from a gpfs project path.
 * Returns { owner, number, name } or null if invalid.
 */
export function parseProjectPath(
  projectPath: string,
  baseDir: string
): { owner: string; number: number; name: string } | null {
  const resolved = resolve(projectPath);
  const base = resolve(baseDir);

  if (!resolved.startsWith(base)) return null;

  const relativePath = resolved.slice(base.length + 1);
  const parts = relativePath.split("/");

  if (parts.length !== 2) return null;

  const owner = parts[0];
  const match = parts[1]?.match(/^(\d+)-(.+)$/);

  if (!match || !owner) return null;

  return {
    owner,
    number: parseInt(match[1]!, 10),
    name: match[2]!,
  };
}
```

### 2. `source/commands/link.tsx`

New command for creating symlinks:

```typescript
import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { getTrackedProjects } from "../lib/projects.js";
import { createProjectSymlink } from "../lib/symlink.js";
import { join, resolve } from "path";
import { stat } from "fs/promises";

export const options = z.object({
  baseDir: z.string().optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
  relative: z.boolean().default(false)
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
  | { status: "success"; projectPath: string; linkPath: string }
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

      setState({
        status: "success",
        projectPath: project.path,
        linkPath,
      });
    }

    doLink();
  }, [args, options]);

  if (state.status === "loading") {
    return <Text>Loading...</Text>;
  }

  if (state.status === "selecting") {
    // TODO: Interactive project selection with ink-select-input
    return <Text>Interactive selection not yet implemented. Please specify a project.</Text>;
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Symlink created!</Text>
      <Text>{state.linkPath} → {state.projectPath}</Text>
    </Box>
  );
}
```

### 3. `source/commands/unlink.tsx`

New command for removing symlinks:

```typescript
import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { removeProjectSymlink, resolveGpfsSymlink } from "../lib/symlink.js";
import { resolve } from "path";

export const options = z.object({
  baseDir: z.string().optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
});

export const args = z.tuple([
  z.string().optional().describe("Path to symlink to remove (default: cwd)"),
]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

type UnlinkState =
  | { status: "loading" }
  | { status: "success"; linkPath: string }
  | { status: "error"; message: string };

export default function Unlink({ options, args }: Props) {
  const [state, setState] = React.useState<UnlinkState>({ status: "loading" });

  React.useEffect(() => {
    async function doUnlink() {
      const baseDir = getBaseDir(options.baseDir);
      const linkPath = args[0] ? resolve(args[0]) : process.cwd();

      try {
        await removeProjectSymlink(linkPath, baseDir);
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      setState({ status: "success", linkPath });
    }

    doUnlink();
  }, [args, options]);

  if (state.status === "loading") {
    return <Text>Removing symlink...</Text>;
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Symlink removed: {state.linkPath}</Text>
    </Box>
  );
}
```

## Files to Modify

### 4. `source/commands/attach.tsx`

Add `--link` flag:

```diff
 export const options = z.object({
   baseDir: z
     .string()
     .optional()
     .describe("Base directory for gpfs data (default: ~/.gpfs)"),
+  link: z
+    .string()
+    .optional()
+    .describe("Create symlink at path (omit path for cwd)"),
 });
```

After successfully creating the project directory, if `--link` is provided:

```typescript
// After mkdir succeeds...
if (options.link !== undefined) {
  const linkPath = options.link || process.cwd();
  // Resolve and create symlink
  await createProjectSymlink(projectDir, linkPath, false);
}
```

**Zod note:** To support `--link` with optional value, we may need a custom approach since Zod doesn't natively support optional flag values. Options:
1. Use `--link` as boolean + separate `--link-path` for custom path
2. Use string that defaults to empty string when flag present without value
3. Check `process.argv` directly for the bare `--link` flag

Simplest: use `--link <path>` as required path, and a separate `--link-cwd` boolean flag for linking to cwd. Or accept that `--link` always needs a path.

### 5. `source/commands/list.tsx` (optional enhancement)

Could show symlinks pointing to each project, but this requires scanning the filesystem which is expensive. Defer for now.

## Implementation Steps

1. **Create `source/lib/symlink.ts`**
   - `createProjectSymlink(targetPath, linkPath, useRelative)`
   - `resolveGpfsSymlink(linkPath, baseDir)`
   - `removeProjectSymlink(linkPath, baseDir)`
   - `parseProjectPath(projectPath, baseDir)`

2. **Create `source/commands/link.tsx`**
   - Parse project identifier argument
   - Find project in tracked projects
   - Determine link path (arg or cwd)
   - Handle case where link path is existing directory
   - Create symlink
   - Display success/error

3. **Create `source/commands/unlink.tsx`**
   - Determine link path (arg or cwd)
   - Validate it's a symlink to gpfs
   - Remove symlink
   - Display success/error

4. **Modify `source/commands/attach.tsx`**
   - Add `--link` option
   - After project directory created, optionally create symlink

5. **Add tests in `source/lib/symlink.test.ts`**
   - Test createProjectSymlink creates valid symlink
   - Test createProjectSymlink with relative option
   - Test resolveGpfsSymlink returns null for non-symlinks
   - Test resolveGpfsSymlink returns null for symlinks outside baseDir
   - Test removeProjectSymlink removes valid symlink
   - Test removeProjectSymlink throws for invalid symlink

6. **Add integration tests**
   - `gpfs attach myorg/42 --link /tmp/test-link`
   - `gpfs link myorg/42 /tmp/test-link`
   - `gpfs unlink /tmp/test-link`

## Edge Cases to Handle

1. **Link path already exists**
   - If it's a file: error
   - If it's a directory: create symlink inside with project name
   - If it's a symlink: error (use unlink first)

2. **Unlinking from inside the symlink**
   - `cd ~/projects/roadmap && gpfs unlink` where cwd is the symlink
   - Need to handle this - cwd might resolve to the real path
   - Use `lstat` on the path before `cd` resolves it? May need to check both cwd and `PWD` env var

3. **Project not attached**
   - Clear error message: "Project X is not attached. Run 'gpfs attach X' first."

4. **Relative symlinks**
   - `--relative` flag creates symlink like `../../.gpfs/myorg/42-roadmap`
   - More portable if user moves both directories together
   - Default to absolute for simplicity

5. **Permissions**
   - Creating symlinks may require specific permissions on some systems
   - Handle EPERM errors gracefully

## Open Questions

1. **Interactive project selection for `gpfs link`**
   - Need to add `ink-select-input` dependency
   - Or require project identifier always

2. **`--link` flag value handling in attach**
   - Pastel/Zod may not support optional flag values well
   - May need `--link-to <path>` instead of `--link [path]`

3. **Should `gpfs list` show symlinks?**
   - Expensive to scan filesystem
   - Could add `--show-links` flag that scans
   - Or skip for v1
