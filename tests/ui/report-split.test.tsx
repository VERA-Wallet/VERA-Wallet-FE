import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeTaxEstimate } from "@/lib/tax/engine";
import { ruleSetListSchema, taxEstimateSchema } from "@/lib/http/tax-dto";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import { createTaxScenarioEvents, scenarioScaleFor } from "@/lib/tax/scenarios";
import type { TaxEstimateRequest } from "@/lib/ports/tax-engine";
import type { TaxEstimate } from "@/lib/tax/types";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), latest: vi.fn(), estimate: vi.fn(), listRuleSets: vi.fn() }));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEvidenceProvider: { latest: ports.latest, record: vi.fn() },
  taxEngine: { estimate: ports.estimate, listRuleSets: ports.listRuleSets },
}));

// 구독 중으로 세운다 — 그래야 내려받기가 막히는 이유가 "플랜"이 아니라 "비교 중"임을 갈라 볼 수 있다.
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  const plusPlan = { tier: "plus" as const, taxYear: 2027, activatedAt: "2027-01-01T00:00:00.000Z" };
  return { ...actual, usePlan: () => ({ plan: plusPlan, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { renderReportPages } from "@/tests/ui/helpers/report-pages";

/** 옮겨간 섹션들이 "있었다면" 전부 그려질 만한 입력. 메인이 비어 있는 이유가 데이터 부족이면 안 된다. */
// 엔진(estimate.ts)이 내는 모양 그대로: "<id>: 확인이 필요해 계산에서 제외했습니다." 건마다 한 줄이다.
const excluded = Array.from({ length: 7 }, (_, index) => ({
  kind: "excluded" as const,
  message: `0x${String(index).repeat(4)}: 확인이 필요해 계산에서 제외했습니다.`,
  eventIds: [`0x${String(index).repeat(4)}`],
}));
const approximation = Array.from({ length: 2 }, (_, index) => ({
  kind: "approximation" as const,
  message: "추정가(ESTIMATED)로 계산했습니다.",
  eventIds: [`0xb${index}`],
}));

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
  notes: ["총평균법으로 계산했습니다."],
  limitations: [...excluded, ...approximation],
  openQuestions: [
    {
      topic: "CRYPTO_TO_CRYPTO",
      status: "UNDETERMINED",
      reason: "코인 간 교환의 과세 시점이 확정되지 않았습니다.",
      affectedEventIds: ["0xcc"],
      benchmark: "독일·미국 모델",
    },
  ],
  requiredInputs: ["2026-12-31 의제취득가액"],
  excludedEventIds: excluded.flatMap((row) => row.eventIds),
  provenance: "mock",
  period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
  judgments: [
    {
      eventId: "buy",
      at: "2027-02-01T00:00:00.000Z",
      asset: "1:native",
      symbol: "ETH",
      quantity: "1",
      amount: "2000000",
      amountKind: "cost",
      holdingDays: null,
      acquiredAt: null,
      lots: 1,
      leg: "single",
      inPeriod: true,
      group: "acquire",
      label: "취득",
      basis: "소득세법 제64조의3제2항",
      breakdown: { proceeds: "0", cost: "2000000", fee: "0" },
    },
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
  computableEventCount: 3,
  taxableEventCount: 1,
  pendingReviewCount: 0,
  currency: "KRW",
  period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
};

beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset();
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.latest.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summary);
  ports.estimate.mockResolvedValue(estimate);
  ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
});

function mainElement(): HTMLElement {
  return document.querySelector('[data-surface="report"]')!.closest("main")!;
}

