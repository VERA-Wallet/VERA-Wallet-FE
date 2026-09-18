import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FREE_EXPORT_EVENT_LIMIT, planDefinition, type Plan } from "@/lib/plan/use-plan";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import type { TaxEstimate } from "@/lib/tax/types";

const state = vi.hoisted(() => ({ plan: null as Plan | null }));
const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), estimate: vi.fn(), listRuleSets: vi.fn() }));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEngine: { estimate: ports.estimate, listRuleSets: ports.listRuleSets },
}));

// 저장소 읽기만 대신한다 — 한도표와 잠금 판정은 실제 모듈을 그대로 태운다.
// 여기서 `exportEventAllowance`까지 더블로 바꾸면 화면이 아니라 더블을 검증하게 된다.
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  return { ...actual, usePlan: () => ({ plan: state.plan, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { renderReportPages } from "@/tests/ui/helpers/report-pages";

// 리포트 카드(금액·CTA 판정)를 그리려면 estimate가 필요하다. 값 자체는 검증 대상이 아니고,
// 미구독이어도 금액이 그대로 보이는지(=잠기는 것은 다운로드뿐인지)만 본다.
const estimate: TaxEstimate = {
  country: "KR",
  countryLabel: "한국",
  currency: "KRW",
  taxYear: 2026,
  method: "거주자별 총평균법",
  status: "PARTIAL",
  lines: [
    { key: "income_tax", label: "소득세", amount: "166666.67", rate: "20%" },
    { key: "local_tax", label: "개인지방소득세", amount: "16666.67" },
  ],
  totals: { taxableGains: "833333.33", exemptGains: "0", incomeTotal: "0", taxableBase: "833333.33", estimatedCharge: "183333.34", effectiveRatePercent: "5.5" },
  lossCarryforward: "0",
  notes: [],
  limitations: [],
  openQuestions: [],
  requiredInputs: [],
  excludedEventIds: [],
  provenance: "mock",
  period: { from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" },
  judgments: [
    {
      eventId: "disp",
      at: "2026-06-01T00:00:00.000Z",
      asset: "1:native",
      symbol: "ETH",
      quantity: "1",
      amount: "3000000",
      amountKind: "gain",
      holdingDays: null,
      acquiredAt: null,
      lots: 1,
      leg: "single",
      inPeriod: true,
      group: "taxable",
      label: "과세 · 기타소득 20%",
      basis: "소득세법 제64조의3제2항",
      breakdown: { proceeds: "5000000", cost: "2000000", fee: "0" },
    },
  ],
};

function summaryWith(computableEventCount: number) {
  return {
    periodPnl: "0",
    computableEventCount,
    taxableEventCount: computableEventCount,
    pendingReviewCount: 0,
    currency: "KRW",
    period: { from: "2026-01-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" },
  };
}

const plusPlan: Plan = { tier: "plus", taxYear: 2026, activatedAt: "2026-08-19T00:00:00.000Z" };

function renderWith(computableEventCount: number, plan: Plan | null) {
  state.plan = plan;
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summaryWith(computableEventCount));
  ports.estimate.mockResolvedValue(estimate);
  ports.listRuleSets.mockImplementation(async () => listRuleSetSummaries());
  // 잠금·내려받기는 메인 화면의 일이다 — 근거·확인할 것·설정·비교는 각자의 화면으로 갔다.
  return renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2026, latestActivityYear: 2026 });
}

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getProof.mockReset();
  ports.estimate.mockReset();
  ports.listRuleSets.mockReset();
  state.plan = null;
});

