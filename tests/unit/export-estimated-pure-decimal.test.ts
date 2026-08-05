import { describe, expect, it } from "vitest";
import { eventToRow } from "@/lib/export/schema";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";

describe("estimated export values", () => {
  it("keeps the fiat decimal unadorned while price status carries estimation", () => {
    const event = createNormalizedEventFixtures().find(({ price_status }) => price_status === "ESTIMATED");
    expect(event).toBeDefined();
    const row = eventToRow(event!);
    expect(row.price_status).toBe("ESTIMATED");
    expect(row.fiat_value).toBe(event!.fiat_value);
    expect(row.fiat_value).toMatch(/^-?\d+(?:\.\d+)?$/);
  });
});
