import { describe, expect, it } from "vitest";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";

describe("fixture coverage", () => {
  it("covers every required state deterministically", () => {
    const events = createNormalizedEventFixtures();
    expect(events).toEqual(createNormalizedEventFixtures());
    expect(events).toHaveLength(25);
    expect(new Set(events.map((event) => event.classification))).toEqual(new Set(["RECEIVE", "SEND", "EXCHANGE", "INTERNAL_TRANSFER", "UNKNOWN"]));
    expect(events.filter((event) => event.price_status === "UNKNOWN")).toHaveLength(3);
    expect(events.filter((event) => event.confidence < 0.5)).toHaveLength(3);
    expect(events.some((event) => event.classification === "UNKNOWN" && event.confidence < 0.5)).toBe(true);
    expect(events.some((event) => event.user_override !== null)).toBe(true);
    expect(new Set(events.map((event) => event.chain_id))).toEqual(new Set([1, 8453, 42161, 10, 137]));
    expect(new Set(events.map((event) => event.fiat_currency))).toEqual(new Set(["KRW"]));
  });
});
