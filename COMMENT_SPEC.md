# Comment Storage Specification (Draft)

This document explores storing issue/PR comments alongside project items.

## Chosen Approach: XML after markdown body

Comments are stored as XML at the end of the item's markdown file:

```markdown
---
id: PVTI_xyz123
title: Fix login bug
status: In Progress
---

The issue body goes here with full markdown support...

<comments>
  <comment id="IC_abc123" author="octocat" created="2025-01-15T10:30:00Z">
    This looks like a race condition to me.
  </comment>
  <comment id="IC_def456" author="janedoe" created="2025-01-15T11:00:00Z">
    Agreed, I will take a look at the mutex handling.
  </comment>
</comments>
```

### Why this approach?

- **Single file per item** - maintains current mental model
- **Body stays readable** - frontmatter doesn't get bloated
- **Queryable by DuckDB** - XML can be parsed with DuckDB's XML functions
- **Clear separation** - XML is visually distinct from markdown content
- **Editable** - users can add comments by appending `<comment>` elements

## Parsing

### Step 1: Split the file into sections

```typescript
interface ParsedItemFile {
  frontmatter: Record<string, unknown>;
  body: string;
  comments: Comment[];
}

interface Comment {
  id?: string;           // IC_xxx for existing, undefined for new
  author?: string;       // GitHub username
  created_at?: string;   // ISO 8601 timestamp
  body: string;          // Comment content
}

function parseItemFile(content: string): ParsedItemFile {
  // 1. Extract frontmatter (between --- delimiters)
  // 2. Find <comments>...</comments> section at end
  // 3. Everything between frontmatter and comments is the body

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  const commentsMatch = content.match(/<comments>([\s\S]*)<\/comments>\s*$/);

  const frontmatterEnd = frontmatterMatch
    ? frontmatterMatch[0].length
    : 0;
  const commentsStart = commentsMatch
    ? content.lastIndexOf('<comments>')
    : content.length;

  return {
    frontmatter: parseFrontmatter(frontmatterMatch?.[1] ?? ''),
    body: content.slice(frontmatterEnd, commentsStart).trim(),
    comments: parseCommentsXml(commentsMatch?.[1] ?? ''),
  };
}
```

### Step 2: Parse XML comments

Options for XML parsing in Bun:

1. **Regex-based (simple, fragile)**
   ```typescript
   function parseCommentsXml(xml: string): Comment[] {
     const comments: Comment[] = [];
     const commentRegex = /<comment([^>]*)>([\s\S]*?)<\/comment>/g;
     const attrRegex = /(\w+)="([^"]*)"/g;

     let match;
     while ((match = commentRegex.exec(xml)) !== null) {
       const attrs: Record<string, string> = {};
       let attrMatch;
       while ((attrMatch = attrRegex.exec(match[1])) !== null) {
         attrs[attrMatch[1]] = attrMatch[2];
       }
       comments.push({
         id: attrs.id,
         author: attrs.author,
         created_at: attrs.created,
         body: match[2].trim(),
       });
     }
     return comments;
   }
   ```

2. **fast-xml-parser (npm package)**
   ```typescript
   import { XMLParser } from 'fast-xml-parser';

   function parseCommentsXml(xml: string): Comment[] {
     const parser = new XMLParser({
       ignoreAttributes: false,
       attributeNamePrefix: '',
     });
     const parsed = parser.parse(`<comments>${xml}</comments>`);
     // Transform to Comment[]
   }
   ```

3. **DOMParser (if available in Bun)**
   ```typescript
   function parseCommentsXml(xml: string): Comment[] {
     const doc = new DOMParser().parseFromString(
       `<comments>${xml}</comments>`,
       'text/xml'
     );
     return Array.from(doc.querySelectorAll('comment')).map(el => ({
       id: el.getAttribute('id') ?? undefined,
       author: el.getAttribute('author') ?? undefined,
       created_at: el.getAttribute('created') ?? undefined,
       body: el.textContent?.trim() ?? '',
     }));
   }
   ```

**Recommendation:** Start with regex for simplicity. It's sufficient for our controlled format. Add a proper XML parser if we need to handle edge cases (CDATA, entities, etc.).

## Serialization

```typescript
function serializeItemFile(item: ParsedItemFile): string {
  const frontmatter = serializeFrontmatter(item.frontmatter);
  const comments = serializeComments(item.comments);

  let content = `---\n${frontmatter}---\n\n${item.body}`;

  if (item.comments.length > 0) {
    content += `\n\n<comments>\n${comments}</comments>\n`;
  }

  return content;
}

function serializeComments(comments: Comment[]): string {
  return comments.map(c => {
    const attrs: string[] = [];
    if (c.id) attrs.push(`id="${escapeXmlAttr(c.id)}"`);
    if (c.author) attrs.push(`author="${escapeXmlAttr(c.author)}"`);
    if (c.created_at) attrs.push(`created="${escapeXmlAttr(c.created_at)}"`);

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    return `  <comment${attrStr}>\n    ${escapeXmlContent(c.body)}\n  </comment>`;
  }).join('\n');
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
}

function escapeXmlContent(s: string): string {
  // Only escape & and < in content, preserve readability
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
```

