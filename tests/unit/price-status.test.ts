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

describe("자산 메타데이터 스키마", () => {
  it("심볼 없이 검증됨이라 말할 수 없다", () => {
    const event = createNormalizedEventFixtures()[0];
    expect(normalizedEventSchema.safeParse(event).success).toBe(true);
    // 무엇을 대조했다는 것인지 가리킬 대상이 없다.
    expect(normalizedEventSchema.safeParse({ ...event, asset_symbol: null }).success).toBe(false);
    // 심볼을 모르는 미검증 토큰은 유효하다 — 실제 지갑에는 그런 게 들어온다.
    expect(normalizedEventSchema.safeParse({ ...event, asset_symbol: null, asset_verified: false }).success).toBe(true);
  });

  it("빈 심볼은 심볼이 아니다", () => {
    const event = createNormalizedEventFixtures()[0];
    expect(normalizedEventSchema.safeParse({ ...event, asset_symbol: "" }).success).toBe(false);
  });

  it("이 칸을 모르는 옛 응답도 이력을 통째로 잃지 않는다", () => {
    // 배포 스큐(구버전 서버) · 재시드되지 않은 dev 스토어가 실제로 이 payload를 보낸다.
    // 필수로 두면 칸 하나 때문에 목록 전체가 "거래를 불러오지 못했습니다"가 된다.
    const { asset_symbol, asset_verified, ...legacy } = createNormalizedEventFixtures()[0];
    void asset_symbol;
    void asset_verified;
    const parsed = normalizedEventSchema.safeParse(legacy);

    expect(parsed.success).toBe(true);
    // 모르는 것을 안다고 말하지 않는다 — 심볼 없음 · 미검증으로 읽는다.
    expect(parsed.success && parsed.data.asset_symbol).toBe(null);
    expect(parsed.success && parsed.data.asset_verified).toBe(false);
  });
});
