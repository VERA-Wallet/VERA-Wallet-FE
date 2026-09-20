import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FREE_EXPORT_EVENT_LIMIT, planDefinition, type Plan } from "@/lib/plan/use-plan";
import type { TaxEstimate } from "@/lib/tax/types";

const state = vi.hoisted(() => ({ plan: null as Plan | null }));
const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), estimate: vi.fn() }));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  // 계산 근거 기록은 체인 왕복이라 화면 테스트에서는 "기록 없음"(null)으로 고정한다.
  taxEvidenceProvider: { latest: async () => null, record: async () => { throw new Error("not used"); }, checkChain: async () => { throw new Error("not used"); } },
  taxEngine: { estimate: ports.estimate },
}));

// 저장소 읽기만 대신한다 — 한도표와 잠금 판정은 실제 모듈을 그대로 태운다.
// 여기서 `exportEventAllowance`까지 더블로 바꾸면 화면이 아니라 더블을 검증하게 된다.
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  return { ...actual, usePlan: () => ({ plan: state.plan, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { ExportView } from "@/components/export/export-view";

// 리포트 카드(금액 마스킹·CTA 판정)를 그리려면 estimate가 필요하다. 값 자체는 검증 대상이 아니고,
// 미구독일 때 라인이 마스킹되는지(구독일 때 실제 값이 보이는지)만 본다.
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
  return render(<ExportView countryCode="KR" />);
}

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getProof.mockReset();
  ports.estimate.mockReset();
  state.plan = null;
});

describe("내보내기 플랜 잠금", () => {
  it("미구독이면 한도 안이라도 금액을 잠그고 CTA를 띄우며 다운로드를 막는다", async () => {
    renderWith(FREE_EXPORT_EVENT_LIMIT, null);

    // 리포트 카드는 뜨되 금액 라인은 마스킹된다 — 라벨은 그대로 보여 무엇이 담기는지는 알 수 있다.
    expect(await screen.findByText("기타소득 계산")).toBeInTheDocument();
    expect(screen.getByText("총수입금액")).toBeInTheDocument();
    expect(screen.getAllByLabelText("구독 후 공개").length).toBeGreaterThan(0);
    // 실제 금액은 마스킹되어 보이지 않는다.
    expect(screen.queryByText("₩5,000,000")).toBeNull();
    // 플랜 CTA 배너가 리포트 위에 뜨고 /plan으로 보낸다.
    const cta = screen.getByText("플랜을 구독하면 리포트가 열립니다").closest("a");
    expect(cta).toHaveAttribute("href", "/plan");
    // 다운로드 두 버튼은 잠긴다(자물쇠 아이콘 + data-locked).
    const csv = screen.getByRole("button", { name: /직접 신고용 내려받기/ });
    await waitFor(() => expect(csv).toBeDisabled());
    expect(csv).toHaveAttribute("data-locked", "download");
    expect(screen.getByRole("button", { name: /세무사 전달용 내려받기/ })).toBeDisabled();
    // 하단 안내는 플랜이 필요하다고 말하고, 플랜은 탭에 없으니 이 링크가 앱 안의 진입로다.
    expect(screen.getByText("무료 플랜 100건까지 · 현재 100건 (플랜 필요)")).toBeInTheDocument();
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
    render(<ExportView countryCode="KR" />);

    expect(screen.queryByRole("link", { name: /플랜 보기/ })).toBeNull();
  });

  it("한도를 넘고 플랜이 없으면 다운로드가 잠기고 플랜으로 가는 문이 열린다", async () => {
    renderWith(250, null);

    const banner = await screen.findByText("무료 플랜 100건까지 · 현재 250건 (플랜 필요)");
    expect(banner).toBeInTheDocument();
    expect(banner.closest("a")).toHaveAttribute("href", "/plan");
    expect(screen.getByRole("button", { name: "직접 신고용 내려받기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "세무사 전달용 내려받기" })).toBeDisabled();
    // 미리보기는 잠기지 않는다 — 기간·건수 표기는 그대로 보인다.
    expect(screen.getByText(/건수는 계산 대상 이벤트 기준입니다/)).toBeInTheDocument();
  });

  it("플랜이 활성이면 금액이 열리고 한도까지 다운로드가 다시 열린다", async () => {
    renderWith(250, plusPlan);

    // 구독하면 마스킹이 걷히고 실제 금액이 보인다.
    expect(await screen.findByText("₩5,000,000")).toBeInTheDocument();
    expect(screen.queryByLabelText("구독 후 공개")).toBeNull();
    // CTA 배너는 구독자에겐 뜨지 않는다.
    expect(screen.queryByText("플랜을 구독하면 리포트가 열립니다")).toBeNull();
    const csv = screen.getByRole("button", { name: /직접 신고용 내려받기/ });
    await waitFor(() => expect(csv).not.toBeDisabled());
    expect(csv).not.toHaveAttribute("data-locked");
    // 결제한 사용자에게도 남은 한도는 알려 준다 — 다만 재촉 문구는 붙지 않는다.
    expect(screen.getByText("플러스 플랜 1,000건까지 · 현재 250건")).toBeInTheDocument();
  });

  it("활성 플랜의 한도마저 넘으면 다운로드가 잠기고 상위 플랜을 가리킨다", async () => {
    // 카드가 1,000건이라 적어 놓고 무제한으로 열어 주면 광고와 동작이 갈린다.
    renderWith(planDefinition("plus").exportLimit + 1, plusPlan);

    expect(await screen.findByText(/플러스 플랜 1,000건까지 · 현재 1,001건 \(상위 플랜 필요\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "직접 신고용 내려받기" })).toBeDisabled();
    // 한도 초과여도 구독자는 금액을 본다 — 잠기는 것은 다운로드다.
    expect(await screen.findByText("₩5,000,000")).toBeInTheDocument();
  });
});
