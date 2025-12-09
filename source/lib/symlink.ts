import { symlink, readlink, unlink, lstat } from "fs/promises";
import { dirname, resolve, relative } from "path";

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
    throw new Error(`${linkPath} is not a symlink to a gpfs project`);
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
