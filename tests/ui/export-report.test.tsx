import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaxEstimate } from "@/lib/tax/types";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), estimate: vi.fn() }));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEngine: { estimate: ports.estimate },
}));

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
    // 세무사 전달용 카드가 4시트가 무엇을 담는지 말한다(취득가액 명세·예외는 이 카드에만 있다).
    expect(screen.getByText(/취득가액 명세/)).toBeInTheDocument();
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
});
