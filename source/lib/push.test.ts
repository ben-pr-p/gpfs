import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { ghProjectItemList, ghDeleteItem } from "./github.js";
import { parseMarkdownString } from "./markdown.js";

// Test project: ben-pr-p/2 (Test Roadmap)
const TEST_OWNER = "ben-pr-p";
const TEST_PROJECT_NUMBER = 2;
const TEST_PROJECT_ID = "PVT_kwHOAJ2Lvs4BKJiw";

describe("push command - create new item", () => {
  let testDir: string;
  let createdItemIds: string[] = [];

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(process.cwd(), ".test-push-" + Date.now());
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up created items on GitHub
    for (const itemId of createdItemIds) {
      try {
        await ghDeleteItem(TEST_OWNER, TEST_PROJECT_NUMBER, itemId);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdItemIds = [];

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("creates a new item from a local file without an id", async () => {
    // Create a local markdown file without an id
    const filename = "new-test-item.md";
    const filePath = join(testDir, filename);
    const title = "Test Create from Push " + Date.now();
    const body = "This is the body of a new item created via push.";

    const content = `---
title: ${title}
status: Todo
---

${body}`;

    await writeFile(filePath, content);

    // Import and run the pushProject function
    // We need to set up the project structure first
    const projectDir = join(testDir, TEST_OWNER, `${TEST_PROJECT_NUMBER}-test-roadmap`);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, filename), content);

    // Run the CLI push command
    const proc = Bun.spawn(["bun", "run", "source/cli.tsx", "push", `${TEST_OWNER}/${TEST_PROJECT_NUMBER}`, "--base-dir", testDir], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: process.cwd(),
    });

    await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    // Check the output shows 1 created
    expect(stdout).toContain("1 created");

    // Verify the local file was updated with the new id
    const updatedContent = await readFile(join(projectDir, filename), "utf-8");
    const parsed = parseMarkdownString(updatedContent);
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.id).toMatch(/^PVTI_/);
    expect(parsed!.frontmatter.project_id).toBe(TEST_PROJECT_ID);

    // Track for cleanup using the ID from the local file
    const newItemId = parsed!.frontmatter.id as string;
    createdItemIds.push(newItemId);

    // Verify the item exists on GitHub (may need a delay for propagation)
    await new Promise(resolve => setTimeout(resolve, 2000));
    const listResult = await ghProjectItemList(TEST_OWNER, TEST_PROJECT_NUMBER);
    expect(listResult.success).toBe(true);
    if (!listResult.success) return;

    const createdItem = listResult.items.find((i) => i.id === newItemId);
    expect(createdItem).toBeDefined();
    expect(createdItem!.title).toBe(title);
    expect(createdItem!.body).toBe(body);
  });

  it("does not create item when id starts with PVTI_ but item is missing remotely", async () => {
    // Create a local file with a PVTI_ id that doesn't exist remotely
    const filename = "orphaned-item.md";
    const projectDir = join(testDir, TEST_OWNER, `${TEST_PROJECT_NUMBER}-test-roadmap`);
    await mkdir(projectDir, { recursive: true });

    const content = `---
id: PVTI_nonexistent12345
title: Orphaned Item
status: Todo
---

This item was deleted on GitHub.`;

    await writeFile(join(projectDir, filename), content);

    // Run the CLI push command
    const proc = Bun.spawn(["bun", "run", "source/cli.tsx", "push", `${TEST_OWNER}/${TEST_PROJECT_NUMBER}`, "--base-dir", testDir], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: process.cwd(),
    });

    await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    // Should count as unchanged (skipped), not created
    expect(stdout).toContain("0 created");
    expect(stdout).toContain("1 unchanged");
  });

  it("creates item using filename as title if no title in frontmatter", async () => {
    const filename = "item-without-title.md";
    const projectDir = join(testDir, TEST_OWNER, `${TEST_PROJECT_NUMBER}-test-roadmap`);
    await mkdir(projectDir, { recursive: true });

    const body = "Body without a title in frontmatter " + Date.now();
    const content = `---
status: Todo
---

${body}`;

    await writeFile(join(projectDir, filename), content);

    // Run the CLI push command
    const proc = Bun.spawn(["bun", "run", "source/cli.tsx", "push", `${TEST_OWNER}/${TEST_PROJECT_NUMBER}`, "--base-dir", testDir], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: process.cwd(),
    });

    await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(stdout).toContain("1 created");

    // Verify the local file was updated with the new id
    const updatedContent = await readFile(join(projectDir, filename), "utf-8");
    const parsed = parseMarkdownString(updatedContent);
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.id).toMatch(/^PVTI_/);

    // Track for cleanup
    const newItemId = parsed!.frontmatter.id as string;
    createdItemIds.push(newItemId);

    // Verify on GitHub after a small delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    const listResult = await ghProjectItemList(TEST_OWNER, TEST_PROJECT_NUMBER);
    expect(listResult.success).toBe(true);
    if (!listResult.success) return;

    // Title should be derived from filename (without .md)
    const createdItem = listResult.items.find((i) => i.id === newItemId);
    expect(createdItem).toBeDefined();
    expect(createdItem!.title).toBe("item-without-title");
  });
});
