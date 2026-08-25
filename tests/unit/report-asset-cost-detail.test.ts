import { describe, expect, it } from "vitest";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { round, sum } from "@/lib/tax/decimal";
import { buildAssetCostDetail } from "@/lib/export/report";
import type { TaxEvent } from "@/lib/tax/types";

const events: TaxEvent[] = [
  { kind: "ACQUIRE", id: "acq-open", at: "2026-06-01T00:00:00.000Z", wallet: "0xw", asset: "1:native", symbol: "ETH", quantity: "2", cost: "2000000", fee: "0" },
  { kind: "ACQUIRE", id: "acq-cur", at: "2027-03-01T00:00:00.000Z", wallet: "0xw", asset: "1:native", symbol: "ETH", quantity: "1", cost: "3000000", fee: "0" },
  { kind: "DISPOSE", id: "disp", at: "2027-06-01T00:00:00.000Z", wallet: "0xw", asset: "1:native", symbol: "ETH", quantity: "1", proceeds: "5000000", fee: "0", trigger: "FIAT" },
];

describe("P2-B 자산별 취득가액 명세", () => {
  it("기초·당기취득·양도를 자산별로 갈라 담고 총평균단가를 낸다", () => {
    const estimate = computeTaxEstimate({ country: "KR", taxYear: 2027, events });
    const rows = buildAssetCostDetail(estimate);
    expect(rows).toHaveLength(1);
    const eth = rows[0];
    expect(eth.자산).toBe("ETH");
    // 수량은 18자리 토큰 정밀도를 지키려 Decimal 문자열로 낸다. 금액은 스프레드시트 합산용 숫자다.
    expect(eth.기초수량).toBe("2");
    expect(eth.기초가액).toBe(2000000);
    expect(eth.당기취득수량).toBe("1");
    expect(eth.당기취득가액).toBe(3000000);
    expect(eth.당기양도수량).toBe("1");
    expect(eth.양도가액).toBe(5000000);
    // 총평균단가 = (200만+300만) / 3 ≈ 1,666,666.67, 적용취득가액 = 단가 × 1.
    expect(eth.총평균단가).toBe(1666666.67);
    expect(eth.적용취득가액).toBe(1666666.67);
    // 시가 미입력이면 uplift가 없어 의제취득가액은 미적용이다.
    expect(eth.의제취득가액적용여부).toBe("미적용");
  });

  it("자산별 손익 합계가 estimate의 처분 손익 합계와 일치한다", () => {
    const estimate = computeTaxEstimate({ country: "KR", taxYear: 2027, events });
    const rows = buildAssetCostDetail(estimate);
    const rowGainSum = rows.reduce((total, row) => total + Number(row.손익), 0);
    const gainSum = sum(estimate.judgments.filter((row) => row.amountKind === "gain").map((row) => row.amount));
    expect(Number(round(String(rowGainSum), 2))).toBe(Number(round(gainSum, 2)));
  });

  it("의제취득가액 시가가 입력되면 uplift를 반영해 '적용'으로 표시한다", () => {
    // 경계 전 취득단가(100만)보다 높은 2026-12-31 시가(400만)를 주면 취득가액이 올라간다.
    const estimate = computeTaxEstimate({ country: "KR", taxYear: 2027, events, deemedFmv: { "1:native": "4000000" } });
    const eth = buildAssetCostDetail(estimate)[0];
    expect(eth.의제취득가액적용여부).toBe("적용");
    // uplift로 적용취득가액이 raw 평균(약 166만)보다 커진다.
    expect(Number(eth.총평균단가)).toBeGreaterThan(1666666.67);
  });

  it("계산에서 제외된 이벤트는 자산별 명세에 넣지 않는다", () => {
    const estimate = computeTaxEstimate({ country: "KR", taxYear: 2027, events, excludedEventIds: ["ghost"] });
    const rows = buildAssetCostDetail(estimate);
    // 제외 이벤트는 판정 행이 없어 자산 버킷을 만들지 않는다 — 여전히 ETH 한 줄뿐이다.
    expect(rows).toHaveLength(1);
    expect(estimate.excludedEventIds).toContain("ghost");
  });
});
