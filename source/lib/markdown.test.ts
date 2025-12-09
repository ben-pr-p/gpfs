import { describe, it, expect } from "bun:test";
import { serializeItemToMarkdown, parseMarkdownString, computeChecksum } from "./markdown.js";
import type { ProjectItem } from "./github.js";

describe("serializeItemToMarkdown", () => {
  const context = {
    projectId: "PVT_test123",
    projectOwner: "testorg",
    projectNumber: 42,
  };

  it("serializes a basic item", () => {
    const item: ProjectItem = {
      id: "PVTI_item1",
      title: "Test Item",
      body: "This is the body.",
      status: "Todo",
      contentType: "DraftIssue",
      contentId: "DI_content1",
    };

    const result = serializeItemToMarkdown(item, context);

    expect(result).toContain("---\n");
    expect(result).toContain("id: PVTI_item1");
    expect(result).toContain("project_id: PVT_test123");
    expect(result).toContain("project_owner: testorg");
    expect(result).toContain("project_number: 42");
    expect(result).toContain("title: Test Item");
    expect(result).toContain("status: Todo");
    expect(result).toContain("content_type: DraftIssue");
    expect(result).toContain("deleted: false");
    expect(result).toContain("This is the body.");
  });

  it("handles null status", () => {
    const item: ProjectItem = {
      id: "PVTI_item2",
      title: "No Status",
      body: "Body content",
      status: null,
      contentType: "DraftIssue",
      contentId: null,
    };

    const result = serializeItemToMarkdown(item, context);

    expect(result).toContain("status: null");
    expect(result).toContain("content_id: null");
  });

  it("handles multiline body", () => {
    const item: ProjectItem = {
      id: "PVTI_item3",
      title: "Multiline",
      body: "Line 1\n\nLine 2\n\n## Header\n- Item 1\n- Item 2",
      status: "Done",
      contentType: "DraftIssue",
      contentId: "DI_content3",
    };

    const result = serializeItemToMarkdown(item, context);

    expect(result).toContain("Line 1\n\nLine 2");
    expect(result).toContain("## Header");
    expect(result).toContain("- Item 1");
  });
});

describe("parseMarkdownString", () => {
  it("parses valid frontmatter", () => {
    const content = `---
id: PVTI_test
title: Test Title
status: Todo
deleted: false
---

Body content here.`;

    const result = parseMarkdownString(content);

    expect(result).not.toBeNull();
    expect(result!.frontmatter.id).toBe("PVTI_test");
    expect(result!.frontmatter.title).toBe("Test Title");
    expect(result!.frontmatter.status).toBe("Todo");
    expect(result!.frontmatter.deleted).toBe(false);
    expect(result!.body).toBe("Body content here.");
  });

  it("parses numbers", () => {
    const content = `---
project_number: 42
count: 100
---

Body`;

    const result = parseMarkdownString(content);

    expect(result!.frontmatter.project_number).toBe(42);
    expect(result!.frontmatter.count).toBe(100);
  });

  it("parses nested objects", () => {
    const content = `---
id: test
_sync:
  remote_updated_at: 2025-01-01T00:00:00Z
  local_checksum: abc123
---

Body`;

    const result = parseMarkdownString(content);

    expect(result!.frontmatter._sync).toEqual({
      remote_updated_at: "2025-01-01T00:00:00Z",
      local_checksum: "abc123",
    });
  });

  it("handles content without frontmatter", () => {
    const content = "Just some markdown without frontmatter.";

    const result = parseMarkdownString(content);

    expect(result).not.toBeNull();
    expect(result!.frontmatter).toEqual({});
    expect(result!.body).toBe("Just some markdown without frontmatter.");
  });

  it("handles empty body", () => {
    const content = `---
id: test
---

`;

    const result = parseMarkdownString(content);

    expect(result!.frontmatter.id).toBe("test");
    expect(result!.body).toBe("");
  });

  it("parses quoted strings", () => {
    const content = `---
title: "Title with: colon"
description: "Has #hash and other: special chars"
---

Body`;

    const result = parseMarkdownString(content);

    expect(result!.frontmatter.title).toBe("Title with: colon");
    expect(result!.frontmatter.description).toBe("Has #hash and other: special chars");
  });

  it("parses null values", () => {
    const content = `---
status: null
other: ~
---

Body`;

    const result = parseMarkdownString(content);

    expect(result!.frontmatter.status).toBeNull();
    expect(result!.frontmatter.other).toBeNull();
  });

  it("parses arrays", () => {
    const content = `---
labels:
  - bug
  - priority-high
---

Body`;

    const result = parseMarkdownString(content);

    expect(result!.frontmatter.labels).toEqual(["bug", "priority-high"]);
  });
});

describe("computeChecksum", () => {
  it("returns consistent checksum for same content", () => {
    const content = "Test content";
    const checksum1 = computeChecksum(content);
    const checksum2 = computeChecksum(content);

    expect(checksum1).toBe(checksum2);
  });

  it("returns different checksums for different content", () => {
    const checksum1 = computeChecksum("Content A");
    const checksum2 = computeChecksum("Content B");

    expect(checksum1).not.toBe(checksum2);
  });

  it("returns 12 character hex string", () => {
    const checksum = computeChecksum("Test");

    expect(checksum).toHaveLength(12);
    expect(checksum).toMatch(/^[0-9a-f]+$/);
  });

  it("handles empty string", () => {
    const checksum = computeChecksum("");

    expect(checksum).toHaveLength(12);
    expect(checksum).toMatch(/^[0-9a-f]+$/);
  });

  it("handles multiline content", () => {
    const checksum = computeChecksum("Line 1\nLine 2\nLine 3");

    expect(checksum).toHaveLength(12);
  });
});
