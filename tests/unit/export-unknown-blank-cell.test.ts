import { describe, expect, it } from "vitest";
import { eventToRow } from "@/lib/export/schema";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";

describe("unknown export values", () => {
  it("exports an unknown fiat value as a blank cell", () => {
    const event = createNormalizedEventFixtures().find(({ price_status }) => price_status === "UNKNOWN");
    expect(event).toBeDefined();
    expect(eventToRow(event!).fiat_value).toBe("");
  });
});
