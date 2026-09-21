import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportPages } from "@/tests/ui/helpers/report-pages";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { createTaxScenarioEvents, scenarioScaleFor } from "@/lib/tax/scenarios";
import { computeTaxEstimate } from "@/lib/tax/engine";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import { taxEstimateSchema, ruleSetListSchema } from "@/lib/http/tax-dto";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { deriveTaxEvents } from "@/lib/tax/derive";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import type { TaxEstimateRequest } from "@/lib/ports/tax-engine";
import { AMOUNT_KIND_LABEL, GROUP_SHORT_LABEL } from "@/components/ui/judgment-badge";
import { formatFiat } from "@/lib/format";

const ports = vi.hoisted(() => ({
  listRuleSets: vi.fn(),
  estimate: vi.fn(),
  // 리포트 화면은 계산 말고도 원장·요약·앵커 증명을 읽는다(내려받기 카드·증명 카드).
  // 여기서 보는 것은 계산 쪽이므로 빈 원장으로 세워 두고, 그 표면들은 각자 테스트가 덮는다.
  list: vi.fn(async () => ({ items: [], nextCursor: null })),
  getSummary: vi.fn(async () => ({
    periodPnl: "0",
    computableEventCount: 0,
    taxableEventCount: 0,
    pendingReviewCount: 0,
    currency: "KRW",
    period: { from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
  })),
  getProof: vi.fn(async () => null),
}));

vi.mock("@/lib/composition-root.client", () => ({
  taxEngine: { listRuleSets: ports.listRuleSets, estimate: ports.estimate },
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  // 계산 근거 기록은 체인 왕복이라 여기서는 "기록 없음"(null)으로 고정한다. 그 카드는 export-evidence 테스트가 덮는다.
  taxEvidenceProvider: { latest: async () => null, record: async () => { throw new Error("not used"); }, checkChain: async () => { throw new Error("not used"); } },
}));

// 어댑터 대신 실제 엔진을 통과시켜 DTO 계약까지 함께 검증한다.
ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
// 더블이 source를 무시하면 요청은 지갑인데 응답은 시나리오가 된다.
// wallet은 실제 어댑터를, scenario는 시나리오 엔진을 태워 두 경로를 갈라 둔다.
const walletEngine = new TaxEngineService(() => createNormalizedEventFixtures(FIXTURE_TAX_YEAR));
const defaultEstimate = async (input: TaxEstimateRequest) =>
  input.source === "wallet"
    ? taxEstimateSchema.parse(await walletEngine.estimate(input))
    : taxEstimateSchema.parse(
        // 어댑터와 같은 규칙으로 만든다 — 연도·통화 자릿수가 갈리면 화면 테스트가 실제와 다른 것을 검증한다.
        computeTaxEstimate({
          ...input,
          events: createTaxScenarioEvents(input.taxYear, scenarioScaleFor(input.country)),
        }),
      );
ports.estimate.mockImplementation(defaultEstimate);

/**
 * 화면 기본 과세연도는 "올해"다(진입 즉시 답).
 * 시나리오 픽스처는 2025년 거래이므로, 테스트는 그 해를 명시적으로 고른 뒤 단언한다.
 */
async function renderSimulator() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ReportPages currentYear={FIXTURE_TAX_YEAR} />
    </QueryClientProvider>,
  );
  await selectTaxYear(2025);
  // 락인된 기대치(1,015.44 등)는 데모 시나리오 픽스처의 값이다. 출처를 명시한다.
  fireEvent.click(screen.getByRole("button", { name: "데모 시나리오" }));
  await waitFor(() => expect(ports.estimate.mock.calls.at(-1)?.[0].source).toBe("scenario"));
  return view;
}

/** 과세연도 칩은 계산 설정 화면의 "계산 조건 바꾸기" 안에 있다(더 이상 접힘이 아니라 펼친 섹션이다). */
async function selectTaxYear(year: number) {
  const conditions = (await screen.findByText("계산 조건 바꾸기")).closest("section")!;
  fireEvent.click(within(conditions).getByRole("button", { name: String(year) }));
}

/**
 * 나라 칩은 이제 "다른 나라였다면" 화면에 있다 — 거주국 리포트가 답이고 나라 전환은 비교이기 때문이다.
 * 칩 묶음의 aria-label은 그대로이므로 그 안에서 고른다.
 */
async function selectCountry(name: RegExp) {
  const chips = await screen.findByLabelText("국가 선택");
  fireEvent.click(within(chips).getByRole("button", { name }));
}

// 어떤 테스트가 도중에 실패해도 다음 테스트의 전제를 오염시키지 않게 한다.
// 영원히 pending인 구현이 새어나가면 이후 테스트가 전부 타임아웃한다.
afterEach(() => {
  ports.listRuleSets.mockReset();
  ports.estimate.mockReset();
  ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  ports.estimate.mockImplementation(defaultEstimate);
});

