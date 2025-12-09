import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../../lib/config.js";
import { getDaemonStatus, writePidFile, logDaemon, DaemonRunner } from "../../lib/daemon.js";
import { mkdir } from "fs/promises";
import { spawn } from "child_process";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
  foreground: z
    .boolean()
    .default(false)
    .describe("Run in foreground instead of background"),
  pollInterval: z
    .number()
    .default(300)
    .describe("GitHub polling interval in seconds (default: 300)"),
  debounce: z
    .number()
    .default(2)
    .describe("Debounce delay for local changes in seconds (default: 2)"),
});

export const args = z.tuple([]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

type StartState =
  | { status: "starting" }
  | { status: "running"; pid: number }
  | { status: "foreground" }
  | { status: "error"; message: string };

export default function Start({ options }: Props) {
  const [state, setState] = React.useState<StartState>({ status: "starting" });

  React.useEffect(() => {
    async function start() {
      const baseDir = getBaseDir(options.baseDir);

      // Ensure base directory exists
      try {
        await mkdir(baseDir, { recursive: true });
      } catch {
        // Ignore - directory may already exist
      }

      // Check if daemon is already running
      const status = await getDaemonStatus(baseDir);
      if (status.running) {
        setState({
          status: "error",
          message: `Daemon is already running (PID ${status.pid})`,
        });
        return;
      }

      if (options.foreground) {
        // Run in foreground
        setState({ status: "foreground" });

        await writePidFile(baseDir, process.pid, {
          pollInterval: options.pollInterval,
          debounce: options.debounce,
        });

        const runner = new DaemonRunner({
          baseDir,
          pollInterval: options.pollInterval,
          debounce: options.debounce,
        });

        await runner.start();
      } else {
        // Spawn background process
        const args = [
          "run",
          "source/cli.tsx",
          "daemon",
          "start",
          "--foreground",
          "--poll-interval",
          String(options.pollInterval),
          "--debounce",
          String(options.debounce),
        ];

        if (options.baseDir) {
          args.push("--base-dir", options.baseDir);
        }

        const child = spawn("bun", args, {
          detached: true,
          stdio: "ignore",
          cwd: process.cwd(),
        });

        child.unref();

        // Wait a moment for the process to start and write PID file
        await new Promise((resolve) => setTimeout(resolve, 500));

        const newStatus = await getDaemonStatus(baseDir);
        if (newStatus.running && newStatus.pid) {
          await logDaemon(baseDir, "info", `Background daemon started with PID ${newStatus.pid}`);
          setState({ status: "running", pid: newStatus.pid });
        } else {
          setState({
            status: "error",
            message: "Failed to start daemon. Check ~/.gpfs/daemon.log for details.",
          });
        }
      }
    }

    start();
  }, [options.baseDir, options.foreground, options.pollInterval, options.debounce]);

  if (state.status === "starting") {
    return <Text>Starting daemon...</Text>;
  }

  if (state.status === "foreground") {
    return (
      <Box flexDirection="column">
        <Text color="green">Daemon running in foreground (PID {process.pid})</Text>
        <Text>Poll interval: {options.pollInterval}s</Text>
        <Text>Debounce: {options.debounce}s</Text>
        <Text color="gray">Press Ctrl+C to stop</Text>
      </Box>
    );
  }

  if (state.status === "running") {
    return (
      <Box flexDirection="column">
        <Text color="green">Daemon started (PID {state.pid})</Text>
        <Text>Poll interval: {options.pollInterval}s</Text>
        <Text>Debounce: {options.debounce}s</Text>
        <Text color="gray">Run `gpfs daemon status` to check status</Text>
        <Text color="gray">Run `gpfs daemon stop` to stop</Text>
      </Box>
    );
  }

  return <Text color="red">Error: {state.message}</Text>;
}
