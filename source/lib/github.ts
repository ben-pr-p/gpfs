/**
 * GitHub CLI wrappers for project operations.
 */

import { spawn } from "child_process";

/**
 * Helper to run a command and capture stdout/stderr.
 */
function runCommand(
  command: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export type GhGetLoggedInUserResult =
  | { success: true; login: string }
  | { success: false; error: "not_logged_in" | "other"; message: string };

/**
 * Get the currently logged-in GitHub user.
 */
export async function ghGetLoggedInUser(): Promise<GhGetLoggedInUserResult> {
  const { exitCode, stdout, stderr } = await runCommand("gh", ["api", "user", "--jq", ".login"]);

  if (exitCode !== 0) {
    if (stderr.includes("not logged in") || stderr.includes("auth login")) {
      return {
        success: false,
        error: "not_logged_in",
        message: "Not logged in to GitHub CLI. Run: gh auth login",
      };
    }
    return {
      success: false,
      error: "other",
      message: `Failed to get logged-in user: ${stderr.trim()}`,
    };
  }

  return { success: true, login: stdout.trim() };
}

export type ProjectInfo = {
  id: string;
  number: number;
  title: string;
  owner: string;
};

export type ProjectItem = {
  id: string;
  title: string;
  body: string;
  status: string | null;
  contentType: "DraftIssue" | "Issue" | "PullRequest";
  contentId: string | null;
};

export type GhProjectViewResult =
  | { success: true; project: ProjectInfo }
  | { success: false; error: "not_found" | "missing_scope" | "other"; message: string };

/**
 * Fetch project information using `gh project view`.
 */
export async function ghProjectView(
  owner: string,
  number: number
): Promise<GhProjectViewResult> {
  const { exitCode, stdout, stderr } = await runCommand("gh", [
    "project", "view", String(number), "--owner", owner, "--format", "json"
  ]);

  if (exitCode !== 0) {
    if (stderr.includes("Could not resolve to a ProjectV2")) {
      return {
        success: false,
        error: "not_found",
        message: `Project not found: ${owner}/${number}`,
      };
    }
    if (stderr.includes("missing required scopes")) {
      return {
        success: false,
        error: "missing_scope",
        message: `GitHub CLI missing project scope. Run: gh auth refresh -s project`,
      };
    }
    return {
      success: false,
      error: "other",
      message: `Failed to fetch project: ${stderr.trim()}`,
    };
  }

  const data = JSON.parse(stdout);

  return {
    success: true,
    project: {
      id: data.id,
      number: data.number,
      title: data.title,
      owner: data.owner.login,
    },
  };
}

export type GhProjectItemListResult =
  | { success: true; items: ProjectItem[] }
  | { success: false; error: "not_found" | "missing_scope" | "other"; message: string };

/**
 * Fetch all items from a project using `gh project item-list`.
 */
export async function ghProjectItemList(
  owner: string,
  number: number
): Promise<GhProjectItemListResult> {
  const { exitCode, stdout, stderr } = await runCommand("gh", [
    "project", "item-list", String(number), "--owner", owner, "--format", "json", "--limit", "1000"
  ]);

  if (exitCode !== 0) {
    if (stderr.includes("Could not resolve to a ProjectV2")) {
      return {
        success: false,
        error: "not_found",
        message: `Project not found: ${owner}/${number}`,
      };
    }
    if (stderr.includes("missing required scopes")) {
      return {
        success: false,
        error: "missing_scope",
        message: `GitHub CLI missing project scope. Run: gh auth refresh -s project`,
      };
    }
    return {
      success: false,
      error: "other",
      message: `Failed to fetch items: ${stderr.trim()}`,
    };
  }

  const data = JSON.parse(stdout);

  const items: ProjectItem[] = data.items.map((item: Record<string, unknown>) => ({
    id: item.id as string,
    title: item.title as string,
    body: (item.content as Record<string, unknown>)?.body as string || "",
    status: item.status as string | null,
    contentType: (item.content as Record<string, unknown>)?.type as "DraftIssue" | "Issue" | "PullRequest",
    contentId: (item.content as Record<string, unknown>)?.id as string | null,
  }));

  return { success: true, items };
}

export type GhCreateItemResult =
  | { success: true; itemId: string; contentId: string }
  | { success: false; error: "missing_scope" | "other"; message: string };

/**
 * Create a new draft issue in a project.
 */
export async function ghCreateItem(
  owner: string,
  projectNumber: number,
  title: string,
  body: string
): Promise<GhCreateItemResult> {
  const { exitCode, stdout, stderr } = await runCommand("gh", [
    "project", "item-create", String(projectNumber), "--owner", owner, "--title", title, "--body", body, "--format", "json"
  ]);

  if (exitCode !== 0) {
    if (stderr.includes("missing required scopes")) {
      return {
        success: false,
        error: "missing_scope",
        message: `GitHub CLI missing project scope. Run: gh auth refresh -s project`,
      };
    }
    return { success: false, error: "other", message: stderr.trim() };
  }

  const data = JSON.parse(stdout);

  // item-create returns itemId but we need contentId from item-list
  // For now return empty contentId, caller can refetch if needed
  return { success: true, itemId: data.id, contentId: "" };
}

export type GhUpdateDraftIssueResult =
  | { success: true }
  | { success: false; error: "not_draft" | "other"; message: string };

/**
 * Update a draft issue's title and body.
 * Note: Requires the draft issue content ID (DI_...), not the item ID (PVTI_...).
 */
export async function ghUpdateDraftIssue(
  contentId: string,
  title: string,
  body: string
): Promise<GhUpdateDraftIssueResult> {
  const { exitCode, stderr } = await runCommand("gh", [
    "project", "item-edit", "--id", contentId, "--title", title, "--body", body, "--format", "json"
  ]);

  if (exitCode !== 0) {
    if (stderr.includes("ID must be the ID of the draft issue")) {
      return {
        success: false,
        error: "not_draft",
        message: "Can only edit draft issues. For Issues/PRs, use gh issue edit or gh pr edit.",
      };
    }
    return { success: false, error: "other", message: stderr.trim() };
  }

  return { success: true };
}

export type GhCreateProjectResult =
  | { success: true; project: ProjectInfo }
  | { success: false; error: "missing_scope" | "other"; message: string };

/**
 * Create a new project using `gh project create`.
 */
export async function ghCreateProject(
  owner: string,
  title: string
): Promise<GhCreateProjectResult> {
  const { exitCode, stdout, stderr } = await runCommand("gh", [
    "project", "create", "--owner", owner, "--title", title, "--format", "json"
  ]);

  if (exitCode !== 0) {
    if (stderr.includes("missing required scopes")) {
      return {
        success: false,
        error: "missing_scope",
        message: `GitHub CLI missing project scope. Run: gh auth refresh -s project`,
      };
    }
    return { success: false, error: "other", message: stderr.trim() };
  }

  const data = JSON.parse(stdout);

  return {
    success: true,
    project: {
      id: data.id,
      number: data.number,
      title: data.title,
      owner: data.owner.login,
    },
  };
}

export type GhDeleteProjectResult =
  | { success: true }
  | { success: false; error: "not_found" | "other"; message: string };

/**
 * Delete a project using `gh project delete`.
 */
export async function ghDeleteProject(
  owner: string,
  number: number
): Promise<GhDeleteProjectResult> {
  const { exitCode, stderr } = await runCommand("gh", [
    "project", "delete", String(number), "--owner", owner, "--format", "json"
  ]);

  if (exitCode !== 0) {
    if (stderr.includes("Could not resolve")) {
      return {
        success: false,
        error: "not_found",
        message: `Project not found: ${owner}/${number}`,
      };
    }
    return { success: false, error: "other", message: stderr.trim() };
  }

  return { success: true };
}

export type GhProjectListResult =
  | { success: true; projects: ProjectInfo[] }
  | { success: false; error: "missing_scope" | "other"; message: string };

/**
 * List all projects for an owner using `gh project list`.
 */
export async function ghProjectList(
  owner: string
): Promise<GhProjectListResult> {
  const { exitCode, stdout, stderr } = await runCommand("gh", [
    "project", "list", "--owner", owner, "--format", "json", "--limit", "100"
  ]);

  if (exitCode !== 0) {
    if (stderr.includes("missing required scopes")) {
      return {
        success: false,
        error: "missing_scope",
        message: `GitHub CLI missing project scope. Run: gh auth refresh -s project`,
      };
    }
    return {
      success: false,
      error: "other",
      message: `Failed to list projects: ${stderr.trim()}`,
    };
  }

  const data = JSON.parse(stdout);

  const projects: ProjectInfo[] = data.projects.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    number: p.number as number,
    title: p.title as string,
    owner: owner,
  }));

  return { success: true, projects };
}

export type GhDeleteItemResult =
  | { success: true }
  | { success: false; error: "not_found" | "other"; message: string };

/**
 * Delete an item from a project.
 */
export async function ghDeleteItem(
  owner: string,
  projectNumber: number,
  itemId: string
): Promise<GhDeleteItemResult> {
  const { exitCode, stderr } = await runCommand("gh", [
    "project", "item-delete", String(projectNumber), "--owner", owner, "--id", itemId, "--format", "json"
  ]);

  if (exitCode !== 0) {
    if (stderr.includes("Could not resolve")) {
      return {
        success: false,
        error: "not_found",
        message: `Item not found: ${itemId}`,
      };
    }
    return { success: false, error: "other", message: stderr.trim() };
  }

  return { success: true };
}
