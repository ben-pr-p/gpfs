# gh-project-file-sync (gpfs) Specification

A CLI tool for bidirectional sync between GitHub Projects and the local filesystem.

## Overview

`gpfs` syncs GitHub Project items to local markdown files with frontmatter metadata. It supports manual push/pull operations and an automatic daemon for continuous sync.

## Commands

### `gpfs create`

Create a new GitHub Project and start tracking it.

**Required flags:**
- `--owner <org-or-user>` - Organization or user that owns the project
- `--name <project-name>` - Name for the new project
- `--visibility <public|private>` - Project visibility

**Example:**
```sh
gpfs create --owner myorg --name "Q1 Roadmap" --visibility private
```

### `gpfs attach`

Start tracking an existing GitHub Project.

**Arguments:**
- `<owner/project-number>` - Project identifier (e.g., `myorg/42`)

**Flags:**
- `--interactive` - Interactively select from available projects

**Example:**
```sh
gpfs attach myorg/42
gpfs attach --interactive
```

### `gpfs detach`

Stop tracking a project. Local files are preserved.

**Arguments:**
- `<owner/project-number>` - Project identifier

**Example:**
```sh
gpfs detach myorg/42
```

### `gpfs pull`

Pull changes from GitHub to local filesystem.

**Arguments:**
- `[owner/project-number]` - Optional. If omitted, pulls all tracked projects.

**Behavior:**
- Downloads all project items as markdown files
- Updates existing files with remote changes
- Creates new files for new items
- Sets `deleted: true` in frontmatter for items deleted on GitHub (does not delete local files)

**Example:**
```sh
gpfs pull              # Pull all tracked projects
gpfs pull myorg/42     # Pull specific project
```

### `gpfs push`

Push local changes to GitHub.

**Arguments:**
- `[owner/project-number]` - Optional. If omitted, pushes all tracked projects.

**Behavior:**
- Uploads changes from local markdown files to GitHub
- Creates new items for new files
- Updates existing items with local changes
- Deletes items on GitHub when local files are deleted
- Stops on first error

**Example:**
```sh
gpfs push              # Push all tracked projects
gpfs push myorg/42     # Push specific project
```

### `gpfs list`

List all tracked projects.

**Output:**
- Project owner and number
- Project name
- Local directory path
- Item count

### `gpfs status`

Show sync status for tracked projects.

**Arguments:**
- `[owner/project-number]` - Optional. If omitted, shows status for all tracked projects.

**Output:**
- Modified local files (pending push)
- Remote changes available (pending pull)
- Conflicts (if any)

### `gpfs query`

Query items across projects using SQL via DuckDB.

**Arguments:**
- `<sql>` - SQL query against the `items` view

**Behavior:**
- Installs DuckDB markdown extension on-demand if not present
- Exposes an `items` view with all local markdown files

**Available columns:**
- `project_id` - GitHub Project node ID
- `project_name` - Project name
- `project_owner` - Organization or user
- `file_path` - Local file path
- `id` - Item node ID
- `title` - Item title
- `body` - Markdown body content
- `status` - Status field value
- `deleted` - Boolean, true if deleted on GitHub
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp
- All custom fields flattened as columns

**Example:**
```sh
gpfs query "SELECT title, status FROM items WHERE project_name = 'Roadmap' AND status = 'In Progress'"
gpfs query "SELECT * FROM items WHERE due_date < now() + interval '1 week'"
```

### `gpfs daemon`

Manage the background sync daemon.

**Subcommands:**
- `gpfs daemon start` - Start the daemon (runs in background by default)
- `gpfs daemon stop` - Stop the daemon
- `gpfs daemon status` - Show daemon status

**Flags for `start`:**
- `--foreground` - Run in foreground instead of background
- `--poll-interval <seconds>` - GitHub polling interval (default: 300, i.e., 5 minutes)
- `--debounce <seconds>` - Debounce delay for local changes (default: 2)

**Behavior:**
- Watches local files using filesystem events (cross-platform via Bun)
- Debounces rapid local changes before syncing
- Periodically polls GitHub for remote changes
- Logs to `~/.gpfs/daemon.log`
- Uses last-write-wins for conflict resolution

