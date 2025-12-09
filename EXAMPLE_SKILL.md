# gpfs

Manage GitHub Projects via local markdown files using gpfs (gh-project-file-sync).

## Available Commands

### Project Management
- `gpfs create --owner <org-or-user> --name <name> --visibility <public|private>` - Create new project
- `gpfs attach <owner/project-number>` - Start tracking existing project
- `gpfs attach --interactive` - Interactively select project to track
- `gpfs detach <owner/project-number>` - Stop tracking project (keeps local files)
- `gpfs list` - List all tracked projects

### Sync Operations
- `gpfs pull` - Pull all tracked projects from GitHub
- `gpfs pull <owner/project-number>` - Pull specific project
- `gpfs push` - Push all local changes to GitHub
- `gpfs push <owner/project-number>` - Push specific project
- `gpfs status` - Show sync status for all projects
- `gpfs status <owner/project-number>` - Show sync status for specific project

### Query
- `gpfs query "<sql>"` - Query items using SQL (DuckDB)

Example queries:
```sh
gpfs query "SELECT title, status FROM items WHERE status = 'In Progress'"
gpfs query "SELECT * FROM items WHERE due_date < now() + interval '1 week'"
```

### Daemon (Background Sync)
- `gpfs daemon start` - Start background sync daemon
- `gpfs daemon start --foreground` - Run daemon in foreground
- `gpfs daemon start --poll-interval <seconds>` - Set GitHub poll interval (default: 300)
- `gpfs daemon start --debounce <seconds>` - Set local change debounce (default: 2)
- `gpfs daemon stop` - Stop daemon
- `gpfs daemon status` - Check daemon status

## File Format

Items are stored as markdown with YAML frontmatter in `~/.gpfs/<owner>/<project-number>-<project-name>/`:

```yaml
---
id: PVTI_xxx                    # Item ID (auto-generated)
project_id: PVT_xxx             # Project ID
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
```

## Workflow Examples

### Create and populate a new project
```sh
gpfs create --owner myorg --name "Q1 Roadmap" --visibility private
# Edit files in ~/.gpfs/myorg/1-q1-roadmap/
gpfs push myorg/1
```

### Track existing project and make changes
```sh
gpfs attach myorg/42
gpfs pull myorg/42
# Edit markdown files locally
gpfs push myorg/42
```

### Continuous sync while working
```sh
gpfs daemon start
# Make local edits - they sync automatically
gpfs daemon stop
```

## Environment Variables

- `GPFS_BASE_DIR` - Base directory (default: `~/.gpfs`)
- `GPFS_POLL_INTERVAL` - Daemon poll interval in seconds (default: 300)
- `GPFS_DEBOUNCE` - Daemon debounce delay in seconds (default: 2)

## Requirements

- `gh` CLI must be installed and authenticated (`gh auth login`)
- Bun runtime
