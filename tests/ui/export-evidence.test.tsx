import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";
import { buildReportBundle } from "@/lib/export/report-bundle";
import { ruleSetListSchema } from "@/lib/http/tax-dto";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import type { EvidenceRecord } from "@/lib/ports/tax-evidence";

const ports = vi.hoisted(() => ({
  list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), estimate: vi.fn(), listRuleSets: vi.fn(),
  latest: vi.fn(), record: vi.fn(),
}));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEngine: { estimate: ports.estimate, listRuleSets: ports.listRuleSets },
  taxEvidenceProvider: { latest: ports.latest, record: ports.record },
}));

// 기록 화면은 다운로드와 같은 플랜 게이트를 탄다. 활성 플랜을 심어 카드를 열고 본다.
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  return { ...actual, usePlan: () => ({ plan: { tier: "pro" as const, taxYear: 2027, activatedAt: "2027-01-01T00:00:00.000Z" }, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { renderReportPages } from "@/tests/ui/helpers/report-pages";

const estimate = EVIDENCE_FIXTURE_ESTIMATE;
// 이 describe의 모든 테스트에서 ports.list는 빈 목록을 준다(beforeEach) — 카드가 읽는 events도 비어 있다.
// 등록은 이제 계산 근거 + 이번 내려받기 파일 둘을 묶은 루트다(buildReportBundle) — buildEvidenceDocument
// 루트로 비교하면 등록 직후에도 "달라졌다"고 잘못 말한다(§7).
const CURRENT_ROOT = buildReportBundle(estimate, []).merkleRoot;
const OTHER_ROOT = `0x${"cd".repeat(32)}`;

function recordOf(merkleRoot: string, explorerUrl: string | null = null): EvidenceRecord {
  return {
    merkleRoot,
    countryCode: "KR",
    taxYear: 2027,
    leafCount: 7,
    recordedAt: "2027-05-01T00:00:00.000Z",
    anchorStatus: "anchored",
    txHash: `0x${"ab".repeat(32)}`,
    blockNumber: "42",
    anchoredAt: "2027-05-01T00:00:00.000Z",
    explorerUrl,
  };
}

const summary = {
  periodPnl: "3000000", computableEventCount: 5, taxableEventCount: 2, pendingReviewCount: 0,
  currency: "KRW", period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
};

/** 카드는 계산 근거 화면(/export/basis)에 산다. 프로바이더는 프로덕션의 layout과 같은 것 하나다. */
function renderBasis() {
  return renderReportPages({ pages: ["basis"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027 });
}

beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset();
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summary);
  ports.estimate.mockResolvedValue(estimate);
  ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  ports.latest.mockResolvedValue(null);
});

describe("계산 근거 체인 기록", () => {
  // 이 카드는 더는 등록을 시키지 않는다 — 등록은 내려받기가 한다(§7). 아래 모든 테스트가 그 규칙을 지킨다.
  it("기록이 없으면 무엇이 올라가는지 밝히고, 내려받을 때 등록된다고 안내한다", async () => {
    renderBasis();
    await screen.findByText("계산 근거 기록");

    expect(screen.getByText(/금액과 지갑 주소는 체인에 저장하지 않습니다/)).toBeInTheDocument();
    expect(await screen.findByText(/이 리포트는 파일을 내려받을 때 체인에 등록됩니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /내려받기로 이동/ })).toHaveAttribute("href", "/export");
    // 고른 귀속연도의 기록을 그 연도로 물어본다. 등록 버튼이 없으므로 record는 절대 부르지 않는다.
    expect(ports.latest).toHaveBeenCalledWith("KR", 2027);
    expect(ports.record).not.toHaveBeenCalled();
  });

  it("이미 기록했고 계산이 그대로면 배지와 지금 계산의 판정 건수를 보인다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    renderBasis();

    expect(await screen.findByText("체인에 기록됨")).toBeInTheDocument();
    // 잎 수(헤더+판정+파일 2개)가 아니라 지금 계산의 판정 건수로 말한다.
    expect(screen.getByText("5건")).toBeInTheDocument();
    expect(screen.queryByText(/이 리포트는 파일을 내려받을 때 체인에 등록됩니다/)).toBeNull();
    expect(screen.queryByText(/기록한 뒤로|다음 내려받기 때 새로 등록/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(ports.record).not.toHaveBeenCalled();
  });

  it("탐색기가 없는 체인에서는 링크 대신 거래 해시 전문을 보인다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    renderBasis();
    await screen.findByText("체인에 기록됨");

    // 누르면 401이 뜨는 링크를 "증명"이라고 내놓지 않는다.
    expect(screen.queryByRole("link", { name: /체인에서 확인하기/ })).toBeNull();
    // 사용자가 직접 조회에 쓸 수 있는 값은 남겨 준다.
    expect(screen.getByText(`0x${"ab".repeat(32)}`)).toBeInTheDocument();
  });

  it("탐색기가 생기면 그 링크를 건다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT, "https://scan.example.test/tx/0xabc"));
    renderBasis();
    await screen.findByText("체인에 기록됨");

    expect(screen.getByRole("link", { name: /체인에서 확인하기/ })).toHaveAttribute("href", "https://scan.example.test/tx/0xabc");
  });

  it("기록한 뒤 계산이 달라졌으면 다음 내려받기 때 새로 등록된다고 말하고, 판정 건수는 말하지 않는다", async () => {
    ports.latest.mockResolvedValue(recordOf(OTHER_ROOT));
    renderBasis();

    expect(await screen.findByText(/계산 결과가 변경되어 다음 내려받기 시 새로 등록됩니다/)).toBeInTheDocument();
    // 옛 기록을 "현재 근거"로 읽히게 하는 배지는 달지 않는다.
    expect(screen.queryByText("체인에 기록됨")).toBeNull();
    // 기록이 덮는 판정 수를 이 카드는 모른다(잎을 안 갖고 있다) — 지어내지 않는다.
    expect(screen.queryByText(/^\d+건$/)).toBeNull();
    expect(screen.queryByText(/이 리포트는 파일을 내려받을 때 체인에 등록됩니다/)).toBeNull();
    expect(ports.record).not.toHaveBeenCalled();
  });

  it("체인 확인은 근거 화면으로 이동한다. 해시 한 줄을 이 자리에서 그리지 않는다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    const { container } = renderBasis();
    await screen.findByText("체인에 기록됨");

    // 이 체인에는 탐색기가 없다. 앱의 근거 화면이 체인 대조 결과와 봉인한 판정 전체를 대신 보인다.
    expect(screen.getByRole("link", { name: /체인에서 직접 확인/ })).toHaveAttribute("href", `/export/evidence/${CURRENT_ROOT}`);
    expect(container.querySelector('[data-surface="evidence-chain-result"]')).toBeNull();
  });

  it("계산이 달라진 뒤에도 링크는 체인에 실제로 올라간 루트를 가리킨다", async () => {
    ports.latest.mockResolvedValue(recordOf(OTHER_ROOT));
    renderBasis();
    await screen.findByText(/계산 결과가 변경되어 다음 내려받기 시 새로 등록됩니다/);

    // 지금 화면의 루트가 아니라 기록된 루트다. 화면 값으로 바꾸면 체인에 없는 근거를 열게 된다.
    expect(screen.getByRole("link", { name: /체인에서 직접 확인/ })).toHaveAttribute("href", `/export/evidence/${OTHER_ROOT}`);
  });

  it("기록이 없으면 확인할 근거도 없다. 링크를 그리지 않는다", async () => {
    renderBasis();
    await screen.findByText("계산 근거 기록");
    expect(screen.queryByRole("link", { name: /체인에서 직접 확인/ })).toBeNull();
  });

  it("지갑 미연결(DID-only)에는 봉인할 내 계산이 없다. 기록을 묻지 않는다", async () => {
    renderReportPages({ pages: ["basis"], countryCode: "KR", currentYear: 2027, walletConnected: false });
    await screen.findByText("계산 근거 기록");

    expect(ports.latest).not.toHaveBeenCalled();
    expect(screen.queryByText("체인에 기록됨")).toBeNull();
  });
});
