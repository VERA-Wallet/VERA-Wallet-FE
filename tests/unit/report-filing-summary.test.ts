import { describe, expect, it } from "vitest";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { add, percentOf, round } from "@/lib/tax/decimal";
import { buildFilingSummary } from "@/lib/export/report";
import type { TaxEvent } from "@/lib/tax/types";

/** 경계 전 취득(기초) 2 ETH + 당기취득 1 ETH를 총평균낸 뒤 1 ETH를 처분하는 KR 시행 시나리오. */
const events: TaxEvent[] = [
  { kind: "ACQUIRE", id: "acq-open", at: "2026-06-01T00:00:00.000Z", wallet: "0xw", asset: "1:native", symbol: "ETH", quantity: "2", cost: "2000000", fee: "0" },
  { kind: "ACQUIRE", id: "acq-cur", at: "2027-03-01T00:00:00.000Z", wallet: "0xw", asset: "1:native", symbol: "ETH", quantity: "1", cost: "3000000", fee: "0" },
  { kind: "DISPOSE", id: "disp", at: "2027-06-01T00:00:00.000Z", wallet: "0xw", asset: "1:native", symbol: "ETH", quantity: "1", proceeds: "5000000", fee: "0", trigger: "FIAT" },
];

describe("P2-A 신고 요약서", () => {
  const estimate = computeTaxEstimate({ country: "KR", taxYear: 2027, events });
  const rows = buildFilingSummary(estimate);
  const value = (label: string) => rows.find((row) => row.기입란 === label)?.금액;

  it("별지 제40호서식(6) 기입란을 estimate에서 1:1로 파생한다", () => {
    expect(value("귀속연도")).toBe(2027);
    expect(value("세율")).toBe("20%");
    // 기타소득금액 = 총수입금액 − 필요경비.
    expect(value("기타소득금액")).toBe(Number(round(String(Number(value("총수입금액")) - Number(value("필요경비"))), 2)));
  });

  it("산출 소득세 = 과세표준 × 20%, 합계 부담 = 산출 소득세 + 개인지방소득세", () => {
    const taxBase = estimate.totals.taxableBase;
    expect(value("과세표준")).toBe(Number(round(taxBase, 2)));
    // 요약 세액 불변식: 산출 소득세은 과세표준의 20%다.
    expect(value("산출 소득세")).toBe(Number(round(percentOf(taxBase, "20"), 2)));
    // 합계 부담은 신고서에 표기된 산출 소득세 + 지방소득세와 정확히 맞는다(행끼리 더해 맞아야 한다).
    const total = add(String(value("산출 소득세")), String(value("개인지방소득세")));
    expect(value("예상 합계 부담")).toBe(Number(round(total, 2)));
  });

  it("계산 신뢰도를 estimate 상태에서 파생한다", () => {
    expect(String(value("계산 신뢰도"))).toContain("부분확정");
  });
});
