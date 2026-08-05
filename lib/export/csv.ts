import { EXPORT_COLUMNS, eventToRow } from "@/lib/export/schema";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

function escapeCell(value: string | number): string {
  const cell = String(value);
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

export function createExportCsv(events: readonly NormalizedEvent[]): string {
  const rows = events.map(eventToRow);
  return `\uFEFF${[EXPORT_COLUMNS, ...rows.map((row) => EXPORT_COLUMNS.map((column) => row[column]))]
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n")}\r\n`;
}
