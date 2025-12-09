import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { removeProjectSymlink } from "../lib/symlink.js";
import { resolve } from "path";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
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
      // Use PWD env var if available (preserves symlink path), otherwise resolve args
      const linkPath = args[0]
        ? resolve(args[0])
        : process.env.PWD || process.cwd();

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
