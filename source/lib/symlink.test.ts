import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readlink, lstat, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  createProjectSymlink,
  resolveGpfsSymlink,
  removeProjectSymlink,
  parseProjectPath,
} from "./symlink.js";

describe("symlink", () => {
  let testDir: string;
  let baseDir: string;

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = join(tmpdir(), `gpfs-symlink-test-${Date.now()}`);
    baseDir = join(testDir, ".gpfs");
    await mkdir(baseDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe("createProjectSymlink", () => {
    test("creates absolute symlink by default", async () => {
      const projectDir = join(baseDir, "myorg", "42-roadmap");
      await mkdir(projectDir, { recursive: true });

      const linkPath = join(testDir, "my-link");
      await createProjectSymlink(projectDir, linkPath, false);

      const stats = await lstat(linkPath);
      expect(stats.isSymbolicLink()).toBe(true);

      const target = await readlink(linkPath);
      expect(target).toBe(projectDir);
    });

    test("creates relative symlink when useRelative is true", async () => {
      const projectDir = join(baseDir, "myorg", "42-roadmap");
      await mkdir(projectDir, { recursive: true });

      const linkPath = join(testDir, "my-link");
      await createProjectSymlink(projectDir, linkPath, true);

      const stats = await lstat(linkPath);
      expect(stats.isSymbolicLink()).toBe(true);

      const target = await readlink(linkPath);
      // Should be relative path like ".gpfs/myorg/42-roadmap"
      expect(target).not.toMatch(/^\//);
      expect(target).toContain(".gpfs");
    });

    test("throws if link path already exists", async () => {
      const projectDir = join(baseDir, "myorg", "42-roadmap");
      await mkdir(projectDir, { recursive: true });

      const linkPath = join(testDir, "existing-file");
      await writeFile(linkPath, "test");

      expect(createProjectSymlink(projectDir, linkPath)).rejects.toThrow();
    });
  });

  describe("resolveGpfsSymlink", () => {
    test("returns resolved path for valid gpfs symlink", async () => {
      const projectDir = join(baseDir, "myorg", "42-roadmap");
      await mkdir(projectDir, { recursive: true });

      const linkPath = join(testDir, "my-link");
      await createProjectSymlink(projectDir, linkPath, false);

      const resolved = await resolveGpfsSymlink(linkPath, baseDir);
      expect(resolved).toBe(projectDir);
    });

    test("returns null for non-symlink", async () => {
      const filePath = join(testDir, "regular-file");
      await writeFile(filePath, "test");

      const resolved = await resolveGpfsSymlink(filePath, baseDir);
      expect(resolved).toBeNull();
    });

    test("returns null for directory", async () => {
      const dirPath = join(testDir, "regular-dir");
      await mkdir(dirPath);

      const resolved = await resolveGpfsSymlink(dirPath, baseDir);
      expect(resolved).toBeNull();
    });

    test("returns null for symlink outside baseDir", async () => {
      const outsideDir = join(testDir, "outside");
      await mkdir(outsideDir);

      const linkPath = join(testDir, "outside-link");
      await createProjectSymlink(outsideDir, linkPath, false);

      const resolved = await resolveGpfsSymlink(linkPath, baseDir);
      expect(resolved).toBeNull();
    });

    test("returns null for non-existent path", async () => {
      const resolved = await resolveGpfsSymlink(
        join(testDir, "does-not-exist"),
        baseDir
      );
      expect(resolved).toBeNull();
    });
  });

  describe("removeProjectSymlink", () => {
    test("removes valid gpfs symlink", async () => {
      const projectDir = join(baseDir, "myorg", "42-roadmap");
      await mkdir(projectDir, { recursive: true });

      const linkPath = join(testDir, "my-link");
      await createProjectSymlink(projectDir, linkPath, false);

      await removeProjectSymlink(linkPath, baseDir);

      // Verify symlink is gone
      await expect(lstat(linkPath)).rejects.toThrow();
    });

    test("throws for non-symlink", async () => {
      const filePath = join(testDir, "regular-file");
      await writeFile(filePath, "test");

      expect(removeProjectSymlink(filePath, baseDir)).rejects.toThrow(
        "is not a symlink to a gpfs project"
      );
    });

    test("throws for symlink outside baseDir", async () => {
      const outsideDir = join(testDir, "outside");
      await mkdir(outsideDir);

      const linkPath = join(testDir, "outside-link");
      await createProjectSymlink(outsideDir, linkPath, false);

      expect(removeProjectSymlink(linkPath, baseDir)).rejects.toThrow(
        "is not a symlink to a gpfs project"
      );
    });
  });

  describe("parseProjectPath", () => {
    test("parses valid project path", () => {
      const projectPath = join(baseDir, "myorg", "42-roadmap");
      const result = parseProjectPath(projectPath, baseDir);

      expect(result).toEqual({
        owner: "myorg",
        number: 42,
        name: "roadmap",
      });
    });

    test("parses project with hyphenated name", () => {
      const projectPath = join(baseDir, "myorg", "123-my-cool-project");
      const result = parseProjectPath(projectPath, baseDir);

      expect(result).toEqual({
        owner: "myorg",
        number: 123,
        name: "my-cool-project",
      });
    });

    test("returns null for path outside baseDir", () => {
      const projectPath = join(testDir, "outside", "42-roadmap");
      const result = parseProjectPath(projectPath, baseDir);

      expect(result).toBeNull();
    });

    test("returns null for invalid directory structure (too shallow)", () => {
      const projectPath = join(baseDir, "42-roadmap");
      const result = parseProjectPath(projectPath, baseDir);

      expect(result).toBeNull();
    });

    test("returns null for invalid directory structure (too deep)", () => {
      const projectPath = join(baseDir, "myorg", "nested", "42-roadmap");
      const result = parseProjectPath(projectPath, baseDir);

      expect(result).toBeNull();
    });

    test("returns null for invalid project format (no number prefix)", () => {
      const projectPath = join(baseDir, "myorg", "roadmap");
      const result = parseProjectPath(projectPath, baseDir);

      expect(result).toBeNull();
    });

    test("returns null for invalid project format (no hyphen)", () => {
      const projectPath = join(baseDir, "myorg", "42roadmap");
      const result = parseProjectPath(projectPath, baseDir);

      expect(result).toBeNull();
    });
  });
});
