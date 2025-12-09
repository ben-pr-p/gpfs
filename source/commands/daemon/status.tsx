import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../../lib/config.js";
import { getDaemonStatus, getLogFilePath } from "../../lib/daemon.js";

export const options = z.object({
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

type StatusState =
  | { status: "loading" }
  | { status: "loaded"; daemonStatus: Awaited<ReturnType<typeof getDaemonStatus>>; logPath: string };

export default function Status({ options }: Props) {
  const [state, setState] = React.useState<StatusState>({ status: "loading" });

  React.useEffect(() => {
    async function checkStatus() {
      const baseDir = getBaseDir(options.baseDir);
      const daemonStatus = await getDaemonStatus(baseDir);
      const logPath = getLogFilePath(baseDir);
      setState({ status: "loaded", daemonStatus, logPath });
    }

    checkStatus();
  }, [options.baseDir]);

  if (state.status === "loading") {
    return <Text>Checking daemon status...</Text>;
  }

  const { daemonStatus, logPath } = state;

  if (!daemonStatus.running) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Daemon is not running</Text>
        <Text color="gray">Run `gpfs daemon start` to start the daemon</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Daemon is running</Text>
      <Text>  PID: {daemonStatus.pid}</Text>
      <Text>  Started: {daemonStatus.startedAt}</Text>
      <Text>  Poll interval: {daemonStatus.pollInterval}s</Text>
      <Text>  Debounce: {daemonStatus.debounce}s</Text>
      <Text color="gray">  Log: {logPath}</Text>
    </Box>
  );
}
