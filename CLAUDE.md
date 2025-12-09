# gh-project-file-sync

A Pastel + Ink CLI application using Bun.

## Running

```sh
bun run dev           # Run the CLI
bun run source/cli.tsx --help  # Show help
```

## Project Structure

```
source/
├── cli.tsx           # Entry point - initializes Pastel app
└── commands/
    └── index.tsx     # Default command (runs when no subcommand given)
```

## Pastel Commands

Pastel uses file-based routing in `source/commands/`:

- `index.tsx` - Default command
- `foo.tsx` - Creates `gh-project-file-sync foo` subcommand
- `foo/bar.tsx` - Creates `gh-project-file-sync foo bar` subcommand

## Command Structure

Commands export a default React component and optionally export `options` and `args` Zod schemas:

```tsx
import { Text } from "ink";
import { z } from "zod";

// Options (--flag, -f)
export const options = z.object({
  name: z.string().default("World").describe("Name to greet"),
  verbose: z.boolean().default(false).describe("Enable verbose output"),
});

// Positional arguments
export const args = z.tuple([
  z.string().describe("file"),
]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

export default function MyCommand({ options, args }: Props) {
  return <Text>Hello, {options.name}!</Text>;
}
```

## Ink Components

Use Ink for terminal UI:

```tsx
import { Text, Box } from "ink";

// Text with color
<Text color="green">Success!</Text>
<Text color="red" bold>Error</Text>

// Layout with Box
<Box flexDirection="column" padding={1}>
  <Text>Line 1</Text>
  <Text>Line 2</Text>
</Box>
```

## Bun

Use Bun instead of Node.js:

- `bun run <script>` instead of npm/yarn/pnpm
- `bun test` for tests
- `Bun.file()` for file I/O
- `Bun.$\`command\`` for shell commands
- Bun auto-loads .env files
