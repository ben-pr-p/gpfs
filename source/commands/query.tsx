import * as React from "react";
import { Text, Box } from "ink";
import { z } from "zod";
import { getBaseDir } from "../lib/config.js";
import { executeQuery } from "../lib/duckdb.js";

export const options = z.object({
  baseDir: z
    .string()
    .optional()
    .describe("Base directory for gpfs data (default: ~/.gpfs)"),
  format: z
    .enum(["table", "json", "csv"])
    .default("table")
    .describe("Output format (table, json, csv)"),
});

export const args = z.tuple([
  z.string().describe("SQL query against the items table"),
]);

type Props = {
  options: z.infer<typeof options>;
  args: z.infer<typeof args>;
};

type QueryState =
  | { status: "running" }
  | { status: "success"; columns: string[]; rows: Record<string, unknown>[] }
  | { status: "error"; message: string };

export default function Query({ options, args }: Props) {
  const [state, setState] = React.useState<QueryState>({ status: "running" });
  const sql = args[0];

  React.useEffect(() => {
    async function runQuery() {
      const baseDir = getBaseDir(options.baseDir);
      const result = await executeQuery(sql, baseDir);

      if (!result.success) {
        setState({ status: "error", message: result.message });
        return;
      }

      setState({
        status: "success",
        columns: result.result.columns,
        rows: result.result.rows,
      });
    }

    runQuery();
  }, [sql, options.baseDir]);

  if (state.status === "running") {
    return <Text>Running query...</Text>;
  }

  if (state.status === "error") {
    return <Text color="red">Error: {state.message}</Text>;
  }

  if (state.rows.length === 0) {
    return <Text color="yellow">No results</Text>;
  }

  if (options.format === "json") {
    return <Text>{JSON.stringify(state.rows, null, 2)}</Text>;
  }

  if (options.format === "csv") {
    return <CsvOutput columns={state.columns} rows={state.rows} />;
  }

  return <TableOutput columns={state.columns} rows={state.rows} />;
}

function CsvOutput({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  const escapeCsv = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map(escapeCsv).join(",");
  const dataRows = rows.map((row) =>
    columns.map((col) => escapeCsv(row[col])).join(",")
  );

  return <Text>{[header, ...dataRows].join("\n")}</Text>;
}

function TableOutput({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  // Calculate column widths
  const columnWidths: Record<string, number> = {};
  for (const col of columns) {
    columnWidths[col] = col.length;
    for (const row of rows) {
      const value = formatValue(row[col]);
      columnWidths[col] = Math.max(columnWidths[col], value.length);
    }
    // Cap width at 40 characters
    columnWidths[col] = Math.min(columnWidths[col], 40);
  }

  const formatCell = (value: string, width: number): string => {
    if (value.length > width) {
      return value.slice(0, width - 1) + "…";
    }
    return value.padEnd(width);
  };

  const headerRow = columns
    .map((col) => formatCell(col, columnWidths[col] ?? 0))
    .join(" │ ");
  const separator = columns
    .map((col) => "─".repeat(columnWidths[col] ?? 0))
    .join("─┼─");

  return (
    <Box flexDirection="column">
      <Text bold>{headerRow}</Text>
      <Text>{separator}</Text>
      {rows.map((row, i) => (
        <Text key={i}>
          {columns
            .map((col) => formatCell(formatValue(row[col]), columnWidths[col] ?? 0))
            .join(" │ ")}
        </Text>
      ))}
      <Text color="gray">({rows.length} row{rows.length !== 1 ? "s" : ""})</Text>
    </Box>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    // Replace newlines with space for display
    return value.replace(/\n/g, " ");
  }
  return String(value);
}
