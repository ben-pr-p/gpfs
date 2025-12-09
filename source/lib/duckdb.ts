/**
 * DuckDB integration for SQL queries against local markdown files.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { getTrackedProjects } from "./projects.js";
import { parseMarkdownFile } from "./markdown.js";
import { readdir } from "fs/promises";
import { join } from "path";

export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
};

export type QuerySuccess = {
  success: true;
  result: QueryResult;
};

export type QueryError = {
  success: false;
  error: "no_projects" | "query_error";
  message: string;
};

export type QueryResponse = QuerySuccess | QueryError;

/**
 * Execute a SQL query against the items view.
 */
export async function executeQuery(
  sql: string,
  baseDir: string
): Promise<QueryResponse> {
  // Get all tracked projects
  const projects = await getTrackedProjects(baseDir);
  if (projects.length === 0) {
    return {
      success: false,
      error: "no_projects",
      message: "No tracked projects found. Run `gpfs attach <owner/number>` first.",
    };
  }

  // Collect all items from all projects
  const items: Record<string, unknown>[] = [];

  for (const project of projects) {
    let files: string[];
    try {
      files = (await readdir(project.path)).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const filename of files) {
      const filePath = join(project.path, filename);
      const parsed = await parseMarkdownFile(filePath);
      if (!parsed) continue;

      const fm = parsed.frontmatter;
      items.push({
        project_id: fm.project_id ?? null,
        project_name: project.name,
        project_owner: project.owner,
        project_number: project.number,
        file_path: filePath,
        id: fm.id ?? null,
        title: fm.title ?? null,
        body: parsed.body,
        status: fm.status ?? null,
        deleted: fm.deleted === true,
        content_type: fm.content_type ?? null,
        content_id: fm.content_id ?? null,
        // Include all other frontmatter fields as custom fields
        ...Object.fromEntries(
          Object.entries(fm).filter(
            ([key]) =>
              ![
                "id",
                "project_id",
                "project_owner",
                "project_number",
                "title",
                "status",
                "deleted",
                "content_type",
                "content_id",
                "_sync",
              ].includes(key)
          )
        ),
      });
    }
  }

  if (items.length === 0) {
    // Return empty result with default columns
    return {
      success: true,
      result: {
        columns: [
          "project_id",
          "project_name",
          "project_owner",
          "project_number",
          "file_path",
          "id",
          "title",
          "body",
          "status",
          "deleted",
        ],
        rows: [],
      },
    };
  }

  try {
    // Create DuckDB instance and connection
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();

    // Create table from items
    const firstItem = items[0];
    if (!firstItem) {
      return {
        success: true,
        result: { columns: [], rows: [] },
      };
    }
    const columns = Object.keys(firstItem);
    const columnDefs = columns
      .map((col) => {
        // Determine column type from first non-null value
        const sample = items.find((item) => item[col] !== null)?.[col];
        if (typeof sample === "boolean") return `"${col}" BOOLEAN`;
        if (typeof sample === "number") return `"${col}" DOUBLE`;
        return `"${col}" VARCHAR`;
      })
      .join(", ");

    await conn.run(`CREATE TABLE items (${columnDefs})`);

    // Insert all items using individual INSERT statements
    for (const item of items) {
      const values = columns.map((col) => {
        const val = item[col];
        if (val === null || val === undefined) return "NULL";
        if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
        if (typeof val === "number") return String(val);
        // Escape single quotes for SQL
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      await conn.run(`INSERT INTO items VALUES (${values.join(", ")})`);
    }

    // Execute the user's query
    const reader = await conn.runAndReadAll(sql);
    const resultColumns = reader.columnNames();
    const resultRows = reader.getRows().map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < resultColumns.length; i++) {
        const colName = resultColumns[i];
        if (colName !== undefined) {
          obj[colName] = row[i];
        }
      }
      return obj;
    });

    return {
      success: true,
      result: {
        columns: resultColumns,
        rows: resultRows,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: "query_error",
      message: `Query error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
