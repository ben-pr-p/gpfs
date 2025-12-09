import { describe, it, expect } from "bun:test";
import { parseProjectIdentifier, sanitizeForFilesystem } from "./filesystem.js";

describe("parseProjectIdentifier", () => {
  it("parses valid owner/number format", () => {
    const result = parseProjectIdentifier("myorg/42");
    expect(result).toEqual({ owner: "myorg", number: 42 });
  });

  it("parses owner with hyphens", () => {
    const result = parseProjectIdentifier("my-org-name/123");
    expect(result).toEqual({ owner: "my-org-name", number: 123 });
  });

  it("parses owner with underscores", () => {
    const result = parseProjectIdentifier("my_org/1");
    expect(result).toEqual({ owner: "my_org", number: 1 });
  });

  it("returns null for missing slash", () => {
    expect(parseProjectIdentifier("myorg42")).toBeNull();
  });

  it("returns null for missing number", () => {
    expect(parseProjectIdentifier("myorg/")).toBeNull();
  });

  it("returns null for non-numeric number", () => {
    expect(parseProjectIdentifier("myorg/abc")).toBeNull();
  });

  it("returns null for multiple slashes", () => {
    expect(parseProjectIdentifier("my/org/42")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseProjectIdentifier("")).toBeNull();
  });

  it("returns null for number only", () => {
    expect(parseProjectIdentifier("/42")).toBeNull();
  });
});

describe("sanitizeForFilesystem", () => {
  it("converts to lowercase", () => {
    expect(sanitizeForFilesystem("MyProject")).toBe("myproject");
  });

  it("replaces spaces with dashes", () => {
    expect(sanitizeForFilesystem("My Project Name")).toBe("my-project-name");
  });

  it("replaces multiple spaces with single dash", () => {
    expect(sanitizeForFilesystem("My    Project")).toBe("my-project");
  });

  it("replaces unsafe characters", () => {
    expect(sanitizeForFilesystem("file/name:test")).toBe("file-name-test");
    expect(sanitizeForFilesystem('test*?"<>|end')).toBe("test-end");
  });

  it("collapses multiple dashes", () => {
    expect(sanitizeForFilesystem("a--b---c")).toBe("a-b-c");
  });

  it("trims leading and trailing dashes", () => {
    expect(sanitizeForFilesystem("-test-")).toBe("test");
    expect(sanitizeForFilesystem("---test---")).toBe("test");
  });

  it("truncates to 100 characters by default", () => {
    const longName = "a".repeat(150);
    expect(sanitizeForFilesystem(longName)).toBe("a".repeat(100));
  });

  it("truncates to custom length", () => {
    expect(sanitizeForFilesystem("abcdefghij", 5)).toBe("abcde");
  });

  it("handles complex names", () => {
    expect(sanitizeForFilesystem("Q1 Roadmap 2025: Features & Bugs"))
      .toBe("q1-roadmap-2025-features-&-bugs");
  });

  it("handles empty string", () => {
    expect(sanitizeForFilesystem("")).toBe("");
  });

  it("handles string of only unsafe characters", () => {
    expect(sanitizeForFilesystem("***")).toBe("");
  });
});
