import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaxEstimate } from "@/lib/tax/types";
import type { EvidenceRecord } from "@/lib/ports/tax-evidence";
import { buildEvidenceDocument } from "@/lib/tax/evidence";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), estimate: vi.fn(), latest: vi.fn() }));
const print = vi.hoisted(() => ({ printReportHtml: vi.fn<(html: string) => "window" | "unavailable">(() => "window") }));
vi.mock("@/lib/export/print", () => print);

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: async () => null },
  taxEvidenceProvider: { latest: ports.latest, record: async () => { throw new Error("not used"); }, checkChain: async () => { throw new Error("not used"); } },
  taxEngine: { estimate: ports.estimate },
}));

// 플랜은 테스트마다 바꿔 본다 — 잠금 화면과 열린 화면이 같은 컴포넌트에서 갈린다.
const planState = vi.hoisted(() => ({ plan: null as null | { tier: "plus" | "pro"; taxYear: number; activatedAt: string } }));
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  return { ...actual, usePlan: () => ({ plan: planState.plan, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { ReportView } from "@/components/export/report-view";

const estimate: TaxEstimate = {
  country: "KR",
  countryLabel: "한국",
  currency: "KRW",
  taxYear: 2027,
  method: "거주자별 총평균법",
  status: "PARTIAL",
  lines: [
    { key: "income_tax", label: "소득세", amount: "166666.67", rate: "20%", basis: "소득세법 제64조의3제2항" },
    { key: "local_tax", label: "개인지방소득세", amount: "16666.67" },
  ],
  totals: { taxableGains: "833333.33", exemptGains: "0", incomeTotal: "0", taxableBase: "833333.33", estimatedCharge: "183333.34", effectiveRatePercent: "5.5" },
  lossCarryforward: "0",
  notes: ["가격을 모르는 거래 1건은 계산에서 뺐습니다."],
  limitations: [],
  openQuestions: [],
  requiredInputs: ["2026-12-31 시가(의제취득가액)"],
  excludedEventIds: [],
  provenance: "mock",
  period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
  judgments: [
    {
      eventId: "acq", at: "2027-03-01T00:00:00.000Z", asset: "1:native", symbol: "ETH",
      quantity: "1", amount: "2000000", amountKind: "cost", holdingDays: null, acquiredAt: null, lots: 1, leg: "single",
      inPeriod: true, group: "cost", label: "취득 · 원가 추적", basis: "",
    },
    {
      eventId: "disp", at: "2027-06-01T00:00:00.000Z", asset: "1:native", symbol: "ETH",
      quantity: "1", amount: "3000000", amountKind: "gain", holdingDays: null, acquiredAt: null, lots: 1, leg: "single",
      inPeriod: true, group: "taxable", label: "과세 · 기타소득 20%", basis: "소득세법 제64조의3제2항",
      breakdown: { proceeds: "5000000", cost: "2000000", fee: "0" },
    },
  ],
} as TaxEstimate;

const summary = {
  periodPnl: "3000000", computableEventCount: 2, taxableEventCount: 1, pendingReviewCount: 0,
  currency: "KRW", period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
};

function recordOf(merkleRoot: string): EvidenceRecord {
  return {
    merkleRoot, countryCode: "KR", taxYear: 2027, leafCount: 3, recordedAt: "2027-07-01T00:00:00.000Z",
    anchorStatus: "anchored", txHash: `0x${"ab".repeat(32)}`, blockNumber: "42", anchoredAt: "2027-07-01T00:00:00.000Z", explorerUrl: null,
  };
}

beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset();
  print.printReportHtml.mockClear();
  print.printReportHtml.mockReturnValue("window");
  planState.plan = { tier: "pro", taxYear: 2027, activatedAt: "2027-01-01T00:00:00.000Z" };
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getSummary.mockResolvedValue(summary);
  ports.estimate.mockResolvedValue(estimate);
  ports.latest.mockResolvedValue(null);
});

describe("보고서 앱 화면", () => {
  it("종이와 같은 순서로 표지·신고 요약·자산별 명세·예외·한계를 앱 컬럼 안에 그린다", async () => {
    render(<ReportView countryCode="KR" taxYear={2027} />);

    expect(await screen.findByRole("heading", { name: "기타소득 신고 근거자료" })).toBeInTheDocument();
    await waitFor(() => expect(ports.estimate).toHaveBeenCalledWith(expect.objectContaining({ country: "KR", taxYear: 2027, source: "wallet" })));
    expect(await screen.findByText("2027년 귀속 · 한국 · 거주자별 총평균법")).toBeInTheDocument();
    // 결론 밴드와 신고 요약의 합계는 같은 빌더에서 나온 같은 금액이다.
    expect(screen.getAllByText("₩183,333.34").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("1. 신고 요약")).toBeInTheDocument();
    expect(screen.getByText("총수입금액")).toBeInTheDocument();
    // 세율 줄은 카드에서는 빠지지만 보고서에는 종이처럼 남는다.
    expect(screen.getByText("세율")).toBeInTheDocument();
    // 자산별 명세는 표가 아니라 자산 카드다 — ETH 한 장, 손익 3,000,000.
    expect(screen.getByText("2. 자산별 취득가액 명세")).toBeInTheDocument();
    expect(screen.getByText("ETH")).toBeInTheDocument();
    expect(screen.getAllByText("3,000,000").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("3. 예외 · 판단보류")).toBeInTheDocument();
    expect(screen.getByText("4. 계산 근거와 한계")).toBeInTheDocument();
    expect(screen.getByText("2026-12-31 시가(의제취득가액)")).toBeInTheDocument();
    // 앱 컬럼 폭 — 종이의 210mm가 아니라 다른 화면과 같은 max-w-md.
    expect(document.querySelector('[data-surface="report-view"]')).toHaveClass("max-w-md");
  });

  it("PDF로 저장이 화면과 같은 estimate로 만든 인쇄용 문서를 넘긴다", async () => {
    render(<ReportView countryCode="KR" taxYear={2027} />);
    await screen.findByText("2027년 귀속 · 한국 · 거주자별 총평균법");

    const [button] = screen.getAllByRole("button", { name: "PDF로 저장" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => expect(print.printReportHtml).toHaveBeenCalledTimes(1));
    const html = print.printReportHtml.mock.calls[0][0];
    expect(html).toContain("기타소득 신고 근거자료");
    expect(html).toContain("2027년 귀속 · 한국 · 거주자별 총평균법");
    expect(html).toContain("₩183,333.34");
    expect(html).toContain("<title>verawallet-신고근거-2027년귀속-");
  });

  it("인쇄 창이 막히면 그 사실을 말하고 다른 내려받기를 권한다", async () => {
    print.printReportHtml.mockReturnValue("unavailable");
    render(<ReportView countryCode="KR" taxYear={2027} />);
    await screen.findByText("2027년 귀속 · 한국 · 거주자별 총평균법");

    fireEvent.click(screen.getAllByRole("button", { name: "PDF로 저장" })[0]);

    expect(await screen.findByText(/인쇄 창을 열지 못했습니다/)).toBeInTheDocument();
  });

  it("체인 기록이 지금 계산과 같을 때만 머클루트를 싣고 근거 화면으로 잇는다", async () => {
    const root = buildEvidenceDocument(estimate).merkleRoot;
    ports.latest.mockResolvedValue(recordOf(root));
    render(<ReportView countryCode="KR" taxYear={2027} />);

    expect(await screen.findByText("OmniOne 체인 기록")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /체인에서 직접 확인/ })).toHaveAttribute("href", `/export/evidence/${root}`);

    // 종이도 같은 규칙 — 지금 계산과 같은 기록만 싣는다.
    fireEvent.click(screen.getAllByRole("button", { name: "PDF로 저장" })[0]);
    await waitFor(() => expect(print.printReportHtml).toHaveBeenCalledTimes(1));
    expect(print.printReportHtml.mock.calls[0][0]).toContain(root);
  });

  it("기록 뒤에 계산이 바뀌었으면(루트 불일치) 옛 기록을 보고서에 싣지 않는다", async () => {
    ports.latest.mockResolvedValue(recordOf(`0x${"cd".repeat(32)}`));
    render(<ReportView countryCode="KR" taxYear={2027} />);
    await screen.findByText("2027년 귀속 · 한국 · 거주자별 총평균법");

    expect(screen.queryByText("OmniOne 체인 기록")).toBeNull();

    // 대조에 실패할 해시를 종이에 남기지 않는다.
    fireEvent.click(screen.getAllByRole("button", { name: "PDF로 저장" })[0]);
    await waitFor(() => expect(print.printReportHtml).toHaveBeenCalledTimes(1));
    const html = print.printReportHtml.mock.calls[0][0];
    expect(html).not.toContain(`0x${"cd".repeat(32)}`);
    expect(html).not.toContain("OmniOne 체인 기록");
  });

  it("시행 가정으로 열면 결론 옆에 가정이라는 사실이 붙고 estimate 요청에도 실린다", async () => {
    render(<ReportView countryCode="KR" taxYear={2027} assumeEffective />);
    await screen.findByText("2027년 귀속 · 한국 · 거주자별 총평균법");

    await waitFor(() => expect(ports.estimate).toHaveBeenCalledWith(expect.objectContaining({ assumeEffective: true })));
    expect(screen.getByText(/시행 가정:/)).toBeInTheDocument();
  });

  it("미구독이면 금액 없이 잠금 안내와 플랜 링크만 보인다", async () => {
    planState.plan = null;
    render(<ReportView countryCode="KR" taxYear={2027} />);

    expect(await screen.findByText("플랜을 구독하면 보고서가 열립니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /플랜 보기/ })).toHaveAttribute("href", "/plan");
    expect(screen.queryByText("1. 신고 요약")).toBeNull();
    expect(screen.queryByText("₩183,333.34")).toBeNull();
  });
});
