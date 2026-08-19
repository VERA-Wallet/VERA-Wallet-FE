import { describe, expect, it } from "vitest";
import { createExportCsv } from "@/lib/export/csv";
import { EXPORT_COLUMNS } from "@/lib/export/schema";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted && char === '"' && csv[index + 1] === '"') { value += char; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ",") { rows.at(-1)!.push(value); value = ""; continue; }
    if (!quoted && char === "\r" && csv[index + 1] === "\n") { rows.at(-1)!.push(value); rows.push([]); value = ""; index += 1; continue; }
    value += char;
  }
  return rows.filter((row) => row.length > 0);
}

describe("CSV export", () => {
  it("round-trips RFC4180 escaped fields and includes an Excel BOM", () => {
    const event = { ...createNormalizedEventFixtures()[0], user_override: { classification: "SEND" as const, reason: "comma, quote \" and newline\n", overridden_at: "2025-01-01T00:00:00.000Z" } };
    const rows = parseCsv(createExportCsv([event]));
    expect(rows[0][0]).toBe(`\uFEFF${EXPORT_COLUMNS[0]}`);
    expect(rows[0].slice(1)).toEqual(EXPORT_COLUMNS.slice(1));
    expect(rows[1][16]).toBe(JSON.stringify(event.user_override));
  });
});