describe("리포트 계산 표면", () => {
  it("독일 룰셋의 확정 상태·면세분·부담 추정을 함께 보여준다", async () => {
    await renderSimulator();

    await screen.findByText("독일 · 2025");
    // 항목별 확정 상태의 topic 배지로도 통과하던 전역 단언을 요약 카드로 좁힌다.
    expect(within(screen.getByLabelText("계산 요약")).getByText("확정·시행중")).toBeInTheDocument();
    expect(screen.getByText("1년 초과 보유 비과세분")).toBeInTheDocument();
    expect(screen.getByTestId("estimated-charge").textContent).toContain("1,015.44");
    expect(document.querySelector('[data-surface="report"] [data-testid="mock-provenance"]')).not.toBeNull();
  });

  it("국가를 바꾸면 해당 룰셋으로 다시 계산한다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");

    await selectCountry(/인도/);

    await screen.findByText("인도 · 2025");
    expect(await screen.findByText("상계 불가로 무시된 손실")).toBeInTheDocument();
    // 실효세율은 메인의 답 옆과 비교 화면 두 곳에 같은 estimate에서 나온다 — 답 쪽을 본다.
    expect(within(screen.getByLabelText("계산 요약")).getByText(/실효 31.2%/)).toBeInTheDocument();
  });

  it("가정을 끄면 시행 전 국가는 금액 대신 과세 대상 아님과 판단 필요 항목을 제시한다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");

    await selectCountry(/한국/);

    await screen.findByText("한국 · 2025");
    // 시행 가정을 끄면 남는 것은 사실이다: 2027-01-01 시행이라 2025년 발생분은
    // "계산했더니 0원"이 아니라 과세 대상 자체가 아니다.
    fireEvent.click(await screen.findByRole("button", { name: "가정 끄기" }));
    await waitFor(() => expect(screen.getByTestId("estimated-charge").textContent).toBe("과세 대상 아님"));
    expect(within(screen.getByLabelText("계산 요약")).getByText("확정·시행예정")).toBeInTheDocument();
    expect(screen.getByText("판단이 필요한 항목")).toBeInTheDocument();
    // 부담을 산출하지 않은 상태에서 신고 기입란 8줄을 0원으로 깔면 화면이 두 이야기를 한다.
    expect(screen.queryByText("기타소득 계산")).toBeNull();
  });

  it("시행 예정 룰셋은 가정을 켠 채로 열어 시행 후 부담을 보여주고, 가정임을 계속 말한다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    await selectCountry(/한국/);
    await screen.findByText("한국 · 2025");

    // 2025년 데모 시나리오에 2027 시행 규칙(거주자별 총평균법)을 그대로 적용한 값이
    // 첫 화면부터 보인다(2026-09-17 사용자 결정 — "반영됐다 치고" 보여 준다).
    await waitFor(() =>
      expect(screen.getByTestId("estimated-charge").textContent).toContain("₩1,480,517.64"),
    );
    // 큰 금액 옆에 가정이라는 사실이 계속 있어야 한다.
    expect(screen.getByText(/시행 가정으로 보는 중입니다/)).toBeInTheDocument();
    // "시행 전인 지금 실제 부담은 0원"은 지우지 않고 접어 둔다.
    expect(screen.getByText("시행 전인 지금 실제 부담은")).toBeInTheDocument();
    // 방식 라벨도 가정임을 밝힌다 — 내보낸 결과만 봐도 알 수 있어야 한다.
    expect(within(screen.getByLabelText("계산 요약")).getByText(/거주자별 총평균법 · 2027 시행 가정/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "가정 끄기" }));
    await waitFor(() => expect(screen.getByTestId("estimated-charge").textContent).toBe("과세 대상 아님"));
    // 끄는 문을 닫아버리면 사실로 돌아갈 길이 없다 — 다시 켜는 문도 남는다.
    expect(screen.getByRole("button", { name: "시행 가정으로 보기" })).toBeInTheDocument();
  });

  it("시행 예정 룰셋은 시행 연도를 미리 골라 실제 부담을 본다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    // 미래 연도를 시계로 만들지는 않는다 — 시행 예정 연도가 없는 국가에는 없어야 한다.
    expect(screen.queryByRole("button", { name: /2027/ })).not.toBeInTheDocument();

    await selectCountry(/한국/);
    await screen.findByText("한국 · 2025");
    fireEvent.click(await screen.findByRole("button", { name: /2027/ }));

    await screen.findByText("한국 · 2027");
    // 시행 후 규칙이 실제로 돌아간다: 과세표준 6,729,625.62 × 20% + 지방소득세 10%
    await waitFor(() =>
      expect(screen.getByTestId("estimated-charge").textContent).toContain("₩1,480,517.64"),
    );
    // 미래 연도를 아무 말 없이 계산하면 사용자는 확정된 답으로 읽는다.
    // 이제는 배지로 보이고, 전문은 그 배지를 펼쳐야 나오는 접힘 안에 보존된다.
    expect(screen.getByText("2027년 시행 기준 미리보기")).toBeInTheDocument();
    expect(screen.getByText(/아직 시행 전인 2027년 기준으로 미리 계산했습니다/)).toBeInTheDocument();
  });

  it("규칙이 미확정인 룰셋은 같은 0을 '산출 불가'라 부른다", async () => {
    // 시행 전(SCHEDULED)과 규칙 미확정(UNDETERMINED)은 둘 다 totals가 0이지만 이유가 다르다.
    ports.estimate.mockImplementation(async (input: TaxEstimateRequest) => ({
      ...(await defaultEstimate(input)),
      status: "UNDETERMINED" as const,
    }));
    await renderSimulator();

    await screen.findByText("독일 · 2025");
    expect(screen.getByTestId("estimated-charge").textContent).toBe("산출 불가");
    expect(document.body.textContent).toContain("과세 규칙이 확정되지 않아 금액을 산출하지 않습니다.");
  });

  it("한계세율 입력이 계산에 반영된다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");

    const slider = screen.getByLabelText(/한계세율/);
    fireEvent.change(slider, { target: { value: "45" } });
    // 드래그 중에는 화면 숫자만 따라간다.
    await waitFor(() => expect(screen.getByText(/한계세율 45%/)).toBeInTheDocument());
    // 손을 뗄 때 한 번만 계산에 반영한다.
    fireEvent.pointerUp(slider);
    await waitFor(() => {
      const lastCall = ports.estimate.mock.calls.at(-1)?.[0];
      expect(lastCall.profile.marginalRatePercent).toBe("45");
      expect(lastCall.source).toBe("scenario");
    });
  });

  it("기본 출처는 내 지갑이고 지갑 파생 한계가 화면에 온다", async () => {
    // 더블이 source를 무시하면 요청은 지갑인데 응답은 시나리오가 된다.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2025} />
      </QueryClientProvider>,
    );
    await screen.findByText("독일 · 2025");
    expect(ports.estimate.mock.calls.at(-1)?.[0].source).toBe("wallet");

    // 지갑 경로만 만들 수 있는 파생 한계가 실제로 도달한다. 화면은 엔진 원문이 아니라 사람 말로 옮겨 보인다.
    const shaky = await screen.findByLabelText("흔들리는 것");
    expect(shaky.querySelector('[data-limitation-group="excluded"]')).not.toBeNull();
    expect(shaky.textContent).toContain("계산에서 뺌");
    expect(shaky.textContent).toContain("가스비는");
  });

  it("금지 용어를 노출하지 않는다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    const text = document.body.textContent ?? "";
    for (const term of ["세액", "납부할 세금", "신고서"]) expect(text).not.toContain(term);
  });
});