describe("리포트 메인은 세금 보고서와 내보내기만 말한다", () => {
  it("옮겨간 섹션은 메인에 없고, 대신 그 화면으로 가는 메뉴 4줄이 있다", async () => {
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027 });

    // 세금 보고서: 답과 신고 기입란 8줄.
    expect(await screen.findByText("기타소득 계산")).toBeInTheDocument();
    expect(screen.getByTestId("estimated-charge").textContent).toContain("₩183,333");
    // 내보내기: 구독 상태와 내려받기 2종.
    expect(screen.getByText("내려받기")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /직접 신고용 내려받기/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /세무사 전달용 내려받기/ })).toBeInTheDocument();

    // 옮겨간 다섯 표면은 데이터가 있는데도 메인에 없다 — 있으면 첫 화면이 다시 13화면이 된다.
    for (const label of ["판정 그룹", "계산 결과 확인 사항", "판단 필요 항목", "계산 조건", "국가 선택"]) {
      expect(screen.queryByLabelText(label), label).toBeNull();
    }
    // 각 화면으로 가는 문은 정확히 넷이고, 순서와 목적지가 정해져 있다.
    const menu = screen.getByLabelText("리포트 메뉴");
    expect([...menu.querySelectorAll("a[data-menu]")].map((node) => [node.getAttribute("data-menu"), node.getAttribute("href")])).toEqual([
      ["basis", "/export/basis"],
      ["issues", "/export/issues"],
      ["settings", "/export/settings"],
      ["compare", "/export/compare"],
    ]);
  });

  it("메뉴의 상태 한마디는 estimate에서 파생한다", async () => {
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027 });
    // 계산이 도착하기 전의 메뉴는 "아직 계산하지 않았어요"라고 말한다 — 그 상태를 재면 파생을 검증하지 못한다.
    await screen.findByText("기타소득 계산");
    const menu = screen.getByLabelText("리포트 메뉴");
    const row = (name: string) => menu.querySelector(`a[data-menu="${name}"]`)!;

    // 양도 1건·취득 1건은 위 judgments에서 센 수다 — 하드코딩이면 픽스처를 바꿔도 그대로 통과한다.
    expect(row("basis").textContent).toContain("양도 1건 · 취득 1건");
    // 흔들리는 지점 9 = excluded 7 + approximation 2, 판단 필요 1 = openQuestions 1.
    expect(row("issues").textContent).toContain(
      `계산 확인 ${estimate.limitations.length} · 판단 필요 ${estimate.openQuestions.length}`,
    );
    // 확인할 것이 있으면 앰버 점이 붙는다 — 색만이 아니라 위 문구가 건수를 글자로도 말한다.
    expect(row("issues").querySelector(".bg-amber-500")).not.toBeNull();
    // 나라 개수는 룰셋 목록에서 온다.
    expect(row("compare").textContent).toContain(`${listRuleSetSummaries().length}개 나라 규칙과 비교`);
    // 룰셋이 연말 시가를 요구하는데 아직 안 넣었다는 사실을 설정 줄이 말한다.
    expect(row("settings").textContent).toContain("연말 시가 미입력");
  });

  it("흔들릴 것도 판단할 것도 없으면 메뉴가 그렇게 말하고 점도 없다", async () => {
    ports.estimate.mockResolvedValue({ ...estimate, limitations: [], openQuestions: [], excludedEventIds: [] });
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027 });

    const menu = await screen.findByLabelText("리포트 메뉴");
    const issues = menu.querySelector('a[data-menu="issues"]')!;
    await waitFor(() => expect(issues.textContent).toContain("확인 사항 없음"));
    expect(issues.querySelector(".bg-amber-500")).toBeNull();
  });
});

