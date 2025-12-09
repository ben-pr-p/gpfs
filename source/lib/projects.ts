import { join } from "path";
import { readdir, stat } from "fs/promises";

export type TrackedProject = {
  owner: string;
  number: number;
  name: string;
  path: string;
  itemCount: number;
};

/**
 * Scans the base directory and returns all tracked projects.
 * Projects are discovered by scanning the directory structure:
 * <baseDir>/<owner>/<project-number>-<project-name>/
 */
export async function getTrackedProjects(
  baseDir: string
): Promise<TrackedProject[]> {
  // Check if base directory exists
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    // Base directory doesn't exist - no tracked projects
    return [];
  }

  const tracked: TrackedProject[] = [];

  // Scan owner directories
  for (const ownerName of entries) {
    const ownerPath = join(baseDir, ownerName);

    // Skip files (like daemon.log) - only process directories
    try {
      const ownerStat = await stat(ownerPath);
      if (!ownerStat.isDirectory()) continue;
    } catch {
      continue;
    }

    let ownerEntries: string[];
    try {
      ownerEntries = await readdir(ownerPath);
    } catch {
      continue;
    }

    // Scan project directories within owner
    for (const projectDir of ownerEntries) {
      // Parse project directory name: <number>-<name>
      const match = projectDir.match(/^(\d+)-(.+)$/);
      if (!match) continue;

      const projectNumber = parseInt(match[1], 10);
      const projectName = match[2];
      const projectPath = join(ownerPath, projectDir);

      // Verify it's a directory
      try {
        const projectStat = await stat(projectPath);
        if (!projectStat.isDirectory()) continue;
      } catch {
        continue;
      }

      // Count .md files
      let itemCount = 0;
      try {
        const projectFiles = await readdir(projectPath);
        itemCount = projectFiles.filter((f) => f.endsWith(".md")).length;
      } catch {
        // Skip if we can't read the directory
        continue;
      }

      tracked.push({
        owner: ownerName,
        number: projectNumber,
        name: projectName,
        path: projectPath,
        itemCount,
      });
    }
  }

  // Sort by owner, then by project number
  tracked.sort((a, b) => {
    const ownerCmp = a.owner.localeCompare(b.owner);
    if (ownerCmp !== 0) return ownerCmp;
    return a.number - b.number;
  });

  return tracked;
}
