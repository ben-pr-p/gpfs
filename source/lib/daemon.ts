/**
 * Daemon utilities for background sync.
 */

import { join } from "path";
import { readFile, writeFile, unlink, appendFile, readdir, watch } from "fs/promises";
import { getTrackedProjects } from "./projects.js";
import { ghProjectView, ghProjectItemList, ghUpdateDraftIssue, ghDeleteItem } from "./github.js";
import { serializeItemToMarkdown, parseMarkdownFile, computeChecksum } from "./markdown.js";
import { sanitizeForFilesystem } from "./filesystem.js";

export type DaemonConfig = {
  baseDir: string;
  pollInterval: number; // seconds
  debounce: number; // seconds
};

export type DaemonStatus = {
  running: boolean;
  pid?: number;
  startedAt?: string;
  pollInterval?: number;
  debounce?: number;
};

/**
 * Get path to daemon PID file.
 */
export function getPidFilePath(baseDir: string): string {
  return join(baseDir, "daemon.pid");
}

/**
 * Get path to daemon log file.
 */
export function getLogFilePath(baseDir: string): string {
  return join(baseDir, "daemon.log");
}

/**
 * Read daemon status from PID file.
 */
export async function getDaemonStatus(baseDir: string): Promise<DaemonStatus> {
  const pidFile = getPidFilePath(baseDir);

  try {
    const content = await readFile(pidFile, "utf-8");
    const data = JSON.parse(content);
    const pid = data.pid as number;

    // Check if process is still running
    try {
      process.kill(pid, 0); // Signal 0 just checks if process exists
      return {
        running: true,
        pid,
        startedAt: data.startedAt,
        pollInterval: data.pollInterval,
        debounce: data.debounce,
      };
    } catch {
      // Process not running - clean up stale PID file
      await unlink(pidFile).catch(() => {});
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

/**
 * Write daemon PID file.
 */
export async function writePidFile(
  baseDir: string,
  pid: number,
  config: { pollInterval: number; debounce: number }
): Promise<void> {
  const pidFile = getPidFilePath(baseDir);
  const data = {
    pid,
    startedAt: new Date().toISOString(),
    pollInterval: config.pollInterval,
    debounce: config.debounce,
  };
  await writeFile(pidFile, JSON.stringify(data, null, 2));
}

/**
 * Remove daemon PID file.
 */
export async function removePidFile(baseDir: string): Promise<void> {
  const pidFile = getPidFilePath(baseDir);
  await unlink(pidFile).catch(() => {});
}

/**
 * Log a message to the daemon log file.
 */
export async function logDaemon(baseDir: string, level: "info" | "error" | "warn", message: string): Promise<void> {
  const logFile = getLogFilePath(baseDir);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  await appendFile(logFile, line);
}

/**
 * Stop the daemon by sending SIGTERM to its process.
 */
export async function stopDaemon(baseDir: string): Promise<{ success: boolean; message: string }> {
  const status = await getDaemonStatus(baseDir);

  if (!status.running || !status.pid) {
    return { success: false, message: "Daemon is not running" };
  }

  try {
    process.kill(status.pid, "SIGTERM");
    // Wait a bit for process to exit
    await new Promise((resolve) => setTimeout(resolve, 500));
    await removePidFile(baseDir);
    return { success: true, message: `Stopped daemon (PID ${status.pid})` };
  } catch (err) {
    return {
      success: false,
      message: `Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Run pull operation for all tracked projects.
 */
export async function pullAllProjects(baseDir: string): Promise<{ success: boolean; message: string }> {
  const projects = await getTrackedProjects(baseDir);

  if (projects.length === 0) {
    return { success: true, message: "No tracked projects" };
  }

  const results: string[] = [];

  for (const project of projects) {
    try {
      const projectInfo = await ghProjectView(project.owner, project.number);
      if (!projectInfo.success) {
        results.push(`${project.owner}/${project.number}: ${projectInfo.message}`);
        continue;
      }

      const itemsResult = await ghProjectItemList(project.owner, project.number);
      if (!itemsResult.success) {
        results.push(`${project.owner}/${project.number}: ${itemsResult.message}`);
        continue;
      }

      const remoteItems = itemsResult.items;
      const remoteItemIds = new Set(remoteItems.map((item) => item.id));

      // Read existing local files
      let existingFiles: string[];
      try {
        existingFiles = (await readdir(project.path)).filter((f) => f.endsWith(".md"));
      } catch {
        existingFiles = [];
      }

      // Build map of existing item IDs to filenames
      const localItemMap = new Map<string, { filename: string }>();
      for (const filename of existingFiles) {
        const filePath = join(project.path, filename);
        const parsed = await parseMarkdownFile(filePath);
        if (parsed && parsed.frontmatter.id) {
          localItemMap.set(parsed.frontmatter.id as string, { filename });
        }
      }

      let created = 0;
      let updated = 0;
      const usedFilenames = new Set(existingFiles);

      for (const item of remoteItems) {
        const existingLocal = localItemMap.get(item.id);

        const markdown = serializeItemToMarkdown(item, {
          projectId: projectInfo.project.id,
          projectOwner: project.owner,
          projectNumber: project.number,
        });

        if (existingLocal) {
          const filePath = join(project.path, existingLocal.filename);
          const currentParsed = await parseMarkdownFile(filePath);
          const currentBody = currentParsed?.body || "";

          if (currentParsed?.frontmatter.title !== item.title || currentBody !== item.body) {
            await writeFile(filePath, markdown);
            updated++;
          }
        } else {
          const baseFilename = sanitizeForFilesystem(item.title || "untitled");
          let filename = `${baseFilename}.md`;
          let counter = 2;
          while (usedFilenames.has(filename)) {
            filename = `${baseFilename}-${counter}.md`;
            counter++;
          }
          usedFilenames.add(filename);

          const filePath = join(project.path, filename);
          await writeFile(filePath, markdown);
          created++;
        }
      }

      // Mark deleted items
      let deleted = 0;
      for (const [itemId, { filename }] of localItemMap) {
        if (!remoteItemIds.has(itemId)) {
          const filePath = join(project.path, filename);
          const parsed = await parseMarkdownFile(filePath);
          if (parsed && !parsed.frontmatter.deleted) {
            parsed.frontmatter.deleted = true;
            const yaml = Object.entries(parsed.frontmatter)
              .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
              .join("\n");
            await writeFile(filePath, `---\n${yaml}\n---\n\n${parsed.body}`);
            deleted++;
          }
        }
      }

      if (created > 0 || updated > 0 || deleted > 0) {
        results.push(`${project.owner}/${project.number}: ${created} created, ${updated} updated, ${deleted} deleted`);
      }
    } catch (err) {
      results.push(`${project.owner}/${project.number}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    success: true,
    message: results.length > 0 ? results.join("; ") : "No changes",
  };
}

/**
 * Push changes for a specific file.
 */
export async function pushFile(
  baseDir: string,
  filePath: string
): Promise<{ success: boolean; message: string }> {
  // Parse the file
  const parsed = await parseMarkdownFile(filePath);
  if (!parsed) {
    return { success: false, message: `Could not parse file: ${filePath}` };
  }

  const fm = parsed.frontmatter;
  const itemId = fm.id as string | undefined;
  const contentId = fm.content_id as string | undefined;
  const contentType = fm.content_type as string | undefined;
  const projectOwner = fm.project_owner as string | undefined;
  const projectNumber = fm.project_number as number | undefined;
  const title = fm.title as string;
  const body = parsed.body;
  const isDeleted = fm.deleted === true;

  if (!itemId || !projectOwner || !projectNumber) {
    return { success: false, message: "File missing required metadata (id, project_owner, project_number)" };
  }

  // Handle deletion
  if (isDeleted) {
    const result = await ghDeleteItem(projectOwner, projectNumber, itemId);
    if (result.success) {
      await unlink(filePath);
      return { success: true, message: `Deleted item ${itemId}` };
    }
    return { success: false, message: result.message };
  }

  // Handle update
  if (contentType === "DraftIssue" && contentId) {
    // Check if content changed since last sync
    const storedChecksum = (fm._sync as Record<string, unknown>)?.local_checksum as string | undefined;
    const currentChecksum = computeChecksum(body);

    if (storedChecksum && currentChecksum === storedChecksum) {
      return { success: true, message: "No changes to push" };
    }

    const result = await ghUpdateDraftIssue(contentId, title, body);
    if (result.success) {
      // Update local checksum
      const sync = (fm._sync as Record<string, unknown>) || {};
      sync.local_checksum = currentChecksum;
      sync.remote_updated_at = new Date().toISOString();
      fm._sync = sync;

      const yaml = Object.entries(fm)
        .map(([k, v]) => {
          if (typeof v === "object" && v !== null) {
            return `${k}: ${JSON.stringify(v)}`;
          }
          if (typeof v === "string" && (v.includes(":") || v.includes("\n"))) {
            return `${k}: ${JSON.stringify(v)}`;
          }
          return `${k}: ${v}`;
        })
        .join("\n");
      await writeFile(filePath, `---\n${yaml}\n---\n\n${body}`);

      return { success: true, message: `Updated item ${itemId}` };
    }
    return { success: false, message: result.message };
  }

  return { success: true, message: "No changes to push (non-draft items not supported)" };
}

/**
 * Daemon main loop class.
 */
export class DaemonRunner {
  private config: DaemonConfig;
  private running = false;
  private pendingChanges = new Map<string, NodeJS.Timeout>();
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(config: DaemonConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.running = true;
    await logDaemon(this.config.baseDir, "info", "Daemon started");

    // Set up file watching for all tracked projects
    await this.setupFileWatching();

    // Start polling loop
    this.startPolling();

    // Handle shutdown signals
    process.on("SIGTERM", () => this.stop());
    process.on("SIGINT", () => this.stop());

    // Keep the process alive
    await new Promise(() => {});
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    await logDaemon(this.config.baseDir, "info", "Daemon stopping");

    // Clear pending changes
    for (const timeout of this.pendingChanges.values()) {
      clearTimeout(timeout);
    }
    this.pendingChanges.clear();

    // Clear poll timer
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    await removePidFile(this.config.baseDir);
    await logDaemon(this.config.baseDir, "info", "Daemon stopped");
    process.exit(0);
  }

  private async setupFileWatching(): Promise<void> {
    const projects = await getTrackedProjects(this.config.baseDir);

    for (const project of projects) {
      await this.watchDirectory(project.path);
    }

    await logDaemon(this.config.baseDir, "info", `Watching ${projects.length} project(s)`);
  }

  private async watchDirectory(dirPath: string): Promise<void> {
    try {
      const watcher = watch(dirPath);

      (async () => {
        for await (const event of watcher) {
          if (!this.running) break;

          // Only process .md files
          const filename = event.filename;
          if (!filename || !filename.endsWith(".md")) continue;

          const filePath = join(dirPath, filename);
          await logDaemon(this.config.baseDir, "info", `File changed: ${filePath}`);

          // Debounce the change
          this.scheduleFilePush(filePath);
        }
      })();
    } catch (err) {
      await logDaemon(
        this.config.baseDir,
        "error",
        `Failed to watch directory ${dirPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private scheduleFilePush(filePath: string): void {
    // Clear existing timeout for this file
    const existing = this.pendingChanges.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule push after debounce delay
    const timeout = setTimeout(async () => {
      this.pendingChanges.delete(filePath);
      try {
        const result = await pushFile(this.config.baseDir, filePath);
        if (result.success) {
          await logDaemon(this.config.baseDir, "info", `Push: ${result.message}`);
        } else {
          await logDaemon(this.config.baseDir, "error", `Push failed: ${result.message}`);
        }
      } catch (err) {
        await logDaemon(
          this.config.baseDir,
          "error",
          `Push error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }, this.config.debounce * 1000);

    this.pendingChanges.set(filePath, timeout);
  }

  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      if (!this.running) return;

      await logDaemon(this.config.baseDir, "info", "Polling for remote changes");
      try {
        const result = await pullAllProjects(this.config.baseDir);
        await logDaemon(this.config.baseDir, "info", `Poll complete: ${result.message}`);
      } catch (err) {
        await logDaemon(
          this.config.baseDir,
          "error",
          `Poll error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }, this.config.pollInterval * 1000);
  }
}