describe("확인할 것 — 종류별 묶음과 접기", () => {
  it("종류로 묶어 거래 건수를 달고, 같은 문구는 한 줄로 합치며 id는 떼고 사람 말로 바꾼다", async () => {
    renderReportPages({ pages: ["issues"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027 });

    const section = await screen.findByLabelText("계산 결과 확인 사항");
    const group = section.querySelector('[data-limitation-group="excluded"]')! as HTMLElement;
    // 묶음 제목이 kind 라벨과 거래 건수를 함께 말한다.
    expect(group.textContent).toContain("계산 제외");
    expect(within(group).getByText("7건")).toBeInTheDocument();
    // 같은 문장 7장이 아니라 한 줄이다. 건마다 한 줄이면 페이지를 나눠도 길이가 그대로다.
    expect(group.querySelectorAll("li")).toHaveLength(1);
    // 엔진 원문("<id>: 확인이 필요해 계산에서 제외했습니다.")이 아니라 사람 말 + 그래서 무엇을 하면 되는지.
    expect(group.textContent).toContain("확인이 필요하여 계산에서 제외되었습니다.");
    expect(group.textContent).toContain("확인 필요 탭에서 누락 정보를 확인하고 보완해 주세요.");
    expect(group.textContent).not.toContain("0x0000");
    // 한 줄뿐이면 접을 것도 없다.
    expect(within(group).queryByRole("button")).toBeNull();

    const small = section.querySelector('[data-limitation-group="approximation"]')! as HTMLElement;
    expect(small.querySelectorAll("li")).toHaveLength(1);
    expect(within(small).getByText("2건")).toBeInTheDocument();
  });

  it("문구가 다른 줄이 5개를 넘으면 처음 5줄만 보이고 나머지는 버튼으로 편다", async () => {
    const other = Array.from({ length: 7 }, (_, index) => ({ kind: "other" as const, message: `기타 확인 사항 ${index}`, eventIds: [] }));
    ports.estimate.mockResolvedValue({ ...estimate, limitations: other });
    renderReportPages({ pages: ["issues"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027 });

    const section = await screen.findByLabelText("계산 결과 확인 사항");
    const group = section.querySelector('[data-limitation-group="other"]')! as HTMLElement;
    // 7줄 중 5줄만 서 있다. 나머지가 펼쳐져 있으면 페이지를 나눠도 길이가 그대로다.
    expect(group.querySelectorAll("li")).toHaveLength(5);

    const more = within(group).getByRole("button", { name: "나머지 2건 더 보기" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);

    expect(group.querySelectorAll("li")).toHaveLength(7);
    expect(within(group).getByRole("button", { name: "접기" })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("화면이 나뉘어도 estimate는 하나다", () => {
  beforeEach(() => {
    // 더블이 입력을 무시하면 "설정이 메인을 바꾼다"가 검증되지 않는다. 실제 엔진을 태운다.
    ports.estimate.mockImplementation(async (input: TaxEstimateRequest) =>
      taxEstimateSchema.parse(
        computeTaxEstimate({
          ...input,
          events: createTaxScenarioEvents(input.taxYear, scenarioScaleFor(input.country)),
        }),
      ),
    );
  });

  it("계산 설정에서 연말 시가를 넣으면 메인의 예상 부담이 바뀐다", async () => {
    // 프로덕션에서는 layout이 두 화면 사이에서 이 프로바이더를 살려 둔다(Next: layouts do not rerender).
    renderReportPages({ pages: ["main", "settings"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027 });

    await screen.findByText("한국 · 2027");
    const before = screen.getByTestId("estimated-charge").textContent;
    expect(before).toBeTruthy();

    const fmv = screen.getByLabelText("연말 시가 입력");
    const inputs = within(fmv).getAllByPlaceholderText("예: 4000000");
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) fireEvent.change(input, { target: { value: "999999999" } });

    // 취득가액이 올라갔으니 손익이 줄고, 그 결과가 **다른 화면인** 메인의 답에 나타나야 한다.
    await waitFor(() => expect(screen.getByTestId("estimated-charge").textContent).not.toBe(before));
  });
});

describe("다른 나라였다면 → 메인", () => {
  it("거주국이 아닌 나라를 고르면 메인이 비교 중이라 말하고 내려받기가 막힌다", async () => {
    renderReportPages({ pages: ["main", "compare"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027 });

    // 거주국(KR)을 보는 동안에는 잠기지 않는다 — 구독 중이고 한도 안이다.
    const csv = await screen.findByRole("button", { name: /직접 신고용 내려받기/ });
    await waitFor(() => expect(csv).not.toBeDisabled());
    expect(document.querySelector('[data-surface="comparing-country"]')).toBeNull();

    fireEvent.click(within(screen.getByLabelText("국가 선택")).getByRole("button", { name: /독일/ }));

    // 비교 중이라는 사실이 메인 금액 옆에 붙고,
    await waitFor(() => expect(document.querySelector('[data-surface="comparing-country"]')).not.toBeNull());
    expect(document.querySelector('[data-surface="comparing-country"]')!.textContent).toContain("비교 중: 독일");
    expect(within(mainElement()).getByRole("button", { name: "거주국으로" })).toBeInTheDocument();
    // 내려받기는 자물쇠가 아니라 이유를 말하며 막힌다.
    await waitFor(() => expect(screen.getByRole("button", { name: /직접 신고용 내려받기/ })).toBeDisabled());
    expect(document.querySelector('[data-surface="download-blocked"]')!.textContent).toContain(
      "신고 근거자료는 거주국 기준으로만 만듭니다",
    );
  });
});
