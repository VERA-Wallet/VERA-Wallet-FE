import { describe, expect, it } from "vitest";

import { shortEventId } from "@/lib/event-id";

describe("shortEventId", () => {
  it("folds chain, hash, and log index into one line", () => {
    expect(shortEventId("42161:0xfb49579b936386eaf15615b308e3bb20e66a43dd292fc11570280d61bff44f3a:log:199"))
      .toBe("Arbitrum 0xfb4957…f44f3a #199");
  });

  it("keeps an unrecognized tail instead of guessing", () => {
    expect(shortEventId("1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:external"))
      .toBe("Ethereum 0xaaaaaa…aaaaaa external");
  });

  // 꼴을 못 알아보면 쪼개지 않는다 — 잘못 쪼개면 다른 이벤트를 가리키는 문자열이 만들어진다.
  it("falls back to a middle ellipsis for an unknown shape", () => {
    expect(shortEventId("bridge-synthetic-key-0123456789abcdef")).toBe("bridge-synthet…abcdef");
  });

  it("leaves a short id untouched", () => {
    expect(shortEventId("evt-1")).toBe("evt-1");
  });
});
