import * as React from "react";
import { Text } from "ink";
import { z } from "zod";
import { getBaseDir } from "../../lib/config.js";
import { stopDaemon } from "../../lib/daemon.js";

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

type StopState =
  | { status: "stopping" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export default function Stop({ options }: Props) {
  const [state, setState] = React.useState<StopState>({ status: "stopping" });

  React.useEffect(() => {
    async function stop() {
      const baseDir = getBaseDir(options.baseDir);
      const result = await stopDaemon(baseDir);

      if (result.success) {
        setState({ status: "success", message: result.message });
      } else {
        setState({ status: "error", message: result.message });
      }
    }

    stop();
  }, [options.baseDir]);

  if (state.status === "stopping") {
    return <Text>Stopping daemon...</Text>;
  }

  if (state.status === "success") {
    return <Text color="green">{state.message}</Text>;
  }

  return <Text color="red">Error: {state.message}</Text>;
}