**Example:**
```sh
gpfs daemon start
gpfs daemon start --poll-interval 600 --debounce 5
gpfs daemon status
gpfs daemon stop
```

## File Format

Project items are stored as markdown files with YAML frontmatter.

### Directory Structure

```
~/.gpfs/                          # Default base directory (configurable via --base-dir or GPFS_BASE_DIR)
├── daemon.log                    # Daemon log file
└── <owner>/
    └── <project-number>-<project-name>/   # e.g., 42-q1-roadmap
        ├── fix-login-bug.md
        ├── add-dark-mode.md
        └── bug-fix.md
```

Tracked projects are inferred from the directory structure. The folder name encodes:
- Project number (digits before first `-`)
- Project name (sanitized, for human readability)

### File Naming

- Derived from item title
- Sanitized for filesystem safety (replace `/\:*?"<>|` with `-`)
- Truncated to 100 characters
- Collisions resolved with counter suffix (`bug-fix.md`, `bug-fix-2.md`, `bug-fix-3.md`)

### Frontmatter Schema

```yaml
---
# GitHub identifiers
id: PVTI_lADOBCxyz123              # Project item node ID
project_id: PVT_kwDOABC123         # Project node ID
project_owner: myorg
project_number: 42

# Item fields
title: Fix login bug
status: In Progress
assignees:
  - octocat
  - janedoe
labels:
  - bug
  - priority-high

# For linked issues/PRs
linked_issue: https://github.com/myorg/repo/issues/99
linked_pr: null

# Custom fields (varies per project)
priority: High
sprint: Sprint 3
due_date: 2025-02-01
estimate: 5

# Sync metadata (internal, stripped on push)
_sync:
  remote_updated_at: 2025-01-15T10:30:00Z
  local_checksum: a1b2c3d4e5f6

# Deletion marker
deleted: false
---

The item body content goes here. For linked issues/PRs, this is the issue/PR description.

Supports full **markdown** formatting.
```

## Configuration

Configuration is via command-line flags and environment variables. No config file.

| Setting | Flag | Environment Variable | Default |
|---------|------|---------------------|---------|
| Base directory | `--base-dir` | `GPFS_BASE_DIR` | `~/.gpfs` |
| Poll interval | `--poll-interval` | `GPFS_POLL_INTERVAL` | `300` (seconds) |
| Debounce delay | `--debounce` | `GPFS_DEBOUNCE` | `2` (seconds) |

## Dependencies

- **gh CLI** - Must be installed and authenticated (`gh auth login`)
- **Bun** - Runtime environment
- **DuckDB** - Installed on-demand for query command (markdown extension)

## Error Handling

- If `gh` CLI is not installed or not authenticated, display clear error message with instructions
- Push/pull operations stop on first error
- Daemon logs errors to `~/.gpfs/daemon.log` and continues operating

## Sync Behavior

### Pull
1. Fetch all items from GitHub Project via `gh` CLI
2. For each remote item:
   - If local file exists: update frontmatter and body if remote is newer
   - If local file doesn't exist: create new file
   - If item deleted on GitHub: set `deleted: true` in frontmatter
3. Update `_sync.remote_updated_at` and `_sync.local_checksum`

### Push
1. Read all local markdown files for project
2. For each local file:
   - If `_sync.local_checksum` differs from current content: push to GitHub
   - If file is new (no `id` in frontmatter): create item on GitHub
3. For deleted local files (tracked in previous sync but now missing): delete from GitHub
4. Update `_sync` metadata after successful push

### Daemon Sync
1. Watch filesystem for changes using Bun's cross-platform file watcher
2. On local change: add to work queue, debounce for 2 seconds
3. After debounce: push changed files
4. Every poll interval (default 5 minutes): pull all tracked projects
5. Conflict resolution: last write wins

## Future Considerations (Deferred)

- Conflict resolution strategies beyond last-write-wins
- Comment syncing for linked issues/PRs
- Config file support
- Filtering/views (sync subset of project items)
- Multiple GitHub account support