describe("리포트 제외 배너", () => {
  const base = createNormalizedEventFixtures(FIXTURE_TAX_YEAR)[0];

  afterEach(() => {
    ports.estimate.mockImplementation(defaultEstimate);
  });

  /**
   * 주어진 지갑 이벤트로 **실제 어댑터 경로**(deriveTaxEvents + 한계 병합)를 태운다.
   * source를 무시하는 더블을 쓰면 지갑 파생·제외가 통째로 검증되지 않는다.
   */
  async function renderWithWallet(events: NormalizedEvent[]) {
    // 실제 어댑터를 그대로 쓴다 — 병합 규칙을 여기서 다시 쓰면 프로덕션에 없는 화면을 검증하게 된다.
    // source를 강제하면 화면은 "데모 시나리오"인데 결과는 지갑이 되어,
    // 화면이 거짓을 말하는 상태를 테스트가 통과시킨다. 요청의 source를 그대로 존중한다.
    const engine = new TaxEngineService(() => events);
    ports.estimate.mockImplementation(async (input: TaxEstimateRequest) =>
      taxEstimateSchema.parse(await engine.estimate(input)),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2025} />
      </QueryClientProvider>,
    );
    // 기본 출처(내 지갑)를 그대로 둔다.
    await waitFor(() => expect(ports.estimate.mock.calls.at(-1)?.[0].source).toBe("wallet"));
    return view;
  }

  it("답 → 왜 → 신뢰도 → 세부 → 설정 순서를 메뉴가 지킨다", async () => {
    // 세부와 설정이 각자 화면으로 나가면서 이 순서는 한 화면의 세로 순서가 아니라
    // "메인의 답 다음에 오는 메뉴 줄의 순서"가 됐다. 순서를 안 재면 메뉴가 설정부터 내미는
    // 화면이 되어도 통과한다.
    await renderWithWallet(createNormalizedEventFixtures(FIXTURE_TAX_YEAR));
    await screen.findByLabelText("흔들리는 것");
    await screen.findByLabelText("판정 그룹");

    const main = document.querySelector('[data-surface="report"]')!.closest("main")!;
    const menu = within(main).getByLabelText("리포트 메뉴");
    // 답이 메뉴보다 앞에 있어야 한다 — 메뉴가 먼저면 사용자는 답까지 스크롤해야 한다.
    expect(
      screen.getByTestId("estimated-charge").compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING,
      "답이 메뉴보다 앞",
    ).toBeTruthy();
    // 왜(계산 근거) → 신뢰도(확인할 것) → 설정 → 비교.
    expect([...menu.querySelectorAll("a[data-menu]")].map((node) => node.getAttribute("data-menu"))).toEqual([
      "basis",
      "issues",
      "settings",
      "compare",
    ]);
  });

  it("화면이 고른 출처와 결과의 출처가 같다", async () => {
    // 하네스가 source를 강제하면 화면은 "데모 시나리오"인데 결과는 지갑이 된다.
    // 그 상태를 통과시키면 테스트가 거짓 화면을 승인하는 셈이다.
    await renderWithWallet([{ ...base, id: "w1" }]);
    const pressed = screen
      .getAllByRole("button")
      .filter((node) => node.getAttribute("aria-pressed") === "true")
      .map((node) => node.textContent);
    expect(pressed).toContain("내 지갑 이벤트");
    expect(pressed).not.toContain("데모 시나리오");
    expect(ports.estimate.mock.calls.at(-1)?.[0].source).toBe("wallet");
  });

  it("같은 문장을 두 섹션에서 반복하지 않는다", async () => {
    // 수신만 있으면 기간 내 작업이 없어 한계 패널 자체가 숨는다(빈 답은 흔들 것이 없다).
    // 처분을 하나 넣어 실제 계산이 있는 상태에서 한계 표기를 검증한다.
    await renderWithWallet([
      { ...base, id: "no-price", price_status: "UNKNOWN", fiat_value: null },
      { ...base, id: "estimated", price_status: "ESTIMATED" },
      { ...base, id: "sold", classification: "SEND", direction: "OUT", user_override: null },
    ]);
    const shaky = await screen.findByLabelText("흔들리는 것");
    const grounds = screen.queryByLabelText("계산 근거");

    const shakyText = shaky.textContent ?? "";
    const groundsText = grounds?.textContent ?? "";
    // 흔들리는 지점은 엔진 원문(상태값 UNKNOWN·ESTIMATED)이 아니라 사람 말로 보인다.
    for (const sentence of ["거래 당시 가격을 확인하지 못했습니다", "추정 가격으로 계산했습니다", "가스비는"]) {
      // 문구가 사라져도 통과하던 조건부 검사를 없앤다.
      expect(shakyText, sentence).toContain(sentence);
    }
    // 계산 근거(규칙 메모)에는 같은 경고가 원문으로도 다시 서지 않는다.
    for (const sentence of ["계산에서 제외했습니다", "추정가(ESTIMATED)", "가스비는"]) {
      expect(groundsText, sentence).not.toContain(sentence);
    }
  });

  it("흔들리는 지점을 영향 순으로 세우고 금액으로 말하지 않는다", async () => {
    // 수신만 있으면 기간 내 작업이 없어 한계 패널 자체가 숨는다(빈 답은 흔들 것이 없다).
    // 처분을 하나 넣어 실제 계산이 있는 상태에서 한계 표기를 검증한다.
    await renderWithWallet([
      { ...base, id: "no-price", price_status: "UNKNOWN", fiat_value: null },
      { ...base, id: "estimated", price_status: "ESTIMATED" },
      { ...base, id: "sold", classification: "SEND", direction: "OUT", user_override: null },
    ]);
    const section = await screen.findByLabelText("흔들리는 것");

    expect(section.textContent).toContain("이 답이 흔들리는 지점");
    // 답에서 빠진 것이 근사보다 먼저 온다 — 영향 순. 이제 종류별로 묶이므로 묶음의 순서를 잰다.
    const kinds = [...section.querySelectorAll("[data-limitation-group]")].map((node) =>
      node.getAttribute("data-limitation-group"),
    );
    expect(kinds.indexOf("excluded")).toBeLessThan(kinds.indexOf("approximation"));
    // 묶음 제목이 그 종류의 라벨과 건수를 말한다.
    const excluded = section.querySelector('[data-limitation-group="excluded"]')!;
    expect(excluded.textContent).toContain("계산에서 뺌");
    expect(excluded.textContent).toMatch(/\d+건/);
    // 얼마나 달라지는지는 계산하지 않았다. 금액을 쓰면 지어낸 추정이 된다.
    expect(section.textContent).not.toMatch(/[€$₩][\d,]/);
    // 고치러 갈 동선이 있다.
    // 확인 필요 큐가 요약에서 거래 탭으로 떠났다 — `/dashboard?tab=review`는 이제 닿는 곳이 없는 쿼리다.
    expect(section.querySelector('a[href="/transactions?tab=review"]')).not.toBeNull();
  });

  it("기간 밖 취득만 있으면 그 기간에 셀 것이 없다고 말한다", async () => {
    // 엔진은 원가 추적 때문에 기간 밖 취득을 판정 행으로 남긴다.
    // 그걸 세면 "계산할 거래 없음"이 안 걸리고, 옛 취득 금액이 "왜 이 금액인가"에 뜬다.
    await renderWithWallet([{ ...base, id: "old-buy", block_timestamp: "2024-03-01T00:00:00.000Z" }]);
    await selectTaxYear(2025);

    await waitFor(() => expect(screen.getByTestId("estimated-charge")).toHaveTextContent("계산할 거래 없음"));
    expect(screen.queryByLabelText("판정 그룹")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("계산 내역")).not.toBeInTheDocument();
  });

  it("확인이 필요한 이벤트 수를 사유를 단정하지 않고 보여준다", async () => {
    // 가격 미확정 1건 + 수량 0 1건 — 사유가 다르므로 "가격·분류"로 단정하면 거짓이다.
    await renderWithWallet([
      { ...base, id: "no-price", price_status: "UNKNOWN", fiat_value: null },
      { ...base, id: "zero-qty", raw_amount: "0" },
    ]);
    // 확인 필요 신호는 합쳐진 화면에서 넛지 한 곳으로 모였다(미반영 + 원가 0원, 중복은 한 번만).
    expect(await screen.findByRole("link", { name: /확인 필요 2건/ })).toBeInTheDocument();
  });

  it("자기 지갑 간 이체만 있으면 확인 필요 배너를 띄우지 않는다", async () => {
    await renderWithWallet([{ ...base, id: "internal", classification: "INTERNAL_TRANSFER" }]);
    await screen.findByTestId("estimated-charge");
    expect(screen.queryByText(/계산에서 빠진 이벤트/)).not.toBeInTheDocument();
  });

  it("중복 id는 첫 건이 계산되므로 확인 필요로 세지 않는다", async () => {
    await renderWithWallet([
      { ...base, id: "dup" },
      { ...base, id: "dup" },
    ]);
    await screen.findByTestId("estimated-charge");
    expect(screen.queryByText(/계산에서 빠진 이벤트/)).not.toBeInTheDocument();
  });

  it("'내 지갑 이벤트'를 고르면 wallet 출처로 요청하고 가정을 노출한다", async () => {
    // 어댑터를 그대로 통과시켜 source 전환과 assumptions→notes 경로를 실제로 검증한다.
    ports.estimate.mockImplementation(async (input: { country: string; taxYear: number; source?: string }) => {
      if (input.source !== "wallet") {
        return taxEstimateSchema.parse(computeTaxEstimate({ ...input, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR) }));
      }
      const derived = deriveTaxEvents([
        { ...base, id: "dup" },
        { ...base, id: "dup" },
      ]);
      const estimate = computeTaxEstimate({
        ...input,
        events: derived.events,
        excludedEventIds: derived.excludedEventIds,
      });
      return taxEstimateSchema.parse({ ...estimate, notes: [...estimate.notes, ...derived.assumptions] });
    });

    await renderSimulator();
    await screen.findByTestId("estimated-charge");
    const conditions = screen.getByText("계산 조건 바꾸기").closest("section")!;
    fireEvent.click(within(conditions).getByRole("button", { name: "내 지갑 이벤트" }));

    await waitFor(() => {
      const calls = ports.estimate.mock.calls.map(([input]) => input.source);
      expect(calls).toContain("wallet");
    });
    // 출처를 바꾸면 재조회 동안 결과가 비워진다(fresh 게이트). 새 결과가 도착한 뒤에 근거를 편다.
    fireEvent.click(await screen.findByText("계산 근거와 가정"));
    expect(await screen.findByText(/중복된 이벤트 id는 첫 건만 계산에 넘겼습니다/)).toBeInTheDocument();
  });
});

