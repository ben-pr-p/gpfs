# Implementation Plan

## General Protocol

1. Implement full commands first to discover the right shape for utilities
2. Once a utility's interface is clear, extract it to a utility file
3. Write unit tests for extracted utilities

## Phase 1: `gpfs list` Command

**Goal:** Display all tracked projects by scanning directory structure.

### Steps:
1. Create `source/commands/list.tsx`
2. Implement directory scanning logic inline:
   - Read `~/.gpfs/` (or `GPFS_BASE_DIR`)
   - Find `<owner>/<project-number>-<name>/` directories
   - Parse project number from folder name
   - Count `.md` files in each project directory
3. Display results in a table format
4. Extract utilities:
   - `getBaseDir()` - resolve base directory from flag/env/default
   - `getTrackedProjects()` - scan and return project metadata
5. Write tests for extracted utilities

### Outputs:
- `source/commands/list.tsx`
- `source/lib/config.ts` (getBaseDir)
- `source/lib/projects.ts` (getTrackedProjects)
- `source/lib/config.test.ts`
- `source/lib/projects.test.ts`

---

## Phase 2: `gpfs attach` Command

**Goal:** Start tracking an existing GitHub Project.

### Steps:
1. Create `source/commands/attach.tsx`
2. Implement inline:
   - Parse `<owner/project-number>` argument
   - Call `gh project view` to fetch project metadata (name, id)
   - Create directory `<base>/<owner>/<number>-<sanitized-name>/`
   - Optionally: `--interactive` mode to list and select projects
3. Extract utilities:
   - `parseProjectIdentifier(str)` - parse "owner/number" format
   - `sanitizeForFilesystem(str)` - safe filename conversion
   - `ghProjectView(owner, number)` - wrapper for gh CLI
4. Write tests

### Outputs:
- `source/commands/attach.tsx`
- `source/lib/github.ts` (gh CLI wrappers)
- `source/lib/filesystem.ts` (sanitization, path helpers)
- Tests for new utilities

---

## Phase 3: `gpfs detach` Command

**Goal:** Stop tracking a project (preserve local files).

### Steps:
1. Create `source/commands/detach.tsx`
2. Implement: remove project directory from tracking (or just confirm it exists)
3. Note: Since tracking is inferred from directory structure, "detach" may just mean deleting the directory or moving it elsewhere. Clarify behavior.

### Outputs:
- `source/commands/detach.tsx`

---

## Phase 4: `gpfs pull` Command

**Goal:** Pull changes from GitHub to local filesystem.

### Steps:
1. Create `source/commands/pull.tsx`
2. Implement inline:
   - Fetch all items from GitHub Project via `gh project item-list`
   - For each item, fetch full details
   - Generate markdown with YAML frontmatter
   - Write to files (handle naming, collisions)
   - Update `_sync` metadata
3. Extract utilities:
   - `serializeItemToMarkdown(item)` - create markdown with frontmatter
   - `parseMarkdownFile(path)` - read and parse frontmatter + body
   - `generateFilename(title, existingFiles)` - handle collisions
   - `computeChecksum(content)` - for `_sync.local_checksum`
4. Write tests

### Outputs:
- `source/commands/pull.tsx`
- `source/lib/markdown.ts` (serialize/parse)
- `source/lib/checksum.ts`
- Tests

---

## Phase 5: `gpfs push` Command

**Goal:** Push local changes to GitHub.

### Steps:
1. Create `source/commands/push.tsx`
2. Implement inline:
   - Read all local markdown files for project
   - Compare checksums to detect changes
   - Create/update/delete items on GitHub
   - Update `_sync` metadata
3. Extract utilities:
   - `ghCreateItem()`, `ghUpdateItem()`, `ghDeleteItem()` - gh CLI wrappers
4. Write tests

### Outputs:
- `source/commands/push.tsx`
- Updates to `source/lib/github.ts`
- Tests

---

## Phase 6: `gpfs status` Command

**Goal:** Show sync status for tracked projects.

### Steps:
1. Create `source/commands/status.tsx`
2. Implement:
   - Compare local checksums with `_sync.local_checksum`
   - Optionally fetch remote to detect pending pulls
   - Display modified/new/deleted files

### Outputs:
- `source/commands/status.tsx`

---

## Phase 7: `gpfs create` Command

**Goal:** Create a new GitHub Project and start tracking it.

### Steps:
1. Create `source/commands/create.tsx`
2. Implement:
   - Call `gh project create`
   - Then run attach logic

### Outputs:
- `source/commands/create.tsx`

---

## Phase 8: `gpfs daemon` Command

**Goal:** Background sync daemon with file watching and polling.

### Steps:
1. Create `source/commands/daemon/start.tsx`
2. Create `source/commands/daemon/stop.tsx`
3. Create `source/commands/daemon/status.tsx`
4. Implement:
   - File watching with Bun
   - Debouncing logic
   - Polling loop
   - PID file management
   - Logging to `~/.gpfs/daemon.log`

### Outputs:
- `source/commands/daemon/start.tsx`
- `source/commands/daemon/stop.tsx`
- `source/commands/daemon/status.tsx`
- `source/lib/daemon.ts`

---

## Phase 9: `gpfs query` Command

**Goal:** SQL queries via DuckDB.

### Steps:
1. Create `source/commands/query.tsx`
2. Implement:
   - Install DuckDB markdown extension on-demand
   - Build `items` view from local files
   - Execute SQL query
   - Display results

### Outputs:
- `source/commands/query.tsx`
- `source/lib/duckdb.ts`

---

## Utility Files Summary

After all phases, expected utility structure:

```
source/lib/
├── config.ts          # getBaseDir, env var handling
├── projects.ts        # getTrackedProjects, project discovery
├── github.ts          # gh CLI wrappers
├── filesystem.ts      # sanitization, path helpers
├── markdown.ts        # frontmatter parsing/serialization
├── checksum.ts        # content checksumming
├── daemon.ts          # daemon management utilities
└── duckdb.ts          # DuckDB integration
```
