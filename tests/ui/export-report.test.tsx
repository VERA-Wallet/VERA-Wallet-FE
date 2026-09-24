import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import { createTaxScenarioEvents, scenarioScaleFor } from "@/lib/tax/scenarios";
import { ruleSetListSchema, taxEstimateSchema } from "@/lib/http/tax-dto";
import type { TaxEstimateRequest } from "@/lib/ports/tax-engine";
import type { TaxEstimate } from "@/lib/tax/types";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), latest: vi.fn(), estimate: vi.fn(), listRuleSets: vi.fn(), document: vi.fn(), record: vi.fn() }));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  // 게이트가 기본 켜짐이라 내려받기가 묶음 루트 조회를 먼저 탄다. 이 파일의 관심사는 파일 내용이므로
  // 조회가 곧바로 `anchored`를 돌려주게 해 시트 없이 저장까지 가게 둔다(등록 흐름 자체는 export-anchor-gate가 덮는다).
  taxEvidenceProvider: { document: ports.document, latest: ports.latest, record: ports.record },
  taxEngine: { estimate: ports.estimate, listRuleSets: ports.listRuleSets },
}));

// 다운로드는 구독 전제다 — 활성 플랜을 심어야 버튼이 열려 파일명 검증까지 도달한다.
// 한도표·잠금 판정은 실제 모듈을 그대로 태운다(usePlan만 더블로 바꾼다).
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  const plusPlan = { tier: "plus" as const, taxYear: 2027, activatedAt: "2027-01-01T00:00:00.000Z" };
  return { ...actual, usePlan: () => ({ plan: plusPlan, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { renderReportPages } from "@/tests/ui/helpers/report-pages";

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

/**
 * 이 파일이 보는 것은 "estimate 하나가 화면 묶음 전체를 채우는가"다.
 * 그래서 다섯 화면을 한 프로바이더 아래 함께 세운다 — 프로덕션에서 layout이 하는 일과 같다.
 * (답·내려받기는 메인, 확인 필요 넛지는 확인할 것, 연말 시가는 계산 설정에 산다.)
 */
function renderReport() {
  return renderReportPages({ countryCode: "KR", currentYear: 2027, latestActivityYear: 2027 });
}

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getProof.mockReset();
  ports.estimate.mockReset();
  ports.listRuleSets.mockReset();
  ports.document.mockReset();
  ports.record.mockReset();
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.latest.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summary);
  ports.estimate.mockResolvedValue(estimate);
  ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  // 훅이 물은 루트를 그대로 되돌려 "내가 물은 루트와 다른 기록"을 만들지 않는다.
  ports.document.mockImplementation(async (merkleRoot: string) => ({
    merkleRoot,
    countryCode: "KR",
    taxYear: 2027,
    leafCount: 0,
    version: 1,
    leaves: [],
    recordedAt: "2027-01-01T00:00:00.000Z",
    anchorStatus: "anchored",
    txHash: "0xstub",
    blockNumber: "1",
    anchoredAt: "2027-01-01T00:00:00.000Z",
    explorerUrl: null,
  }));
});