## DuckDB Integration

### Option A: Extract XML in SQL

DuckDB doesn't have native XML support, but we can:

1. Extract the XML section as a string column
2. Use regex or a UDF to parse it

```sql
-- Extract comments XML section
CREATE VIEW items_raw AS
SELECT
  *,
  regexp_extract(content, '<comments>(.*)</comments>', 1) as comments_xml
FROM read_markdown('~/.gpfs/**/*.md');
```

### Option B: Pre-process to JSON

When building the DuckDB view, parse comments into JSON:

```typescript
// In duckdb.ts, when creating the items view
const items = await loadAllItems(); // includes parsed comments

// Write as JSON or Parquet for DuckDB
await Bun.write(
  '~/.gpfs/.cache/items.json',
  JSON.stringify(items.map(i => ({
    ...i.frontmatter,
    body: i.body,
    comments: i.comments, // Already parsed
  })))
);
```

Then in DuckDB:

```sql
SELECT
  i.title,
  c.author,
  c.body as comment_body
FROM read_json_auto('~/.gpfs/.cache/items.json') i,
UNNEST(i.comments) as c
WHERE c.author = 'octocat'
```

**Recommendation:** Option B (pre-process to JSON) is more robust. We're already parsing the files, so we can emit a query-friendly format.

## Sync Behavior

### Pull

1. Fetch comments from GitHub for linked issues/PRs
2. Merge with existing local comments:
   - Match by `id`
   - Remote wins for existing comments (last-write-wins)
   - Preserve local-only comments (no `id` or `id` not on remote)
3. Update `<comments>` section in file

### Push

1. Parse local comments
2. For comments without `id` (new):
   - POST to GitHub
   - Update local file with assigned `id`
3. For comments with `id`:
   - Compare with remote, push if local is newer
4. Deleted comments: TBD - maybe don't support deletion via local files?

### Adding a comment locally

User edits the file:

```markdown
<comments>
  <comment id="IC_abc123" author="octocat" created="2025-01-15T10:30:00Z">
    Existing comment
  </comment>
  <comment>
    My new comment here - no id, author, or created needed.
  </comment>
</comments>
```

On push, we detect the comment without `id` and create it on GitHub.

## Edge Cases

### No comments section

If there's no `<comments>` tag, the file has no comments. This is fine.

### Empty comments section

```markdown
<comments>
</comments>
```

Valid, means "comments were fetched but there are none."

### Malformed XML

If parsing fails, warn and skip comments for that file. Don't fail the entire operation.

### Comment body contains XML-like content

User writes:

```markdown
<comment>
  Here's some code: <div>hello</div>
</comment>
```

The `<div>` will be escaped on serialization:

```markdown
<comment>
  Here's some code: &lt;div>hello&lt;/div>
</comment>
```

This is ugly but correct. Alternative: use CDATA sections:

```markdown
<comment><![CDATA[
  Here's some code: <div>hello</div>
]]></comment>
```

**Recommendation:** Use CDATA for comment bodies to preserve content exactly:

```markdown
<comments>
  <comment id="IC_abc123" author="octocat" created="2025-01-15T10:30:00Z"><![CDATA[
    Here's some code: <div>hello</div>

    And some **markdown** too!
  ]]></comment>
</comments>
```

## Open Questions

1. **Should we sync comments for all items or only linked issues/PRs?**
   - Draft items (not linked) don't have comments on GitHub
   - Only linked issues/PRs have comment threads

2. **Comment editing** - should local edits to existing comments be pushed?
   - Could be confusing if comment was edited by someone else
   - Maybe only allow adding new comments, not editing existing

3. **Comment deletion** - how to handle?
   - Option: don't support deletion via local files
   - Option: explicit `deleted="true"` attribute

4. **Reactions/emoji** - store them? Probably not in v1.

## Alternatives Considered

### YAML in frontmatter

```yaml
comments:
  - id: IC_abc123
    author: octocat
    body: |
      Comment text here
```

Rejected: pushes body too far down, makes frontmatter unwieldy.

### Separate .comments.yaml file

```
fix-login-bug.md
fix-login-bug.comments.yaml
```

Rejected: breaks single-file-per-item model, harder to see comments in context.

### HTML comments as delimiters

```markdown
<!-- gpfs:comment id="IC_abc123" author="octocat" -->
Comment text here
<!-- /gpfs:comment -->
```

Rejected: harder to parse reliably, less structured than XML.
