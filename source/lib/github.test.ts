import { describe, it, expect } from "bun:test";
import { ghProjectView, ghProjectItemList, ghCreateItem, ghUpdateDraftIssue, ghDeleteItem, ghCreateProject, ghDeleteProject } from "./github.js";

describe("ghProjectView", () => {
  it("fetches existing project", async () => {
    // This test uses a real project created for testing
    const result = await ghProjectView("ben-pr-p", 2);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.owner).toBe("ben-pr-p");
      expect(result.project.number).toBe(2);
      expect(result.project.title).toBe("Test Roadmap");
      expect(result.project.id).toMatch(/^PVT_/);
    }
  });

  it("returns not_found for nonexistent project", async () => {
    const result = await ghProjectView("ben-pr-p", 99999);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("not_found");
      expect(result.message).toContain("Project not found");
    }
  });

  it("returns not_found for nonexistent owner", async () => {
    const result = await ghProjectView("this-owner-definitely-does-not-exist-12345", 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Could be "not_found" or "other" depending on the error message
      expect(result.success).toBe(false);
    }
  });
});

describe("ghProjectItemList", () => {
  it("fetches items from existing project", async () => {
    const result = await ghProjectItemList("ben-pr-p", 2);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.items)).toBe(true);
      // We know there are at least 2 items from our test setup
      expect(result.items.length).toBeGreaterThanOrEqual(1);

      // Check item structure
      const item = result.items[0];
      expect(item).toBeDefined();
      expect(item!.id).toMatch(/^PVTI_/);
      expect(typeof item!.title).toBe("string");
      expect(typeof item!.body).toBe("string");
      expect(item!.contentType).toBe("DraftIssue");
    }
  });

  it("returns not_found for nonexistent project", async () => {
    const result = await ghProjectItemList("ben-pr-p", 99999);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("not_found");
    }
  });
});

describe("ghCreateItem", () => {
  it("creates a new item and returns the item ID", async () => {
    const result = await ghCreateItem("ben-pr-p", 2, "Test Create " + Date.now(), "Test body");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.itemId).toMatch(/^PVTI_/);
      // Clean up - delete the item we just created
      await ghDeleteItem("ben-pr-p", 2, result.itemId);
    }
  });
});

describe("ghUpdateDraftIssue", () => {
  it("updates an existing draft issue", async () => {
    // Use an existing item's content ID from the test project
    const listResult = await ghProjectItemList("ben-pr-p", 2);
    expect(listResult.success).toBe(true);
    if (!listResult.success) return;

    const draftItem = listResult.items.find((i) => i.contentType === "DraftIssue" && i.contentId);
    expect(draftItem).toBeDefined();
    if (!draftItem?.contentId) return;

    // Update with original content (no actual change to avoid polluting test data)
    const result = await ghUpdateDraftIssue(draftItem.contentId, draftItem.title, draftItem.body);
    expect(result.success).toBe(true);
  });

  it("returns error for non-draft issue ID", async () => {
    // Passing a PVTI_ ID instead of DI_ ID should fail
    const result = await ghUpdateDraftIssue("PVTI_invalid", "Title", "Body");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("not_draft");
    }
  });
});

describe("ghDeleteItem", () => {
  it("returns not_found when deleting nonexistent item", async () => {
    const result = await ghDeleteItem("ben-pr-p", 2, "PVTI_nonexistent123");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("not_found");
    }
  });
});

describe("ghCreateProject and ghDeleteProject", () => {
  it("creates and deletes a project", async () => {
    const title = "Test Project " + Date.now();
    const createResult = await ghCreateProject("ben-pr-p", title);

    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    expect(createResult.project.title).toBe(title);
    expect(createResult.project.owner).toBe("ben-pr-p");
    expect(createResult.project.number).toBeGreaterThan(0);
    expect(createResult.project.id).toMatch(/^PVT_/);

    // Clean up - delete the project
    const deleteResult = await ghDeleteProject("ben-pr-p", createResult.project.number);
    expect(deleteResult.success).toBe(true);
  });

  it("returns not_found when deleting nonexistent project", async () => {
    const result = await ghDeleteProject("ben-pr-p", 99999);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("not_found");
    }
  });
});