describe("리포트 estimate 배선", () => {
  it("같은 조건 재조회 중에는 이전 계산 카드를 표시하고 새 결과로 교체한다", async () => {
    const { client } = renderReport();
    await screen.findByText("기타소득 계산");
    let complete!: (value: TaxEstimate) => void;
    ports.estimate.mockImplementation(() => new Promise<TaxEstimate>((resolve) => { complete = resolve; }));
    act(() => { void client.invalidateQueries({ queryKey: ["tax", "estimate"] }); });
    const previous = await screen.findByRole("region", { name: "이전 계산 결과" });
    expect(previous).toHaveAttribute("aria-busy", "true");
    expect(within(previous).getByText("₩183,333")).toBeInTheDocument();
    await act(async () => { complete(estimate); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "이전 계산 결과" })).not.toBeInTheDocument());
    expect(screen.getByText("기타소득 계산")).toBeInTheDocument();
  });

  it("거주국·귀속연도로 estimate를 요청해 그룹형 리포트를 estimate에서 파생한다", async () => {
    renderReport();

    expect(await screen.findByText("기타소득 계산")).toBeInTheDocument();
    // 서버가 내려준 진입 귀속연도(2027)와 거주국(KR)을 그대로 요청한다.
    await waitFor(() => expect(ports.estimate).toHaveBeenCalledWith(expect.objectContaining({ country: "KR", taxYear: 2027, source: "wallet" })));
    // 귀속연도 칩과 PARTIAL 잠정 배지.
    expect(screen.getByRole("button", { name: /2027년 귀속/ })).toBeInTheDocument();
    expect(screen.getByText("잠정")).toBeInTheDocument();
    // 그룹형 라인은 buildFilingSummary(estimate)에서 파생한다 — 하드코딩이 아니다.
    expect(screen.getByText("총수입금액")).toBeInTheDocument();
    expect(screen.getByText("기타소득금액")).toBeInTheDocument();
    expect(screen.getByText("과세표준")).toBeInTheDocument();
    expect(screen.getByText("예상 부담")).toBeInTheDocument();
    // 총수입금액 = Σ양도가액(5,000,000), 예상 부담 = 소득세+지방소득세(183,333.34).
    expect(screen.getByText("₩5,000,000")).toBeInTheDocument();
    // 답(L1)과 리포트 카드의 "예상 부담"은 같은 estimate에서 나오므로 같은 금액이 두 자리에 선다.
    // 두 estimate였다면 여기서 두 숫자가 갈린다.
    expect(screen.getByTestId("estimated-charge").textContent).toContain("₩183,333");
    expect(screen.getAllByText("₩183,333").length).toBeGreaterThanOrEqual(2);
    // 세무사 전달용 카드가 4시트가 무엇을 담는지 말한다(취득가액 명세·예외는 이 카드에만 있다).
    expect(screen.getByText(/취득가액 명세/)).toBeInTheDocument();
    expect(screen.getByText(/판단보류·미반영/)).toBeInTheDocument();
    // 거래 부속명세는 직접 신고용(CSV)·세무사 전달용(원장) 두 카드에 모두 담긴다.
    expect(screen.getAllByText(/거래 부속명세/).length).toBeGreaterThanOrEqual(1);
  });

  it("확인 필요 신호가 없으면 넛지 배너를 그리지 않는다", async () => {
    renderReport();
    await screen.findByText("기타소득 계산");
    // 기본 fixture는 excludedEventIds·zero_basis가 비어 있어 확인 필요 배너가 뜨지 않는다.
    expect(screen.queryByRole("link", { name: /확인 필요/ })).toBeNull();
  });

  it("미반영 이벤트가 있으면 확인 필요 배너로 거래 탭의 검토 큐를 가리킨다", async () => {
    ports.estimate.mockResolvedValue({ ...estimate, excludedEventIds: ["evt-a", "evt-b"] });
    renderReport();

    const banner = await screen.findByRole("link", { name: /확인 필요 2건/ });
    // 거래 목록이 /transactions로 이사했다 — 확인 필요 넛지도 그 라우트의 검토 탭을 가리킨다.
    expect(banner).toHaveAttribute("href", "/transactions?tab=review");
  });

  it("세무사 전달용 다운로드가 estimate 기반 근거자료 파일을 만든다", async () => {
    renderReport();
    await screen.findByText("기타소득 계산");

    const clicked: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    URL.createObjectURL = () => "blob:stub";
    URL.revokeObjectURL = () => {};
    try {
      const xlsx = screen.getByRole("button", { name: /세무사 전달용 내려받기/ });
      await waitFor(() => expect(xlsx).not.toBeDisabled());
      fireEvent.click(xlsx);
      await waitFor(() => expect(clicked.length).toBeGreaterThan(0));
      expect(clicked[0]).toContain("신고근거");
      expect(clicked[0]).toMatch(/\.xlsx$/);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });
});

describe("리포트는 estimate 하나에서 나온다", () => {
  // 실제 엔진을 통과시켜야 "입력이 답을 바꾼다"가 진짜로 검증된다.
  // 더블이 입력을 무시하면 카드와 근거가 함께 바뀌지 않아도 테스트는 통과한다.
  beforeEach(() => {
    ports.estimate.mockImplementation(async (input: TaxEstimateRequest) =>
      taxEstimateSchema.parse(
        computeTaxEstimate({
          ...input,
          events: createTaxScenarioEvents(input.taxYear, scenarioScaleFor(input.country)),
        }),
      ),
    );
  });

  it("연말 시가를 입력하면 리포트 카드의 예상 부담과 답이 함께 바뀐다", async () => {
    renderReport();
    await screen.findByText("기타소득 계산");

    const chargeBefore = screen.getByTestId("estimated-charge").textContent;
    const cardTotalBefore = within(screen.getByText("예상 부담").closest("div")!).getByText(/₩/).textContent;
    // 카드의 총합과 답이 같은 계산에서 나온다는 사실은, 한쪽만 바뀌면 곧바로 깨진다.
    expect(chargeBefore).toBeTruthy();

    // 처분 자산마다 연말 시가(의제취득가액)를 넣는다 — 취득가액이 올라가 손익이 줄어야 한다.
    const section = screen.getByLabelText("연말 시가 입력");
    const inputs = within(section).getAllByPlaceholderText("예: 4000000");
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) fireEvent.change(input, { target: { value: "999999999" } });

    await waitFor(() =>
      expect(ports.estimate.mock.calls.some(([input]) => input?.deemedFmv && Object.keys(input.deemedFmv).length > 0)).toBe(true),
    );
    // 답(L1)과 리포트 카드 총합이 **함께** 움직인다 — 두 estimate였다면 한쪽만 바뀐다.
    await waitFor(() => expect(screen.getByTestId("estimated-charge").textContent).not.toBe(chargeBefore));
    expect(within(screen.getByText("예상 부담").closest("div")!).getByText(/₩/).textContent).not.toBe(cardTotalBefore);
  });
});
