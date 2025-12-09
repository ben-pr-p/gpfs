import { homedir } from "os";
import { join } from "path";

/**
 * Resolves the base directory for gpfs data.
 * Priority: explicit argument > GPFS_BASE_DIR env var > default (~/.gpfs)
 */
export function getBaseDir(explicitBaseDir?: string): string {
  return (
    explicitBaseDir || process.env.GPFS_BASE_DIR || join(homedir(), ".gpfs")
  );
}