describe("리포트가 답 우선 3계층인가", () => {
  it("답이 계산 조건보다 먼저 나온다", async () => {
    const { container } = await renderSimulator();
    await screen.findByText("독일 · 2025");

    // L1 답과 설정의 문서 순서를 비교한다. 설정이 먼저면 사용자는 답까지 스크롤해야 한다.
    const answer = screen.getByTestId("estimated-charge");
    const settings = screen.getByText("계산 조건 바꾸기");
    const order = answer.compareDocumentPosition(settings);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING, "답이 설정보다 앞에 있어야 한다").toBeTruthy();
    void container;
  });

  it("과세연도는 주어진 연도를 쓰고 자체 시계를 읽지 않는다", async () => {
    // 서버가 연도를 내려준다. 화면이 따로 시계를 읽으면 연말 자정에 SSR과 hydration이 갈린다.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2025} />
      </QueryClientProvider>,
    );
    await screen.findByText("독일 · 2025");

    // 선택된 버튼이 주어진 연도여야 한다.
    expect(screen.getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "true");
    // 창도 같은 연도 기준이다 — 다음 해 버튼이 있으면 두 시계를 읽고 있다는 뜻.
    expect(screen.queryByRole("button", { name: "2026" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2022" })).toBeInTheDocument();
  });

  it("헤더 칩이 지금 보는 귀속연도를 그대로 말한다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2026} />
      </QueryClientProvider>,
    );
    // 리포트 제목은 고정이고, 어느 해를 보는지는 칩이 말한다.
    expect(await screen.findByRole("heading", { name: "리포트", level: 1 })).toBeInTheDocument();
    await screen.findByRole("button", { name: /2026년 귀속/ });

    await selectTaxYear(2025);
    await screen.findByText("독일 · 2025");
    // 칩이 옛 연도에 머물면 지난 해 결과를 올해 것으로 읽게 된다.
    expect(screen.getByRole("button", { name: /2025년 귀속/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /2026년 귀속/ })).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("올해 세금");
  });

  it("올해 거래가 없으면 마지막 거래가 있는 해로 열고 그 이유를 말한다", async () => {
    // 늘 "올해"로 열면 올해 거래가 없는 지갑은 진입하자마자 12개 룰셋이 전부 0원을 말한다.
    // 그건 비교가 아니라 빈 화면이다.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2026} latestActivityYear={2025} />
      </QueryClientProvider>,
    );

    await screen.findByText("독일 · 2025");
    expect(screen.getByRole("button", { name: /2025년 귀속/ })).toBeInTheDocument();
    // 이유는 배지로 강등됐지만 삭제되지 않았다 — 배지가 보이고, 전문은 접힘 안에 그대로 있다.
    expect(screen.getByText("2025년으로 열림")).toBeInTheDocument();
    expect(screen.getByText(/2026년에는 계산할 거래가 없어/)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "true");
    // 올해로 돌아갈 문은 남아 있어야 한다.
    expect(screen.getByRole("button", { name: "2026" })).toBeInTheDocument();
  });

  it("마지막 거래 연도가 선택 창 밖이어도 그 해를 고를 수 있다", async () => {
    // 창을 [올해-3, 올해]로 고정하면 오래 쉰 지갑은 자기 거래가 있는 해로 돌아갈 방법이 없다.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2026} latestActivityYear={2020} />
      </QueryClientProvider>,
    );

    await screen.findByText("계산 조건 바꾸기");
    expect(screen.getByRole("button", { name: "2020" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2026" })).toBeInTheDocument();
  });

  it("다른 나라를 고르면 거주국 결과라고 하지 않는다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages countryCode="DE" currentYear={2025} />
      </QueryClientProvider>,
    );
    await screen.findByText("독일 · 2025");
    expect(screen.getByText(/거주국 룰셋을 적용한 결과/)).toBeInTheDocument();

    await selectCountry(/미국/);
    await screen.findByText(/미국 · 2025/);
    expect(screen.getByText(/선택한 국가 룰셋을 적용한 결과/)).toBeInTheDocument();
    expect(screen.queryByText(/거주국 룰셋을 적용한 결과/)).not.toBeInTheDocument();
  });

  it("거주국을 모르면 어느 나라도 거주국이라 하지 않는다", async () => {
    // prop이 없으면 기본 국가(독일)를 열지만, 그게 이 사람의 거주국이라는 근거는 없다.
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    expect(screen.getByText(/선택한 국가 룰셋을 적용한 결과/)).toBeInTheDocument();
    expect(screen.queryByText(/거주국 룰셋을 적용한 결과/)).not.toBeInTheDocument();
  });

  it("헤더가 실제 출처와 준비 상태를 말한다", async () => {
    // 정적 문장으로 두면 데모를 지갑이라 하고, 아직 계산도 안 한 화면을 "적용한 결과"라 한다.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages countryCode="DE" currentYear={2025} />
      </QueryClientProvider>,
    );
    // 기본은 내 지갑이다.
    await screen.findByText("독일 · 2025");
    expect(screen.getByText(/지갑 이력에 거주국 룰셋을 적용한 결과/)).toBeInTheDocument();

    // 데모 시나리오로 바꾸면 헤더도 따라간다.
    fireEvent.click(screen.getByRole("button", { name: "데모 시나리오" }));
    await waitFor(() => expect(screen.getByText(/데모 시나리오에 거주국 룰셋을 적용한 결과/)).toBeInTheDocument());
    expect(screen.queryByText(/지갑 이력에 거주국 룰셋을 적용한 결과/)).not.toBeInTheDocument();
  });

  it("결과가 없으면 적용한 결과라고 하지 않는다", async () => {
    ports.listRuleSets.mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages countryCode="DE" currentYear={2025} />
      </QueryClientProvider>,
    );
    await screen.findByText("적용할 룰셋을 확인하는 중입니다. 아직 계산하지 않았습니다.");
    // 아직 아무것도 계산하지 않았는데 "적용한 결과"라 하면 화면이 거짓을 말한다.
    expect(document.body.textContent).not.toMatch(/적용한 결과입니다/);
  });

  it("출처를 바꾸는 순간 헤더와 금액이 다른 출처를 말하지 않는다", async () => {
    // 헤더는 state에서, 금액은 result에서 온다. 둘의 시점이 갈리면 화면이 두 이야기를 한다.
    let release!: () => void;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages countryCode="DE" currentYear={2025} />
      </QueryClientProvider>,
    );
    await screen.findByText("독일 · 2025");
    expect(screen.getByText(/지갑 이력에 .*적용한 결과/)).toBeInTheDocument();

    // 새 출처의 계산을 붙잡아 둔다.
    ports.estimate.mockImplementation(() => new Promise((resolve) => { release = () => resolve(undefined as never); }));
    fireEvent.click(screen.getByRole("button", { name: "데모 시나리오" }));

    // 헤더가 새 출처를 말하는 순간 금액은 이미 사라져 있어야 한다.
    await waitFor(() => expect(screen.getByText(/데모 시나리오에/)).toBeInTheDocument());
    expect(screen.queryByTestId("estimated-charge")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/적용한 결과입니다/);
    void release;
  });

  it("할인·공제분을 법적 면세라고 부르지 않는다", async () => {
    // exemptGains는 독일 보유기간 면세뿐 아니라 호주 50% CGT 할인, 캐나다 inclusion 비포함분,
    // 영국·이탈리아 연간 공제까지 담는다. 전부 "면세"라 하면 법적 처리를 잘못 단정한다.
    await renderSimulator();
    await screen.findByText("독일 · 2025");

    for (const country of [/독일/, /호주/, /캐나다/, /영국/, /이탈리아/]) {
      await selectCountry(country);
      await waitFor(() => expect(screen.getByLabelText("계산 요약")).toBeInTheDocument());
      const summary = screen.getByLabelText("계산 요약");
      expect(summary.textContent, String(country)).toContain("과세표준 제외");
      // 중립 라벨이 법적 사유를 지우면 안 된다 — 상위 범주임을 밝힌다.
      expect(summary.textContent, String(country)).toContain("면세·할인·공제 합계");
      expect(summary.textContent, String(country)).not.toContain("비과세·면세");
    }
  });

  it("제외액이 0인 나라에는 할인·공제가 있는 것처럼 암시하지 않는다", async () => {
    // 인도는 flat 30% 분리과세라 과세표준 제외가 구조적으로 0이다.
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    await selectCountry(/인도/);
    await screen.findByText(/인도 · 2025/);

    const summary = screen.getByLabelText("계산 요약");
    expect(summary.textContent).toContain("과세표준 제외");
    expect(summary.textContent).not.toContain("면세·할인·공제 합계");
  });

  it("계산이 실패하면 진행 중이라고 하지 않는다", async () => {
    // result가 없는 이유는 셋이다 — 룰셋 못 찾음 / 실패 / 계산 중.
    // 뭉뚱그리면 실패한 것을 "적용하는 중"이라고 거짓말한다.
    ports.estimate.mockImplementation(async () => {
      throw new Error("engine down");
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages countryCode="DE" currentYear={2025} />
      </QueryClientProvider>,
    );
    await screen.findByText(/룰셋을 적용하지 못했습니다/);
    expect(document.body.textContent).not.toMatch(/적용하는 중입니다/);
    expect(document.body.textContent).not.toMatch(/적용한 결과입니다/);
  });

  it("이월 손실을 어느 방향으로 넘기는지 정확히 말한다", async () => {
    // 엔진의 lossCarryforward는 이번 기간에서 다 쓰지 못해 **다음** 기간으로 넘길 손실이다.
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    const estimate = computeTaxEstimate({ country: "DE", taxYear: FIXTURE_TAX_YEAR, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR) });
    // 조건부 return을 두면 픽스처가 바뀌는 순간 이 계약이 조용히 검증되지 않는다.
    expect(estimate.lossCarryforward).not.toBe("0");

    expect(screen.getByText(/다음 기간으로 넘길 손실/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/이전 기간에서 넘어온/);
  });

  it("룰셋 목록이 비면 적용할 룰셋을 못 찾았다고 말한다", async () => {
    ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse([]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages countryCode="DE" currentYear={2025} />
      </QueryClientProvider>,
    );
    await screen.findByText("적용할 룰셋을 확인하지 못해 아직 계산하지 않았습니다.");
    expect(document.body.textContent).not.toMatch(/적용한 결과입니다/);
  });

  it("계산 조건은 접혀 있다", async () => {
    // 헬퍼는 연도를 고르려고 details를 연다. 기본 접힘 상태는 직접 렌더해서 본다.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={FIXTURE_TAX_YEAR} />
      </QueryClientProvider>,
    );
    await screen.findByText("계산 조건 바꾸기");
    // 12개 입력이 펼쳐져 있으면 첫 화면이 설정으로 찬다 — 그래서 설정은 이제 메인에 없고 별도 화면이다.
    // 접힘을 세던 자리를 "메인에 없다"로 바꾼다: 접혀 있든 펼쳐져 있든, 메인에 있으면 첫 화면이 길어진다.
    const main = document.querySelector('[data-surface="report"]')!.closest("main")!;
    expect(within(main).queryByText("계산 조건 바꾸기")).toBeNull();
    expect(within(main).queryByLabelText("계산 조건")).toBeNull();
    // 대신 메뉴 줄이 그 화면으로 가는 문을 연다.
    expect(within(main).getByRole("link", { name: /계산 설정/ })).toHaveAttribute("href", "/export/settings");
  });

  it("건수를 금액처럼 그리지 않는다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    await selectCountry(/한국/);
    await screen.findByText("한국 · 2025");

    const list = screen.getByLabelText("계산 내역");
    // 한국 룰셋은 처분/수령 건수를 낸다. "₩5"가 아니라 "5건"이어야 한다.
    const row = within(list).getByText("처분 건수").closest("li")!;
    expect(row.textContent).toMatch(/\d+건/);
    expect(row.textContent).not.toMatch(/₩/);
  });

  it("L2: 판정 그룹이 왜 이 금액인지 설명한다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    const section = screen.getByLabelText("판정 그룹");

    // 독일 시나리오의 판정 그룹이 실제로 나온다.
    expect(section.textContent).toMatch(/소득 · 과세/);
    expect(section.textContent).toMatch(/비과세 · 1년 초과/);
    expect(section.textContent).toMatch(/손실/);
    // 각 그룹에 건수와 금액이 붙는다.
    expect(section.textContent).toMatch(/\d+건/);
    // 건별로 넘어갈 동선이 있다.
    expect(section.textContent).toContain("어떤 거래가 어느 그룹인지 보기");
  });

  it("판정 그룹이 답을 이루는 금액을 실제로 보여준다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    const estimate = computeTaxEstimate({ country: "DE", taxYear: FIXTURE_TAX_YEAR, events: createTaxScenarioEvents(FIXTURE_TAX_YEAR) });
    const section = screen.getByLabelText("판정 그룹");

    // 조건부 단언은 그룹이 있으면 아무것도 검사하지 않는다. 항상 값을 대조한다.
    expect(section.textContent).toContain(formatFiat(estimate.totals.incomeTotal, estimate.currency));
    expect(section.textContent).toContain(formatFiat(estimate.totals.exemptGains, estimate.currency));
    // 개수만 세면 그룹이 빠지거나 잘못 붙어도 통과한다. (그룹, 금액 종류) 쌍을 정확히 대조한다.
    const expected = new Set(estimate.judgments.map((row) => `${row.group}|${row.amountKind}`));
    const rendered = new Set(
      [...section.querySelectorAll("li")].map(
        (node) => `${node.getAttribute("data-group")}|${node.getAttribute("data-amount-kind")}`,
      ),
    );
    expect(rendered).toEqual(expected);
    // 각 줄이 사람이 읽을 라벨도 함께 보인다.
    // 속성만 보면 보이는 배지 문구가 엉뚱해져도 통과한다.
    for (const node of section.querySelectorAll("li")) {
      const kind = node.getAttribute("data-amount-kind") as keyof typeof AMOUNT_KIND_LABEL;
      const group = node.getAttribute("data-group") as keyof typeof GROUP_SHORT_LABEL;
      expect(node.textContent, kind).toContain(AMOUNT_KIND_LABEL[kind]);
      // 룰셋 고유 문구를 쓰더라도 그 그룹의 의미와 어긋나면 안 된다.
      // 첫 span을 집으면 장식 span이 끼어들 때 엉뚱한 걸 읽고도 통과한다.
      const badgeNode = node.querySelector(`[data-judgment-badge="${group}"]`);
      expect(badgeNode, `${group} 배지 없음`).not.toBeNull();
      const badge = badgeNode!.textContent ?? "";
      const engineLabels = new Set(
        estimate.judgments.filter((row) => row.group === group).map((row) => row.label),
      );
      expect([...engineLabels, GROUP_SHORT_LABEL[group]], `${group} badge=${badge}`).toContain(badge);
    }
    // 독일 시나리오는 과세 대상 손익이 0이므로 taxable 그룹이 없다.
    expect(estimate.totals.taxableGains).toBe("0");
  });

  it("영국·호주의 비역년 과세기간을 화면이 그대로 보인다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");

    await selectCountry(/영국/);
    await screen.findByText(/영국 · 2025/);
    // 화면이 역년으로 되돌리거나 배타적 끝을 그대로 찍으면 하루 넓은 기간을 말한다.
    expect(screen.getByLabelText("계산 요약")).toHaveTextContent("과세기간 2025-04-06 ~ 2026-04-05");

    await selectCountry(/호주/);
    await screen.findByText(/호주 · 2025/);
    expect(screen.getByLabelText("계산 요약")).toHaveTextContent("과세기간 2025-07-01 ~ 2026-06-30");
  });

  it("국가를 바꿨다 돌아와도 슬라이더 입력이 남는다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");

    fireEvent.change(screen.getByLabelText(/한계세율/), { target: { value: "45" } });
    await selectCountry(/미국/);
    await screen.findByText(/미국 · 2025/);
    await selectCountry(/독일/);
    await screen.findByText("독일 · 2025");

    // 사용자가 넣은 값을 국가 전환이 조용히 지우면 답이 달라진 걸 모른다.
    expect(screen.getByLabelText(/한계세율/)).toHaveValue("45");
  });

  it("슬라이더는 드래그 중 재계산하지 않는다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    const slider = screen.getByLabelText(/한계세율/);
    const before = ports.estimate.mock.calls.length;

    // 드래그 한 번에 수십 번 발생하는 change. 매번 재계산하면 답이 깜빡이고 요청이 쏟아진다.
    for (const value of ["36", "37", "38", "39", "40"]) {
      fireEvent.change(slider, { target: { value } });
    }
    expect(ports.estimate.mock.calls.length).toBe(before);
    expect(screen.getByText(/한계세율 40%/)).toBeInTheDocument();
    expect(screen.getByText(/손을 떼면 40%로 다시 계산합니다/)).toBeInTheDocument();

    fireEvent.pointerUp(slider);
    await waitFor(() => expect(ports.estimate.mock.calls.length).toBe(before + 1));
    await waitFor(() => expect(ports.estimate.mock.calls.at(-1)?.[0].profile.marginalRatePercent).toBe("40"));
  });

  it("이 국가가 쓰는 입력만 살리고 나머지는 그렇게 말한다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");

    // 독일은 한계세율·이월결손금을 쓴다. 신고 구분은 쓰지 않는다.
    expect(screen.getByLabelText(/한계세율/)).toBeInTheDocument();
    expect(screen.getByLabelText("전년 이월결손금")).toBeInTheDocument();
    // 안 쓰는 입력은 숨기지 않는다 — 숨기면 사용자가 자기 실수로 오해한다.
    const filing = screen.getByText("신고 구분").closest("div")!;
    expect(filing.textContent).toContain("이 국가에서 쓰지 않음");
    expect(screen.queryByRole("button", { name: "부부합산" })).not.toBeInTheDocument();
  });

  it("룰셋 조회 실패를 진행 중이라고 말하지 않는다", async () => {
    ports.listRuleSets.mockImplementation(async () => {
      throw new Error("catalog down");
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={FIXTURE_TAX_YEAR} />
      </QueryClientProvider>,
    );

    await screen.findByText("계산 조건 바꾸기");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("룰셋 목록을 불러오지 못했습니다."));
    // 오류만 띄우고 나가는 문을 안 주면 막다른 화면이다.
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    const body = document.body.textContent ?? "";
    expect(body).toContain("룰셋을 불러오지 못함");
    expect(body).not.toContain("룰셋 확인 중");
    expect(body).not.toContain("이 국가에서 쓰지 않음");

    // 다시 시도가 실제로 회복시킨다.
    ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText(/독일 · /);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("목록이 비어 있으면 영원히 확인 중이라고 하지 않는다", async () => {
    // 오류가 아니어도 답을 낼 수 없다. "확인 중"이라 하면 오지 않을 것을 기다리게 만든다.
    ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse([]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2025} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/룰셋이 없습니다/));
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(screen.queryByText("적용할 룰셋을 확인하는 중입니다. 아직 계산하지 않았습니다.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("estimated-charge")).not.toBeInTheDocument();
  });

  it("영국 세션(UK)도 룰셋(GB)을 찾는다", async () => {
    // DID는 영국을 UK로 부르고 목록은 GB로 낸다. 정규화가 없으면 아무 룰셋도 못 찾는다.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages countryCode="UK" currentYear={FIXTURE_TAX_YEAR} />
      </QueryClientProvider>,
    );
    await selectTaxYear(2025);
    await screen.findByText(/영국 · 2025/);
    expect(screen.getByRole("button", { name: /영국/ })).toHaveAttribute("aria-pressed", "true");

    // GB는 지갑 외 소득과 디파이 소유권을 쓴다 — 룰셋을 찾았다는 증거.
    expect(screen.getByLabelText("지갑 외 과세소득")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("룰셋 확인 중");
  });

  it("룰셋을 못 받았으면 쓰지 않는다고 단정하지 않는다", async () => {
    // selected가 없을 때 전부 "이 국가에서 쓰지 않음"으로 그리면 화면이 거짓을 말한다.
    ports.listRuleSets.mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={FIXTURE_TAX_YEAR} />
      </QueryClientProvider>,
    );

    await screen.findByText("계산 조건 바꾸기");
    const body = document.body.textContent ?? "";
    expect(body).toContain("룰셋 확인 중");
    expect(body).not.toContain("이 국가에서 쓰지 않음");

    ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  });

  it("룰셋을 알기 전에는 계산을 요청하지 않는다", async () => {
    // 먼저 물으면 첫 요청은 프로필 전체, 둘째는 걸러진 프로필로 나간다.
    // 두 답이 같다는 보장은 계약에 기대는 것이고, 화면은 그 사이 한 번 깜빡인다.
    let release!: () => void;
    ports.listRuleSets.mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve(ruleSetListSchema.parse(listRuleSetSummaries()));
      }),
    );
    const before = ports.estimate.mock.calls.length;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2025} />
      </QueryClientProvider>,
    );
    // 요청을 보낸 적이 없다 — "불러오는 중"이 아니라 "아직 계산하지 않았다"고 말해야 한다.
    await screen.findByText("적용할 룰셋을 확인하는 중입니다. 아직 계산하지 않았습니다.");
    expect(screen.queryByText("계산 결과를 불러오는 중입니다")).not.toBeInTheDocument();
    expect(ports.estimate.mock.calls.length).toBe(before);

    release();
    await screen.findByText("독일 · 2025");
    // 딱 한 번만 묻는다.
    expect(ports.estimate.mock.calls.length).toBe(before + 1);
    expect(Object.keys(ports.estimate.mock.calls.at(-1)![0].profile).sort()).toEqual([
      "carriedLosses",
      "marginalRatePercent",
    ]);

    ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  });

  it("룰셋 상태가 바뀌면 결과도 다시 받는다", async () => {
    // 카탈로그만 바뀌고 결과가 그대로면 헤더는 옛 상태를, 아래 패널은 새 항목을 말한다.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2025} />
      </QueryClientProvider>,
    );
    await screen.findByText("독일 · 2025");
    const before = ports.estimate.mock.calls.length;

    // 같은 프로필 필드, 확정 상태만 바뀐 카탈로그.
    ports.listRuleSets.mockImplementation(async () =>
      ruleSetListSchema.parse(
        listRuleSetSummaries().map((ruleset) =>
          ruleset.code === "DE" ? { ...ruleset, status: "PARTIAL" as const } : ruleset,
        ),
      ),
    );
    await client.invalidateQueries({ queryKey: ["tax", "rulesets"] });

    await waitFor(() => expect(ports.estimate.mock.calls.length).toBeGreaterThan(before));
  });

  it("룰셋 메타데이터가 바뀌면 결과도 다시 받는다", async () => {
    // 통화·계산방법이 바뀌었는데 옛 결과를 재사용하면 화면이 옛 문맥을 단정한다.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={2025} />
      </QueryClientProvider>,
    );
    await screen.findByText("독일 · 2025");
    const before = ports.estimate.mock.calls.length;

    ports.listRuleSets.mockImplementation(async () =>
      ruleSetListSchema.parse(
        listRuleSetSummaries().map((ruleset) =>
          ruleset.code === "DE" ? { ...ruleset, method: "LIFO" as const } : ruleset,
        ),
      ),
    );
    await client.invalidateQueries({ queryKey: ["tax", "rulesets"] });
    await waitFor(() => expect(ports.estimate.mock.calls.length).toBeGreaterThan(before));
  });

  it("쓰지 않는다고 말한 입력은 요청에도 넣지 않는다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");

    // 독일은 한계세율·이월결손금만 쓴다. 화면이 "쓰지 않음"이라 해놓고 값을 보내면
    // 보이지 않는 값이 답을 바꿔도 아무도 모른다.
    const sent = ports.estimate.mock.calls.at(-1)?.[0].profile;
    expect(Object.keys(sent).sort()).toEqual(["carriedLosses", "marginalRatePercent"]);

    await selectCountry(/미국/);
    await screen.findByText(/미국 · 2025/);
    await waitFor(() => {
      const next = ports.estimate.mock.calls.at(-1)?.[0].profile;
      expect(Object.keys(next).sort()).toEqual(["carriedLosses", "filingStatus", "otherIncome"]);
    });
  });

  it("인도처럼 입력이 없는 국가는 빈 프로필을 보낸다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    await selectCountry(/인도/);
    await screen.findByText(/인도 · 2025/);
    await waitFor(() => {
      expect(ports.estimate.mock.calls.at(-1)?.[0].profile).toEqual({});
    });
  });

  it("미국으로 바꾸면 신고 구분이 살아난다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    await selectCountry(/미국/);
    await screen.findByText(/미국 · 2025/);

    expect(screen.getByRole("button", { name: "부부합산" })).toBeInTheDocument();
    // 반대로 독일이 쓰던 한계세율은 미국에서 쓰지 않는다.
    const rate = screen.getByText("한계세율").closest("div")!;
    expect(rate.textContent).toContain("이 국가에서 쓰지 않음");
  });

  it("이월결손금이 계산에 반영된다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");

    fireEvent.change(screen.getByLabelText("전년 이월결손금"), { target: { value: "5000" } });
    await waitFor(() => expect(ports.estimate.mock.calls.at(-1)?.[0].profile.carriedLosses).toBe("5000"));
    // 비워도 엔진에는 항상 유효한 십진 문자열이 간다.
    fireEvent.change(screen.getByLabelText("전년 이월결손금"), { target: { value: "" } });
    await waitFor(() => expect(ports.estimate.mock.calls.at(-1)?.[0].profile.carriedLosses).toBe("0"));
  });

  it("미확정 국가는 확정 시 무엇이 되는지를 본문에 둔다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    await selectCountry(/한국/);
    await screen.findByText("한국 · 2025");

    const section = screen.getByLabelText("판단 필요 항목");
    // 스위칭 벤치마크는 접힌 "계산 근거" 안이 아니라 판단 항목 옆에 있어야 한다.
    expect(section.textContent).toMatch(/확정되면 →/);
    expect(section.textContent).toMatch(/독일·미국 모델/);
    expect(section.textContent).toMatch(/포르투갈/);
    // 접힌 목록에는 남아 있지 않다 — 두 곳에 두면 어느 쪽이 최신인지 알 수 없다.
    const grounds = screen.getByLabelText("계산 근거");
    expect(grounds.textContent).not.toMatch(/스위칭 벤치마크/);
  });

  it("판단이 필요한 항목에서 해당 거래로 갈 수 있다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    await selectCountry(/한국/);
    await screen.findByText("한국 · 2025");

    const section = screen.getByLabelText("판단 필요 항목");
    const link = [...section.querySelectorAll("a")].find((node) => /해당 이벤트 \d+건 보기/.test(node.textContent ?? ""));
    expect(link).toBeDefined();
    // 목록이 요약에서 거래 탭으로 떠났다 — "해당 이벤트 보기"가 가야 할 곳도 함께 옮겨졌다.
    expect(link?.getAttribute("href")).toBe("/transactions");
  });

  it("금액 종류가 다른 판정을 한 숫자로 더하지 않는다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    await selectCountry(/한국/);
    await screen.findByText("한국 · 2025");

    // 한국의 시행 전 "과세 대상 아님"에는 손익 행과 수령 FMV 행이 함께 있다.
    // 둘을 더한 수는 아무것도 아니므로 줄을 나눠야 한다.
    // 시행 가정이 기본으로 켜져 있으므로 끄고 나서 시행 전 판정을 본다.
    fireEvent.click(await screen.findByRole("button", { name: "가정 끄기" }));
    await waitFor(() => expect(screen.getByTestId("estimated-charge").textContent).toBe("과세 대상 아님"));
    const section = screen.getByLabelText("판정 그룹");
    const rows = [...section.querySelectorAll("li")].map((node) => node.textContent ?? "");
    const notTaxable = rows.filter((row) => row.includes("과세 대상 아님"));
    expect(notTaxable.length).toBeGreaterThan(1);
    expect(notTaxable.some((row) => row.includes("손익"))).toBe(true);
    expect(notTaxable.some((row) => row.includes("수령 FMV"))).toBe(true);
    // 섞어 더한 합계는 화면 어디에도 없어야 한다.
    expect(section.textContent).not.toContain("13,130.5");
  });

  it("모든 판정 줄이 금액 종류를 밝힌다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    const section = screen.getByLabelText("판정 그룹");
    for (const row of section.querySelectorAll("li")) {
      const text = row.textContent ?? "";
      // 종류 없이 금액만 있으면 무엇의 금액인지 알 수 없다.
      expect(text, text).toMatch(/손익|취득가액|수령 FMV|승계 원가/);
    }
  });

  it("셀 것이 없는 해는 0원이라고 말하지 않는다", async () => {
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    expect(screen.getByTestId("estimated-charge").textContent).toContain("1,015.44");

    // 데모 시나리오는 어느 해를 골라도 그 해의 거래를 만든다 — 비어 있는 쪽은 내 지갑이다.
    // 취득 원가는 기간 밖에서도 남지만 그건 "이번 기간의 답"이 아니다.
    fireEvent.click(screen.getByRole("button", { name: "내 지갑 이벤트" }));
    await selectTaxYear(2023);
    await waitFor(() => expect(screen.getByTestId("estimated-charge")).toHaveTextContent("계산할 거래 없음"));
    const body = document.body.textContent ?? "";
    // "€0.00"을 크게 띄우면 "올해는 낼 게 없구나"로 읽힌다.
    expect(screen.getByTestId("estimated-charge").textContent).not.toMatch(/0\.00/);
    expect(body).toContain("계산에 넣을 거래가 없습니다");
    // 셀 것이 없다면서 옛 취득 그룹을 금액과 함께 보이면 화면이 두 이야기를 한다.
    expect(screen.queryByLabelText("판정 그룹")).not.toBeInTheDocument();
  });

  it("흔들릴 것이 없으면 흔들린다고 말하지 않는다", async () => {
    // 깨끗한 시나리오에서는 한계 패널 자체가 없어야 한다. 빈 패널을 띄우면 없는 불안을 만든다.
    await renderSimulator();
    await screen.findByText("독일 · 2025");
    expect(screen.queryByLabelText("흔들리는 것")).not.toBeInTheDocument();
  });

  it("재조회 중에는 옛 금액을 새 조건의 답인 척하지 않는다", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReportPages currentYear={FIXTURE_TAX_YEAR} />
      </QueryClientProvider>,
    );
    await selectTaxYear(2025);
    fireEvent.click(screen.getByRole("button", { name: "데모 시나리오" }));
    await screen.findByText("독일 · 2025");
    await waitFor(() => expect(screen.getByTestId("estimated-charge").textContent).toContain("1,015.44"));

    ports.estimate.mockImplementation(() => new Promise(() => {}));
    void client.invalidateQueries({ queryKey: ["tax", "estimate"] });
    await waitFor(() => expect(screen.queryByTestId("estimated-charge")).not.toBeInTheDocument());
    expect(screen.getByText("계산 결과를 불러오는 중입니다")).toBeInTheDocument();
    // 결과가 없어도 조건은 바꿀 수 있어야 한다. 조건이 결과 안에 있으면 막다른 화면이 된다.
    expect(screen.getByText("계산 조건 바꾸기")).toBeInTheDocument();
    expect(screen.getByLabelText(/한계세율/)).toBeInTheDocument();
  });
});
