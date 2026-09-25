"use client";

import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEventList, useEventSummary } from "@/lib/queries/events";
import { taxYearFor } from "@/lib/tax/engine";

import { groupJudgments, type GroupRow } from "@/components/report/why-this-amount";
import { anchorProofProvider } from "@/lib/composition-root.client";
import type { SummaryDTO } from "@/lib/http/dto";
import type { Provenance } from "@/lib/http/envelope";
import { exportEventAllowance, planDefinition, usePlan } from "@/lib/plan/use-plan";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { omitsCharge } from "@/lib/tax/status";
import { useReportInputs, type ReportInputs, type ReportInputsOptions } from "@/lib/tax/use-report-inputs";

/**
 * 리포트 한 벌(`/export`와 그 하위 화면)이 공유하는 계산 결과.
 *
 * 화면을 기능별로 쪼갰어도 **estimate는 계속 하나여야 한다**. 페이지마다 `useReportInputs`를 부르면
 * 설정 화면에서 넣은 연말 시가가 메인의 예상 부담에 닿지 않고, 같은 귀속연도에 두 금액이 생긴다.
 * 그래서 훅은 여기서 딱 한 번 부르고, 각 페이지는 context만 읽는다.
 *
 * 이 프로바이더는 `app/export/layout.tsx`가 얹는다. Next 문서가 명시하듯 layout은
 * "On navigation, layouts preserve state, remain interactive, and do not rerender"
 * (`node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`)이고,
 * "Layouts are cached in the client during navigation... Layouts do not rerender"
 * (`.../03-api-reference/03-file-conventions/layout.md`)다. 그래서 `/export` ↔ `/export/settings`를
 * 클라이언트 내비게이션으로 오가도 이 상태(나라·source·시행 가정·프로필·연말 시가)는 살아남는다.
 *
 * 원장·요약·앵커 증명도 같은 이유로 여기서 한 번만 읽는다 — 페이지를 옮길 때마다 다시 부르면
 * 같은 화면 묶음이 매번 다른 스냅샷을 말하게 된다.
 */
