import { describe, expect, it } from "vitest";

import {
  FREE_EXPORT_EVENT_LIMIT,
  PLANS,
  PLAN_STORAGE_KEY,
  exportEventAllowance,
  loadPlan,
  parsePlan,
  planDefinition,
  savePlan,
  type Plan,
} from "@/lib/plan/use-plan";
import { memoryStorage } from "@/tests/fixtures/memory-storage";

const plusPlan: Plan = { tier: "plus", taxYear: 2026, activatedAt: "2026-08-19T00:00:00.000Z" };

describe("플랜 카탈로그", () => {
  it("카드가 광고한 한도와 실제로 문을 여는 한도가 같다", () => {
    // 카드에 1,000건이라 적어 두고 잠금 판정은 다른 수를 쓰면 화면이 거짓말을 한다.
    expect(exportEventAllowance(null)).toBe(FREE_EXPORT_EVENT_LIMIT);
    expect(exportEventAllowance(plusPlan)).toBe(planDefinition("plus").exportLimit);
    expect(exportEventAllowance({ ...plusPlan, tier: "pro" })).toBe(planDefinition("pro").exportLimit);
  });

  it("상위 플랜이 하위 플랜보다 많이 내보낼 수 있다", () => {
    const limits = PLANS.map((definition) => definition.exportLimit);
    expect(limits).toEqual([...limits].sort((left, right) => left - right));
    expect(new Set(limits).size).toBe(limits.length);
  });
});

describe("mock 플랜 저장소", () => {
  it("모양이 깨진 값은 플랜 없음으로 읽는다", () => {
    // 저장소는 사용자가 직접 고칠 수 있는 공간이다. 알 수 없는 tier를 활성으로 읽으면 한도를 지어내야 한다.
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan("{")).toBeNull();
    expect(parsePlan(JSON.stringify({ tier: "enterprise", taxYear: 2026, activatedAt: "2026-08-19T00:00:00.000Z" }))).toBeNull();
    expect(parsePlan(JSON.stringify({ tier: "plus", activatedAt: "2026-08-19T00:00:00.000Z" }))).toBeNull();
    expect(parsePlan(JSON.stringify(plusPlan))).toEqual(plusPlan);
  });

  it("해제는 키를 남기지 않는다", () => {
    const storage = memoryStorage();
    savePlan(plusPlan, storage);
    expect(loadPlan(storage)).toEqual(plusPlan);

    savePlan(null, storage);
    expect(storage.getItem(PLAN_STORAGE_KEY)).toBeNull();
    expect(loadPlan(storage)).toBeNull();
  });

  it("저장소가 없는 환경에서도 플랜 없음으로 답한다", () => {
    // 서버 렌더·프라이빗 모드에서 화면이 멈추면 안 된다.
    expect(loadPlan(null)).toBeNull();
    expect(() => savePlan(plusPlan, null)).not.toThrow();
  });
});
