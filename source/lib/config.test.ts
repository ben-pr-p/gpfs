import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getBaseDir } from "./config.js";
import { homedir } from "os";
import { join } from "path";

describe("getBaseDir", () => {
  const originalEnv = process.env.GPFS_BASE_DIR;

  beforeEach(() => {
    delete process.env.GPFS_BASE_DIR;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GPFS_BASE_DIR = originalEnv;
    } else {
      delete process.env.GPFS_BASE_DIR;
    }
  });

  it("returns explicit argument when provided", () => {
    process.env.GPFS_BASE_DIR = "/env/path";
    const result = getBaseDir("/explicit/path");
    expect(result).toBe("/explicit/path");
  });

  it("returns env var when no explicit argument", () => {
    process.env.GPFS_BASE_DIR = "/env/path";
    const result = getBaseDir();
    expect(result).toBe("/env/path");
  });

  it("returns default when no explicit argument or env var", () => {
    const result = getBaseDir();
    expect(result).toBe(join(homedir(), ".gpfs"));
  });

  it("ignores empty string explicit argument", () => {
    process.env.GPFS_BASE_DIR = "/env/path";
    const result = getBaseDir("");
    expect(result).toBe("/env/path");
  });

  it("ignores empty string env var", () => {
    process.env.GPFS_BASE_DIR = "";
    const result = getBaseDir();
    expect(result).toBe(join(homedir(), ".gpfs"));
  });
});
