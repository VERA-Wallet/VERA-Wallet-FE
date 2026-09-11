import { describe, expect, it } from "vitest";

import { summarizeEventIds } from "@/lib/tax/limitations";

// 룰셋 비교 화면의 "흔들리는 것" 카드가 이벤트 ID를 통째로 나열하면 한 항목이 수천 건일 때
// 한 줄 텍스트가 수십만 자가 되어 화면 폭을 터뜨린다(2026-09-11 aside e2e에서 scrollWidth 2,843,588px 관측).
describe("제약 항목 이벤트 ID 요약", () => {
  it("비어 있으면 빈 문자열", () => {
    expect(summarizeEventIds([])).toBe("");
  });
  it("2건 이하는 그대로 나열한다", () => {
    expect(summarizeEventIds(["1:0xa:log:1"])).toBe("1:0xa:log:1");
    expect(summarizeEventIds(["1:0xa:log:1", "1:0xb:log:2"])).toBe("1:0xa:log:1, 1:0xb:log:2");
  });
  it("3건부터는 앞 2건 + 외 N건", () => {
    expect(summarizeEventIds(["a", "b", "c"])).toBe("a, b 외 1건");
    const many = Array.from({ length: 5000 }, (_, i) => `1:0x${i.toString(16).padStart(64, "0")}:log:${i}`);
    const text = summarizeEventIds(many);
    expect(text.endsWith(" 외 4998건")).toBe(true);
    expect(text.length).toBeLessThan(200);
  });
});
