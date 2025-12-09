import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getTrackedProjects } from "./projects.js";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("getTrackedProjects", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "gpfs-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns empty array when base dir does not exist", async () => {
    const result = await getTrackedProjects("/nonexistent/path");
    expect(result).toEqual([]);
  });

  it("returns empty array when base dir is empty", async () => {
    const result = await getTrackedProjects(testDir);
    expect(result).toEqual([]);
  });

  it("discovers projects in owner directories", async () => {
    // Create: testDir/myorg/42-roadmap/item.md
    const projectPath = join(testDir, "myorg", "42-roadmap");
    await mkdir(projectPath, { recursive: true });
    await writeFile(join(projectPath, "item.md"), "test");

    const result = await getTrackedProjects(testDir);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      owner: "myorg",
      number: 42,
      name: "roadmap",
      path: projectPath,
      itemCount: 1,
    });
  });

  it("counts only .md files", async () => {
    const projectPath = join(testDir, "org", "1-test");
    await mkdir(projectPath, { recursive: true });
    await writeFile(join(projectPath, "item1.md"), "test");
    await writeFile(join(projectPath, "item2.md"), "test");
    await writeFile(join(projectPath, "readme.txt"), "test");
    await writeFile(join(projectPath, "notes"), "test");

    const result = await getTrackedProjects(testDir);

    expect(result).toHaveLength(1);
    expect(result[0]!.itemCount).toBe(2);
  });

  it("ignores directories that don't match pattern", async () => {
    // Valid project
    const validPath = join(testDir, "org", "42-valid");
    await mkdir(validPath, { recursive: true });

    // Invalid patterns
    await mkdir(join(testDir, "org", "not-a-project"), { recursive: true });
    await mkdir(join(testDir, "org", "-no-number"), { recursive: true });
    await mkdir(join(testDir, "org", "123"), { recursive: true }); // no name after dash

    const result = await getTrackedProjects(testDir);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("valid");
  });

  it("sorts by owner then project number", async () => {
    await mkdir(join(testDir, "zebra", "1-first"), { recursive: true });
    await mkdir(join(testDir, "alpha", "10-ten"), { recursive: true });
    await mkdir(join(testDir, "alpha", "2-two"), { recursive: true });
    await mkdir(join(testDir, "alpha", "100-hundred"), { recursive: true });

    const result = await getTrackedProjects(testDir);

    expect(result.map((p) => `${p.owner}/${p.number}`)).toEqual([
      "alpha/2",
      "alpha/10",
      "alpha/100",
      "zebra/1",
    ]);
  });

  it("ignores files in base directory", async () => {
    await writeFile(join(testDir, "daemon.log"), "log data");
    await mkdir(join(testDir, "org", "1-project"), { recursive: true });

    const result = await getTrackedProjects(testDir);

    expect(result).toHaveLength(1);
    expect(result[0]!.owner).toBe("org");
  });

  it("handles project names with multiple dashes", async () => {
    const projectPath = join(testDir, "org", "42-my-cool-project");
    await mkdir(projectPath, { recursive: true });

    const result = await getTrackedProjects(testDir);

    expect(result).toHaveLength(1);
    expect(result[0]!.number).toBe(42);
    expect(result[0]!.name).toBe("my-cool-project");
  });
});