export type ReportContextValue = ReportInputs & {
  events: NormalizedEvent[];
  summary: SummaryDTO | null;
  proof: Awaited<ReturnType<typeof anchorProofProvider.getProof>>;
  /** 응답에 출처가 실려 오지 않는 표면(앵커 증명 등)용. 서버 layout이 BE 모드를 물어 계산해 준다. */
  provenance: Provenance;
  /** 내보내기 = 파일 해시 온체인 등록 게이트. 서버 layout이 `reportAnchorGateEnabled()`로 계산해 내려준다. */
  gateEnabled: boolean;
  /** 원장·요약·증명 읽기가 실패했을 때의 메시지. 계산(estimate) 실패와는 다른 사실이다. */
  ledgerError: string | null;
  ready: boolean;
  activePeriod: SummaryDTO["period"] | null;
  plan: ReturnType<typeof usePlan>["plan"];
  planName: string;
  subscribed: boolean;
  allowance: number;
  billableCount: number;
  downloadLocked: boolean;
  gaugePercent: number;
  nudgeCount: number;
  comparingLabel: string | null;
  blockedReason: string | null;
  groups: GroupRow[];
  showReportCard: boolean;
  /** 비교 중일 때 거주국으로 돌아가는 동작. 거주국을 모르면 아무 일도 하지 않는다. */
  returnHome: () => void;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportInputsProvider({
  children,
  countryCode,
  currentYear = new Date().getFullYear(),
  latestActivityYear,
  walletConnected = true,
  provenance = "mock",
  gateEnabled = true,
}: ReportInputsOptions & { children: React.ReactNode; provenance?: Provenance; gateEnabled?: boolean }) {
  const ledger = useEventList(50, walletConnected);
  const summaryQuery = useEventSummary(walletConnected);
  const items = walletConnected ? ledger.data?.rawItems : undefined;
  const events = useMemo(() => items?.map(({ event }) => event) ?? [], [items]);
  const activityYear = useMemo(() => {
    const latest = ledger.data?.items.reduce<string | null>((max, { event }) =>
      max === null || Date.parse(event.block_timestamp) > Date.parse(max) ? event.block_timestamp : max, null);
    return latest && countryCode ? taxYearFor(countryCode, latest) : undefined;
  }, [ledger.data, countryCode]);
  const ledgerError = walletConnected
    ? ledger.error?.message ?? summaryQuery.error?.message ?? (ledger.data?.truncated ? "거래 내역을 모두 불러오지 못했습니다." : null)
    : null;
  const inputs = useReportInputs({ countryCode, currentYear,
    latestActivityYear: latestActivityYear ?? activityYear, walletConnected,
    dataReady: !walletConnected || (ledger.isSuccess && !ledger.data.truncated),
  });
  const { result, hasNothingToCompute, country, homeCountry, isHomeCountry, selected, setCountry, source } = inputs;
  const summary = walletConnected ? summaryQuery.data ?? null : null;
  const firstEventId = items?.[0]?.event.id;
  const proofQuery = useQuery({
    queryKey: ["events", "anchor-proof", firstEventId],
    queryFn: () => anchorProofProvider.getProof(firstEventId!),
    enabled: walletConnected && firstEventId !== undefined,
  });
  // An anchor request must not hold already loaded ledger/summary data hostage.
  // A missing or failed proof remains null; it is never represented as verified.
  const proof = firstEventId ? proofQuery.data ?? null : null;
  const { plan } = usePlan();

  const ready = walletConnected && ledger.isSuccess && !ledger.data.truncated && summary !== null && ledgerError === null;
  // 파일명·기간 라벨은 선택 연도를 따른다 — estimate.period가 선택 연도의 과세기간을 싣는다.
  const activePeriod = result?.period ?? summary?.period ?? null;

  // 과금 기준은 계산 대상 이벤트 수다(`SummaryDTO.computableEventCount`) — 화면에 보이는 행 수가 아니다.
  const billableCount = summary?.computableEventCount ?? 0;
  const allowance = exportEventAllowance(plan);
  const planName = plan === null ? "무료" : planDefinition(plan.tier).name;
  // 유료 플랜(plan !== null)이 있어야 구독으로 본다.
  const subscribed = plan !== null;
  // 요약을 아직 못 읽었으면 잠그지 않는다 — 건수를 모르는 상태의 자물쇠는 근거 없는 자물쇠다.
  const locked = summary !== null && billableCount > allowance;
  // 다운로드 잠금은 두 조건의 OR다: 미구독이면 무조건 잠기고, 구독 중이어도 allowance를 넘으면 잠긴다.
  const downloadLocked = !subscribed || locked;
  // 구독 상태 카드의 게이지 값(0~100). 한도를 넘어도 막대는 100%에서 멈춘다 — 초과 사실 자체는
  // 위의 downloadLocked·안내 문구가 이미 말하므로, 막대가 그릇 밖으로 넘치는 모양을 만들지 않는다.
  const gaugePercent = summary !== null ? Math.min(Math.round((billableCount / allowance) * 100), 100) : 0;

  // 확인 필요 N = 미반영(excludedEventIds) + 원가 0원(zero_basis) 이벤트, 중복은 한 번만 센다.
  const nudgeCount = result
    ? new Set<string>([
        ...result.excludedEventIds,
        ...result.limitations.filter((limitation) => limitation.kind === "zero_basis").flatMap((limitation) => limitation.eventIds),
      ]).size
    : 0;

  // 거주국이 아닌 나라를 보고 있으면 그것은 비교다. 그 사실은 금액 옆과 내려받기 양쪽에서 말한다.
  const comparingLabel = homeCountry !== null && !isHomeCountry ? (selected?.label ?? country) : null;
  // 잠금(플랜)과 다른 이유로 파일을 만들 수 없는 경우. 자물쇠가 아니라 사실을 말한다.
  // 출처를 바꾸는 자리가 "아래 계산 조건"에서 별도 화면(계산 설정)으로 옮겨졌으므로 그 자리도 그렇게 말한다.
  const blockedReason = !walletConnected
    ? "지갑을 연결하면 내 거래로 신고 근거자료를 만들 수 있습니다."
    : source === "scenario"
      ? "데모 시나리오는 내 지갑 데이터가 아니라 파일로 만들지 않습니다. 계산 설정에서 “내 지갑 이벤트”로 바꾸면 내려받을 수 있습니다."
      : comparingLabel !== null
        ? `지금은 ${comparingLabel} 기준으로 비교 중입니다. 신고 근거자료는 거주국 기준으로만 만듭니다.`
        : null;

  // 셀 것이 없다고 말해놓고 옛 취득 그룹을 금액과 함께 보이면 두 이야기를 한다.
  const groups = result && !hasNothingToCompute ? groupJudgments(result) : [];
  // 부담을 산출하지 않았거나 셀 것이 없는 기간에 신고 기입란 8줄을 0원으로 깔면
  // 요약이 "과세 대상 아님"이라 해놓고 카드는 "예상 부담 ₩0"이라 말하게 된다.
  const showReportCard = result !== undefined && !omitsCharge(result.status) && !hasNothingToCompute;

  // 값 객체는 매 렌더 새로 만든다. 이 트리는 프로바이더 → 페이지 한 겹이라
  // 메모이제이션이 버는 것이 없고, 의존성 목록을 손으로 적다 빠뜨리면 화면이 옛 값을 말한다.
  const value: ReportContextValue = {
    ...inputs,
    events,
    summary,
    proof,
    provenance,
    gateEnabled,
    ledgerError,
    ready,
    activePeriod,
    plan,
    planName,
    subscribed,
    allowance,
    billableCount,
    downloadLocked,
    gaugePercent,
    nudgeCount,
    comparingLabel,
    blockedReason,
    groups,
    showReportCard,
    returnHome: () => { if (homeCountry !== null) setCountry(homeCountry); },
  };

  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}

/**
 * 리포트 화면 묶음이 공유하는 계산 결과를 읽는다.
 *
 * 프로바이더 밖에서 부르면 던진다 — 조용히 빈 값으로 물러나면 "계산 결과가 없는 화면"과
 * "프로바이더를 안 감싼 화면"이 똑같이 보여서, 배선이 끊긴 것을 아무도 모른다.
 */
export function useReportContext(): ReportContextValue {
  const value = useContext(ReportContext);
  if (value === null) throw new Error("useReportContext는 ReportInputsProvider 안에서만 쓸 수 있습니다.");
  return value;
}