describe("리포트 플랜 잠금", () => {
  it("미구독이어도 계산은 전부 보이고 다운로드만 잠긴다", async () => {
    renderWith(FREE_EXPORT_EVENT_LIMIT, null);

    // 리포트 카드가 뜨고 금액도 그대로 보인다 — Koinly식(2026-09-17 사용자 결정).
    expect(await screen.findByText("기타소득 계산")).toBeInTheDocument();
    expect(screen.getByText("총수입금액")).toBeInTheDocument();
    expect(await screen.findByText("₩5,000,000")).toBeInTheDocument();
    // 금액·신뢰도 블러는 사라졌다. 남아 있으면 `/plan`의 "잠기는 것은 다운로드뿐"이 다시 거짓이 된다.
    expect(screen.queryAllByLabelText("구독 후 공개")).toHaveLength(0);
    expect(document.querySelectorAll('[data-locked="amount"], [data-locked="confidence"]')).toHaveLength(0);
    // "금액과 다운로드는 구독 후 공개됩니다" 배너도 없다 — 하지 않는 잠금을 광고하지 않는다.
    expect(screen.queryByText("플랜을 구독하면 리포트가 열립니다")).toBeNull();
    expect(document.querySelector("[data-surface='plan-cta']")).toBeNull();
    // 대신 내려받기 카드가 무엇이 무료이고 무엇이 결제인지 한 줄로 말한다.
    expect(screen.getByText("계산은 무료예요. 파일로 내려받을 때만 결제해요.")).toBeInTheDocument();
    // 다운로드 두 버튼은 잠긴다(자물쇠 아이콘 + data-locked).
    const csv = screen.getByRole("button", { name: /직접 신고용 내려받기/ });
    await waitFor(() => expect(csv).toBeDisabled());
    expect(csv).toHaveAttribute("data-locked", "download");
    expect(screen.getByRole("button", { name: /세무사 전달용 내려받기/ })).toBeDisabled();
    // 하단 안내는 플랜이 필요하다고 말하고, 플랜은 탭에 없으니 이 링크가 앱 안의 진입로다.
    expect(screen.getByText("무료 플랜 100건까지 · 현재 100건 — 플랜이 필요합니다")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /플랜 보기/ }).length).toBeGreaterThan(0);
    // 파일 행 수와 과금 건수는 다를 수 있다. 캡션은 자기 기준과 자기 수를 함께 말해야 한다.
    expect(screen.getByText(/건수는 계산 대상 이벤트 기준입니다 · 현재 100건/)).toBeInTheDocument();
  });

  it("건수를 아직 모르면 안내도 하지 않는다 — 근거 없는 한도 표기는 하지 않는다", () => {
    state.plan = null;
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getProof.mockResolvedValue(null);
    ports.getSummary.mockReturnValue(new Promise(() => {}));
    ports.estimate.mockReturnValue(new Promise(() => {}));
    ports.listRuleSets.mockImplementation(async () => listRuleSetSummaries());
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2026, latestActivityYear: 2026 });

    expect(screen.queryByRole("link", { name: /플랜 보기/ })).toBeNull();
  });

  it("한도를 넘고 플랜이 없으면 다운로드가 잠기고 플랜으로 가는 문이 열린다", async () => {
    renderWith(250, null);

    const banner = await screen.findByText("무료 플랜 100건까지 · 현재 250건 — 플랜이 필요합니다");
    expect(banner).toBeInTheDocument();
    expect(banner.closest("a")).toHaveAttribute("href", "/plan");
    expect(screen.getByRole("button", { name: "직접 신고용 내려받기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "세무사 전달용 내려받기" })).toBeDisabled();
    // 미리보기는 잠기지 않는다 — 기간·건수 표기는 그대로 보인다.
    expect(screen.getByText(/건수는 계산 대상 이벤트 기준입니다/)).toBeInTheDocument();
  });

  it("플랜이 활성이면 한도까지 다운로드가 열리고 결제 안내 문구가 빠진다", async () => {
    renderWith(250, plusPlan);

    expect(await screen.findByText("₩5,000,000")).toBeInTheDocument();
    // 구독자에게 "계산은 무료예요" 줄은 필요 없다 — 이미 결제했다.
    expect(screen.queryByText("계산은 무료예요. 파일로 내려받을 때만 결제해요.")).toBeNull();
    const csv = screen.getByRole("button", { name: /직접 신고용 내려받기/ });
    await waitFor(() => expect(csv).not.toBeDisabled());
    expect(csv).not.toHaveAttribute("data-locked");
    // 결제한 사용자에게도 남은 한도는 알려 준다 — 다만 재촉 문구는 붙지 않는다.
    expect(screen.getByText("플러스 플랜 1,000건까지 · 현재 250건")).toBeInTheDocument();
  });

  it("활성 플랜의 한도마저 넘으면 다운로드가 잠기고 상위 플랜을 가리킨다", async () => {
    // 카드가 1,000건이라 적어 놓고 무제한으로 열어 주면 광고와 동작이 갈린다.
    renderWith(planDefinition("plus").exportLimit + 1, plusPlan);

    expect(await screen.findByText(/플러스 플랜 1,000건까지 · 현재 1,001건 — 상위 플랜이 필요합니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "직접 신고용 내려받기" })).toBeDisabled();
    // 한도 초과여도 금액은 보인다 — 잠기는 것은 다운로드다.
    expect(await screen.findByText("₩5,000,000")).toBeInTheDocument();
  });
});
