import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaxEstimate } from "@/lib/tax/types";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), estimate: vi.fn() }));
// 인쇄는 jsdom에 없다. 화면의 책임은 "무엇을 인쇄로 넘기는가"뿐이라 그 경계만 더블로 잡는다.
const print = vi.hoisted(() => ({ printReportHtml: vi.fn<(html: string) => "window">(() => "window") }));
vi.mock("@/lib/export/print", () => print);

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  // 계산 근거 기록은 체인 왕복이라 화면 테스트에서는 "기록 없음"(null)으로 고정한다.
  taxEvidenceProvider: { latest: async () => null, record: async () => { throw new Error("not used"); }, checkChain: async () => { throw new Error("not used"); } },
  taxEngine: { estimate: ports.estimate },
}));

// 리포트 금액 노출은 이제 구독을 전제로 한다 — 활성 플랜을 심어야 금액이 마스킹 없이 보인다.
// 한도표·잠금 판정은 실제 모듈을 그대로 태운다(usePlan만 더블로 바꾼다).
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  const plusPlan = { tier: "plus" as const, taxYear: 2027, activatedAt: "2027-01-01T00:00:00.000Z" };
  return { ...actual, usePlan: () => ({ plan: plusPlan, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { ExportView } from "@/components/export/export-view";

const estimate: TaxEstimate = {
  country: "KR",
  countryLabel: "한국",
  currency: "KRW",
  taxYear: 2027,
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
  period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
  judgments: [
    {
      eventId: "disp",
      at: "2027-06-01T00:00:00.000Z",
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

const summary = {
  periodPnl: "3000000",
  computableEventCount: 1,
  taxableEventCount: 1,
  pendingReviewCount: 0,
  currency: "KRW",
  period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
};

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getProof.mockReset();
  ports.estimate.mockReset();
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summary);
  ports.estimate.mockResolvedValue(estimate);
  print.printReportHtml.mockClear();
});

describe("내보내기 estimate 배선", () => {
  it("거주국·귀속연도로 estimate를 요청해 그룹형 리포트를 estimate에서 파생한다", async () => {
    render(<ExportView countryCode="KR" />);

    expect(await screen.findByText("기타소득 계산")).toBeInTheDocument();
    // 요약 기간의 시작 연도(2027)를 귀속연도로, 거주국(KR)을 그대로 요청한다.
    await waitFor(() => expect(ports.estimate).toHaveBeenCalledWith(expect.objectContaining({ country: "KR", taxYear: 2027, source: "wallet" })));
    // 귀속연도 칩과 PARTIAL 잠정 배지.
    expect(screen.getByText("2027년 귀속")).toBeInTheDocument();
    expect(screen.getByText("잠정")).toBeInTheDocument();
    // 그룹형 라인은 buildFilingSummary(estimate)에서 파생한다 — 하드코딩이 아니다.
    expect(screen.getByText("총수입금액")).toBeInTheDocument();
    expect(screen.getByText("기타소득금액")).toBeInTheDocument();
    expect(screen.getByText("과세표준")).toBeInTheDocument();
    expect(screen.getByText("예상 부담")).toBeInTheDocument();
    // 총수입금액 = Σ양도가액(5,000,000), 예상 부담 = 소득세+지방소득세(183,333.34).
    expect(screen.getByText("₩5,000,000")).toBeInTheDocument();
    expect(screen.getByText("₩183,333.34")).toBeInTheDocument();
    // 취득가액 명세는 이제 PDF 보고서 카드와 XLSX 카드가 함께 말한다(둘 다 같은 빌더에서 나온다).
    expect(screen.getAllByText(/취득가액 명세/).length).toBeGreaterThanOrEqual(2);
    // 4시트가 무엇을 담는지는 세무사 전달용 카드만 말한다.
    expect(screen.getByText(/판단보류·미반영/)).toBeInTheDocument();
    // 거래 부속명세는 직접 신고용(CSV)·세무사 전달용(원장) 두 카드에 모두 담긴다.
    expect(screen.getAllByText(/거래 부속명세/).length).toBeGreaterThanOrEqual(1);
  });

  it("확인 필요 신호가 없으면 넛지 배너를 그리지 않는다", async () => {
    render(<ExportView countryCode="KR" />);
    await screen.findByText("기타소득 계산");
    // 기본 fixture는 excludedEventIds·zero_basis가 비어 있어 확인 필요 배너가 뜨지 않는다.
    expect(screen.queryByRole("link", { name: /확인 필요/ })).toBeNull();
  });

  it("미반영 이벤트가 있으면 확인 필요 배너로 대시보드 큐를 가리킨다", async () => {
    ports.estimate.mockResolvedValue({ ...estimate, excludedEventIds: ["evt-a", "evt-b"] });
    render(<ExportView countryCode="KR" />);

    const banner = await screen.findByRole("link", { name: /확인 필요 2건/ });
    expect(banner).toHaveAttribute("href", "/dashboard");
  });

  it("세무사 전달용 다운로드가 estimate 기반 근거자료 파일을 만든다", async () => {
    render(<ExportView countryCode="KR" />);
    await screen.findByText("기타소득 계산");

    const clicked: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    URL.createObjectURL = () => "blob:stub";
    URL.revokeObjectURL = () => {};
    try {
      fireEvent.click(screen.getByRole("button", { name: /세무사 전달용 내려받기/ }));
      await waitFor(() => expect(clicked.length).toBeGreaterThan(0));
      expect(clicked[0]).toContain("신고근거");
      expect(clicked[0]).toMatch(/\.xlsx$/);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  it("보고서 보기가 같은 귀속연도의 앱 화면 보고서로 보낸다 — 새 탭 인쇄가 첫 답이 아니다", async () => {
    render(<ExportView countryCode="KR" />);
    await screen.findByText("기타소득 계산");

    const link = await screen.findByRole("link", { name: "보고서 보기" });
    expect(link).toHaveAttribute("href", "/export/report?year=2027");
    // 이 화면은 더 이상 인쇄를 직접 띄우지 않는다 — PDF는 보고서 화면의 몫이다.
    expect(print.printReportHtml).not.toHaveBeenCalled();
  });
});
