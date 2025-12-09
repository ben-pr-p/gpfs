import { Text, Box } from "ink";

export default function Index() {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">gpfs</Text>
        <Text> - GitHub Project File Sync</Text>
      </Box>

      <Text>Sync GitHub Projects to local markdown files for editing and version control.</Text>

      <Box marginTop={1} marginBottom={1}>
        <Text bold>Usage:</Text>
        <Text> gpfs {"<command>"} [options]</Text>
      </Box>

      <Text bold>Commands:</Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text>
          <Text color="green">attach</Text>
          <Text> {"<owner/number>"}    </Text>
          <Text dimColor>Start tracking a GitHub project</Text>
        </Text>
        <Text>
          <Text color="green">detach</Text>
          <Text> {"<owner/number>"}    </Text>
          <Text dimColor>Stop tracking a project (preserves files)</Text>
        </Text>
        <Text>
          <Text color="green">create</Text>
          <Text> --owner --title    </Text>
          <Text dimColor>Create a new GitHub project</Text>
        </Text>
        <Text>
          <Text color="green">list</Text>
          <Text>                      </Text>
          <Text dimColor>List all tracked projects</Text>
        </Text>
        <Text>
          <Text color="green">status</Text>
          <Text> [owner/number]     </Text>
          <Text dimColor>Show sync status for project(s)</Text>
        </Text>
        <Text>
          <Text color="green">pull</Text>
          <Text> [owner/number]       </Text>
          <Text dimColor>Fetch items from GitHub to local files</Text>
        </Text>
        <Text>
          <Text color="green">push</Text>
          <Text> [owner/number]       </Text>
          <Text dimColor>Push local changes to GitHub</Text>
        </Text>
        <Text>
          <Text color="green">link</Text>
          <Text> {"<owner/number>"} [path] </Text>
          <Text dimColor>Create symlink to project directory</Text>
        </Text>
        <Text>
          <Text color="green">unlink</Text>
          <Text> {"<path>"}             </Text>
          <Text dimColor>Remove a project symlink</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text bold>Examples:</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>gpfs attach myorg/42          # Start tracking project #42</Text>
        <Text dimColor>gpfs pull                     # Sync all projects from GitHub</Text>
        <Text dimColor>gpfs push myorg/42            # Push local changes to GitHub</Text>
        <Text dimColor>gpfs status                   # Check sync status</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Run `gpfs {"<command>"} --help` for more information on a command.</Text>
      </Box>
    </Box>
  );
}
