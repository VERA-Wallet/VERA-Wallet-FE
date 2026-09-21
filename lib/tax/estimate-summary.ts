import { ZERO, round, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import type { TaxEstimate } from "@/lib/tax/types";

/**
 * estimate 하나에서 대시보드 헤드라인 숫자를 파생한다.
 *
 * 대시보드는 예전에 `store.summary()`(이벤트 직접 집계·연도 무관·순현금흐름)로 손익을 냈고,
 * 세금 화면은 tax-engine estimate(귀속연도 원장 lot 매칭·총평균)로 냈다. 두 경로가 갈려
 * 같은 귀속연도에 다른 손익·건수를 말했다(엔진이 총평균으로 바뀌며 더 벌어졌다).
 *
 * 그래서 대시보드도 이 함수로 **같은 estimate**에서 손익·건수를 파생한다 —
 * 같은 귀속연도에서 세 화면(대시보드·세금·내보내기)이 한 숫자를 말한다.
 */
export type EstimateHeadline = {
  /**
   * 실현 손익 = 이번 과세기간에 인식한 처분 손익(gain 판정) 합계.
   * 원장이 lot 매칭·총평균으로 낸 값을 그대로 읽는다 — 순현금흐름 근사가 아니라 엔진의 손익이다.
   * gain 판정은 항상 기간 내 행이므로(engine.ts가 기간 밖 손익을 인식하지 않는다) 따로 기간을 자르지 않는다.
   */
  periodPnl: Decimal;
  /**
   * 손익·소득 인식에 실제로 들어간 이벤트 수(기간 내 판정 행의 고유 이벤트).
   * 원가 추적용으로 실린 기간 밖 취득은 `inPeriod === false`라 세지 않는다.
   */
  computableEventCount: number;
};

export function estimateHeadline(estimate: TaxEstimate): EstimateHeadline {
  const gainAmounts = estimate.judgments
    .filter((row) => row.amountKind === "gain")
    .map((row) => row.amount);
  const computableEvents = new Set(
    estimate.judgments.filter((row) => row.inPeriod).map((row) => row.eventId),
  );
  return {
    // 표시 반올림은 화면(formatFiat)이 하지만, 파생값 자체도 2자리로 고정해 원장 총합과 어긋나지 않게 한다.
    periodPnl: gainAmounts.length > 0 ? round(sum(gainAmounts), 2) : ZERO,
    computableEventCount: computableEvents.size,
  };
}

/**
 * 이 답이 얼마나 흔들리는지의 요약 — 대시보드 신뢰도 칩(P1-9)이 읽는다.
 *
 * 세금 화면은 "확인이 필요한 거래" 패널로 한계를 낱낱이 보이지만, 대시보드는 헤드라인 옆에
 * 건수만 압축해 보인다. 문구를 지어내지 않고 estimate의 구조(limitations·excludedEventIds·status)에서만 파생한다.
 */
export type EstimateConfidence = {
  /** 계산에서 빠진(미반영) 이벤트 수. `excludedEventIds`가 진실원천이다. */
  notReflected: number;
  /** 원장에 없는 수량을 취득가액 0으로 계산한 이벤트 수(`zero_basis` 한계의 고유 이벤트). */
  zeroBasis: number;
  /** 부분확정(PARTIAL) — 단가·부담이 아직 잠정이라는 뜻(부분집계). */
  partial: boolean;
};

export function estimateConfidence(estimate: TaxEstimate): EstimateConfidence {
  const zeroBasisEvents = new Set(
    estimate.limitations.filter((row) => row.kind === "zero_basis").flatMap((row) => row.eventIds),
  );
  return {
    notReflected: estimate.excludedEventIds.length,
    zeroBasis: zeroBasisEvents.size,
    partial: estimate.status === "PARTIAL",
  };
}

/** 신뢰도 칩을 그릴 게 하나라도 있는가. 없으면(정상) 칩 자체를 달지 않는다. */
export function hasConfidenceSignal(confidence: EstimateConfidence): boolean {
  return confidence.notReflected > 0 || confidence.zeroBasis > 0 || confidence.partial;
}
