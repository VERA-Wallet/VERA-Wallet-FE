import { describe, expect, it } from "vitest";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { normalizedEventSchema } from "@/lib/schema/normalized-event";

describe("price status schema", () => {
  it("requires null values for unknown prices", () => {
    const event = createNormalizedEventFixtures()[3];
    expect(normalizedEventSchema.safeParse(event).success).toBe(true);
    expect(normalizedEventSchema.safeParse({ ...event, fiat_value: "1.00" }).success).toBe(false);
  });

  it("requires decimal values for resolved and estimated prices", () => {
    const event = createNormalizedEventFixtures()[0];
    expect(normalizedEventSchema.safeParse(event).success).toBe(true);
    expect(normalizedEventSchema.safeParse({ ...event, fiat_value: null }).success).toBe(false);
    expect(normalizedEventSchema.safeParse({ ...event, fiat_value: "not-a-number" }).success).toBe(false);
  });
});
