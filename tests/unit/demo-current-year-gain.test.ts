import { describe, expect, it } from "vitest";

import { demoTaxYear } from "@/lib/mock/demo-calendar";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { deriveTaxEvents } from "@/lib/tax/derive";
import { computeTaxEstimate, taxPeriodFor } from "@/lib/tax/engine";

/**
 * 거래 목록 우측의 **수익률(%)**은 `gainReturnPercent`가 손익 ÷ 취득원가로 낸다 — 취득원가가 0이면
 * 0으로 나눌 수 없어 null(= % 숨김)이다. 데모 대부분의 처분은 취득 lot이 없어 취득원가가 0이라
 * 기본 화면(기준 연도)에서 %가 아예 안 보이던 문제가 있었다.
 *
 * 그래서 데모 픽스처는 기준 연도에 **같은 자산을 취득한 뒤 처분**하는 매수→매도 쌍을 둬(ETH 등),
 * 취득원가가 잡힌 처분이 여러 건 있게 한다. 이 데이터가 사라지면(다시 % 실종) 이 테스트가 깨진다.
 *
 * 렌더 레벨의 % 표기 자체는 dashboard-judgments의 "처분 행에 실현 손익…" 테스트가 지킨다.
 * 여기서는 **live 데모 데이터**가 그 표기를 띄울 재료(취득원가≠0 gain)를 실제로 만드는지만 본다.
 */
describe("데모는 기준 연도에도 수익률을 띄울 실현 손익(취득원가≠0)을 만든다", () => {
  it("기준 연도 판정에 취득원가가 잡힌 gain 행이 최소 한 건 있다", () => {
    const taxYear = demoTaxYear();
    const events = createNormalizedEventFixtures();
    const derived = deriveTaxEvents(events);
    const period = taxPeriodFor("KR", taxYear);
    const inPeriod = new Set(
      events
        .filter((event) => {
          const at = Date.parse(event.block_timestamp);
          return at >= Date.parse(period.from) && at < Date.parse(period.to);
        })
        .map((event) => event.id),
    );

    const estimate = computeTaxEstimate({
      country: "KR",
      taxYear,
      events: derived.events,
      excludedEventIds: derived.excludedEventIds.filter((id) => inPeriod.has(id)),
    });

    // gainReturnPercent와 같은 조건: gain 행 + breakdown 존재 + 취득원가(cost) ≠ 0.
    const gainRowsWithBasis = estimate.judgments.filter(
      (row) => row.amountKind === "gain" && row.breakdown !== undefined && Number(row.breakdown.cost) !== 0,
    );
    expect(
      gainRowsWithBasis.length,
      "기준 연도에 취득원가가 잡힌 처분이 있어야 목록 우측에 수익률(%)이 뜬다",
    ).toBeGreaterThan(0);
  });
});
