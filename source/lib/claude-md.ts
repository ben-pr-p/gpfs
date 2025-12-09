import { join } from "path";
import { mkdir, writeFile, stat } from "fs/promises";
import { getBaseDir } from "./config.js";

const CLAUDE_MD_CONTENT = `# gpfs

Manage GitHub Projects via local markdown files using gpfs (gh-project-file-sync).

## Creating Issues

Create a new item by creating a markdown file in any tracked project directory:

\`\`\`markdown
---
title: My new issue
status: Todo
---

Description of the issue goes here.
\`\`\`

The file will be synced to GitHub on the next \`gpfs push\` or automatically if the daemon is running.

**Required fields:** Only \`title\` is required. Other fields like \`status\`, \`assignees\`, \`labels\`, \`priority\`, etc. are optional.

**File naming:** Name the file descriptively (e.g., \`fix-login-bug.md\`). The filename doesn't affect the issue title.

## Available Commands

### Project Management
- \`gpfs create --owner <org-or-user> --name <name> --visibility <public|private>\` - Create new project
- \`gpfs attach <owner/project-number>\` - Start tracking existing project
- \`gpfs attach --interactive\` - Interactively select project to track
- \`gpfs detach <owner/project-number>\` - Stop tracking project (keeps local files)
- \`gpfs list\` - List all tracked projects

### Symlinks
- \`gpfs link <owner/project-number> [path]\` - Create symlink to project directory
- \`gpfs link\` - Interactive project selection, symlink in cwd
- \`gpfs unlink [path]\` - Remove symlink to project

### Sync Operations
- \`gpfs pull\` - Pull all tracked projects from GitHub
- \`gpfs pull <owner/project-number>\` - Pull specific project
- \`gpfs push\` - Push all local changes to GitHub
- \`gpfs push <owner/project-number>\` - Push specific project
- \`gpfs status\` - Show sync status for all projects

### Query
- \`gpfs query "<sql>"\` - Query items using SQL (DuckDB)

### Daemon (Background Sync)
- \`gpfs daemon start\` - Start background sync daemon
- \`gpfs daemon stop\` - Stop daemon
- \`gpfs daemon status\` - Check daemon status

## File Format

Items are stored as markdown with YAML frontmatter:

\`\`\`yaml
---
id: PVTI_xxx                    # Auto-generated after first push
project_id: PVT_xxx             # Auto-generated
project_owner: myorg
project_number: 42
title: Fix login bug
status: In Progress
assignees:
  - octocat
labels:
  - bug
priority: High
due_date: 2025-02-01
deleted: false
---

Item description in markdown.
\`\`\`

## Quick Workflow

1. Create a file in the project directory with frontmatter containing at least \`title\`
2. Run \`gpfs push\` (or let the daemon sync automatically)
3. The item appears in GitHub Projects with an assigned ID
`;

/**
 * Ensures CLAUDE.md exists in the gpfs base directory.
 * Creates it if it doesn't exist, leaves it alone if it does.
 */
export async function ensureClaudeMd(explicitBaseDir?: string): Promise<void> {
  const baseDir = getBaseDir(explicitBaseDir);
  const claudeMdPath = join(baseDir, "CLAUDE.md");

  try {
    await stat(claudeMdPath);
    // File exists, don't overwrite
  } catch {
    // File doesn't exist, create it
    await mkdir(baseDir, { recursive: true });
    await writeFile(claudeMdPath, CLAUDE_MD_CONTENT);
  }
}

/**
 * Get the content for a project-specific Claude skill file.
 */
export function getProjectSkillContent(
  owner: string,
  number: number,
  name: string
): string {
  return `# ${owner}/${number} - ${name}

This directory is a gpfs-managed GitHub Project.

## Creating Issues

Create a new item by creating a markdown file:

\`\`\`markdown
---
title: My new issue
status: Todo
---

Description goes here.
\`\`\`

Run \`gpfs push ${owner}/${number}\` to sync to GitHub.

## Useful Commands

- \`gpfs pull ${owner}/${number}\` - Pull latest from GitHub
- \`gpfs push ${owner}/${number}\` - Push local changes
- \`gpfs status ${owner}/${number}\` - Check sync status

## File Format

- \`title\` (required) - Issue title
- \`status\` - Project status field (e.g., Todo, In Progress, Done)
- \`assignees\` - List of GitHub usernames
- \`labels\` - List of labels
- \`priority\`, \`due_date\`, etc. - Custom project fields
`;
}
