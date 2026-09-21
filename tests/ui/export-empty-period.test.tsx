import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderReportPages } from "@/tests/ui/helpers/report-pages";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import { vi } from "vitest";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), latest: vi.fn(), listRuleSets: vi.fn(), estimate: vi.fn(), anchorGet: vi.fn() }));
vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEvidenceProvider: { latest: ports.latest, record: vi.fn() },
  taxEngine: { listRuleSets: ports.listRuleSets, estimate: ports.estimate },
  // 게이트가 기본 켜짐(ReportInputsProvider)이라 CSV 클릭이 register 대신 이 조회를 먼저 탄다.
  // 키를 그대로 되돌려 "내가 물은 키와 다른 레코드"를 만들지 않는다(estimate가 null이라 국가·연도가
  // 파일 바이트에 없는 경우라 여기서 메타를 대충 맞추면 계획 §0-F6이 막으려던 혼선을 재현한다).
  reportAnchorProvider: {
    get: ports.anchorGet,
    register: vi.fn(),
  },
}));

// 다운로드는 이제 구독 전제다 — 활성 플랜을 심어야 버튼이 열려 파일명 검증까지 도달한다.
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  const plusPlan = { tier: "plus" as const, taxYear: 2026, activatedAt: "2026-01-01T00:00:00.000Z" };
  return { ...actual, usePlan: () => ({ plan: plusPlan, activate: vi.fn(), deactivate: vi.fn() }) };
});

describe("빈 지갑 리포트", () => {
  it("기간이 없으면 빈 범위를 그대로 보이지 않는다", async () => {
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getProof.mockResolvedValue(null);
    ports.latest.mockResolvedValue(null);
    ports.getSummary.mockResolvedValue({
      periodPnl: "0", computableEventCount: 0, taxableEventCount: 0, pendingReviewCount: 0,
      currency: "KRW", period: { from: "", to: "" },
    });
    ports.listRuleSets.mockImplementation(async () => listRuleSetSummaries());
    // 추정이 실패해도 원장 부속명세는 온체인 값만으로 만들 수 있다 — 그때 기간은 요약 기간으로 물러난다.
    ports.estimate.mockRejectedValue(new Error("engine down"));
    // countryCode를 안 넘겨 country는 FALLBACK_COUNTRY("DE")로, latestActivityYear가 없어 taxYear는 currentYear(2026)로 잡힌다
    // (lib/tax/use-report-inputs.ts:62,78,85). 훅이 물은 키를 그대로 돌려주어 "내가 물은 키와 다른 레코드"를 만들지 않는다.
    ports.anchorGet.mockImplementation(async (key: { fileHash: string; kind: string; countryCode: string; taxYear: number }) => ({
      ...key,
      algorithm: "keccak256",
      byteLength: 0,
      recordedAt: "2026-01-01T00:00:00.000Z",
      anchorStatus: "anchored",
      attempt: 1,
      txHash: "0xstub",
      blockNumber: "1",
      anchoredAt: "2026-01-01T00:00:00.000Z",
      explorerUrl: null,
      failureReason: null,
      lastFailureAt: null,
    }));
    renderReportPages({ pages: ["main"], currentYear: 2026 });
    expect(await screen.findByText(/기간 미정/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/^\s*~\s/m);

    // 파일명에도 빈 기간을 그대로 쓰면 `verawallet-명세-_.csv`가 된다.
    const clicked: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    URL.createObjectURL = () => "blob:stub";
    URL.revokeObjectURL = () => {};
    try {
      const csv = screen.getByRole("button", { name: /직접 신고용 내려받기/ });
      await waitFor(() => expect(csv).not.toBeDisabled());
      fireEvent.click(csv);
      await waitFor(() => expect(clicked.length).toBeGreaterThan(0));
      expect(clicked[0]).toContain("기간미정");
      expect(clicked[0]).not.toMatch(/-_\./);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });
});
