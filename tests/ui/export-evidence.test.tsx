import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";
import { buildEvidenceDocument } from "@/lib/tax/evidence";
import type { EvidenceRecord } from "@/lib/ports/tax-evidence";

const ports = vi.hoisted(() => ({
  list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), estimate: vi.fn(),
  latest: vi.fn(), record: vi.fn(), checkChain: vi.fn(),
}));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEngine: { estimate: ports.estimate },
  taxEvidenceProvider: { latest: ports.latest, record: ports.record, checkChain: ports.checkChain },
}));

// 기록은 다운로드와 같은 플랜 게이트를 탄다 — 활성 플랜을 심어 버튼을 열고 본다.
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  return { ...actual, usePlan: () => ({ plan: { tier: "pro" as const, taxYear: 2027, activatedAt: "2027-01-01T00:00:00.000Z" }, activate: vi.fn(), deactivate: vi.fn() }) };
});

const print = vi.hoisted(() => ({ printReportHtml: vi.fn<(html: string) => "window">(() => "window") }));
vi.mock("@/lib/export/print", () => print);

import { ExportView } from "@/components/export/export-view";

const estimate = EVIDENCE_FIXTURE_ESTIMATE;
const CURRENT_ROOT = buildEvidenceDocument(estimate).merkleRoot;
const OTHER_ROOT = `0x${"cd".repeat(32)}`;

function recordOf(merkleRoot: string, explorerUrl: string | null = null): EvidenceRecord {
  return {
    merkleRoot,
    countryCode: "KR",
    taxYear: 2027,
    leafCount: 6,
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

beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset();
  print.printReportHtml.mockClear();
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summary);
  ports.estimate.mockResolvedValue(estimate);
  ports.latest.mockResolvedValue(null);
});

describe("계산 근거 체인 기록", () => {
  it("기록이 없으면 무엇이 올라가는지 밝히고 기록을 권한다", async () => {
    render(<ExportView countryCode="KR" />);
    await screen.findByText("계산 근거 기록");

    expect(screen.getByText(/금액·지갑 주소는 올라가지 않고/)).toBeInTheDocument();
    const button = await screen.findByRole("button", { name: "계산 근거 기록하기" });
    await waitFor(() => expect(button).toBeEnabled());
    // 고른 귀속연도의 기록을 그 연도로 물어본다.
    expect(ports.latest).toHaveBeenCalledWith("KR", 2027);
  });

  it("누르면 정본 문서를 올린다 — 서버가 대조할 수 있게 루트를 함께 보낸다", async () => {
    ports.record.mockResolvedValue(recordOf(CURRENT_ROOT));
    render(<ExportView countryCode="KR" />);
    const button = await screen.findByRole("button", { name: "계산 근거 기록하기" });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    await waitFor(() => expect(ports.record).toHaveBeenCalledTimes(1));
    const document = ports.record.mock.calls[0][0] as ReturnType<typeof buildEvidenceDocument>;
    expect(document.merkleRoot).toBe(CURRENT_ROOT);
    // 잎 0번은 헤더, 나머지는 건별 판정 — 이 구조가 곧 "건별 증명"의 근거다.
    expect(document.leaves[0].kind).toBe("header");
    expect(document.leaves).toHaveLength(estimate.judgments.length + 1);

    expect(await screen.findByText("체인에 기록됨")).toBeInTheDocument();
    // 잎 수가 아니라 판정 건수로 말한다(헤더 잎은 사용자의 거래가 아니다).
    expect(screen.getByText("5건")).toBeInTheDocument();
  });

  it("탐색기가 없는 체인에서는 링크 대신 거래 해시 전문을 보인다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    render(<ExportView countryCode="KR" />);
    await screen.findByText("체인에 기록됨");

    // 누르면 401이 뜨는 링크를 "증명"이라고 내놓지 않는다.
    expect(screen.queryByRole("link", { name: /체인에서 확인하기/ })).toBeNull();
    // 사용자가 직접 조회에 쓸 수 있는 값은 남겨 준다.
    expect(screen.getByText(`0x${"ab".repeat(32)}`)).toBeInTheDocument();
  });

  it("탐색기가 생기면 그 링크를 건다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT, "https://scan.example.test/tx/0xabc"));
    render(<ExportView countryCode="KR" />);
    await screen.findByText("체인에 기록됨");

    expect(screen.getByRole("link", { name: /체인에서 확인하기/ })).toHaveAttribute("href", "https://scan.example.test/tx/0xabc");
  });

  it("이미 기록했고 계산이 그대로면 다시 올리지 않는다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    render(<ExportView countryCode="KR" />);

    const button = await screen.findByRole("button", { name: "기록 완료" });
    expect(button).toBeDisabled();
    expect(screen.queryByText(/기록한 뒤로 계산이 달라졌습니다/)).toBeNull();
  });

  it("기록한 뒤 계산이 달라졌으면 그 사실을 말하고 다시 기록하게 한다", async () => {
    ports.latest.mockResolvedValue(recordOf(OTHER_ROOT));
    render(<ExportView countryCode="KR" />);

    expect(await screen.findByText(/기록한 뒤로 계산이 달라졌습니다/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "다시 기록하기" });
    await waitFor(() => expect(button).toBeEnabled());
    // 옛 기록을 "현재 근거"로 읽히게 하는 배지는 달지 않는다.
    expect(screen.queryByText("체인에 기록됨")).toBeNull();
  });

  it("올리지 못하면 조용히 넘어가지 않고 이유를 말한다", async () => {
    ports.record.mockRejectedValue(new Error("Evidence merkle root mismatch."));
    render(<ExportView countryCode="KR" />);
    const button = await screen.findByRole("button", { name: "계산 근거 기록하기" });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    expect(await screen.findByText("Evidence merkle root mismatch.")).toBeInTheDocument();
  });

  it("보고서(PDF)는 지금 계산과 같은 기록만 싣는다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    render(<ExportView countryCode="KR" />);
    await screen.findByText("체인에 기록됨");

    fireEvent.click(screen.getByRole("button", { name: /보고서 열기/ }));
    await waitFor(() => expect(print.printReportHtml).toHaveBeenCalledTimes(1));
    expect(print.printReportHtml.mock.calls[0][0]).toContain(CURRENT_ROOT);
  });

  it("계산이 달라진 기록은 보고서에 찍지 않는다 — 대조에 실패할 해시를 종이에 남기지 않는다", async () => {
    ports.latest.mockResolvedValue(recordOf(OTHER_ROOT));
    render(<ExportView countryCode="KR" />);
    await screen.findByText(/기록한 뒤로 계산이 달라졌습니다/);

    fireEvent.click(screen.getByRole("button", { name: /보고서 열기/ }));
    await waitFor(() => expect(print.printReportHtml).toHaveBeenCalledTimes(1));
    const html = print.printReportHtml.mock.calls[0][0];
    expect(html).not.toContain(OTHER_ROOT);
    expect(html).not.toContain("OmniOne 체인 기록");
  });

  const chainCheck = (over: Partial<Record<string, unknown>> = {}) => ({
    merkleRoot: CURRENT_ROOT, txHash: `0x${"ab".repeat(32)}`, blockNumber: "25737864",
    readFromChain: true, success: true, anchoredPayloadHash: CURRENT_ROOT, matches: true,
    checkedAt: "2027-05-02T00:00:00.000Z", ...over,
  });

  it("체인 확인은 저장된 값을 되읽지 않고 체인에 묻는다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    ports.checkChain.mockResolvedValue(chainCheck());
    render(<ExportView countryCode="KR" />);
    await screen.findByText("체인에 기록됨");

    fireEvent.click(screen.getByRole("button", { name: /체인에서 직접 확인/ }));

    await waitFor(() => expect(ports.checkChain).toHaveBeenCalledWith(CURRENT_ROOT));
    expect(await screen.findByText("체인에 이 근거가 있습니다")).toBeInTheDocument();
    expect(screen.getByText(/블록 25737864/)).toBeInTheDocument();
  });

  it("묻기 전에는 확인 결과를 보이지 않는다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    const { container } = render(<ExportView countryCode="KR" />);
    await screen.findByText("체인에 기록됨");

    expect(container.querySelector('[data-surface="evidence-chain-result"]')).toBeNull();
  });

  it("체인의 해시가 다르면 있다고 말하지 않는다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    ports.checkChain.mockResolvedValue(chainCheck({ matches: false, anchoredPayloadHash: OTHER_ROOT }));
    render(<ExportView countryCode="KR" />);
    await screen.findByText("체인에 기록됨");

    fireEvent.click(screen.getByRole("button", { name: /체인에서 직접 확인/ }));
    expect(await screen.findByText("체인의 값이 이 근거와 다릅니다")).toBeInTheDocument();
    expect(screen.getByText(OTHER_ROOT)).toBeInTheDocument();
  });

  it("체인을 못 읽었을 때 '없다'고 단정하지 않는다", async () => {
    ports.latest.mockResolvedValue(recordOf(CURRENT_ROOT));
    ports.checkChain.mockResolvedValue(chainCheck({ readFromChain: false, success: false, matches: false, anchoredPayloadHash: null }));
    render(<ExportView countryCode="KR" />);
    await screen.findByText("체인에 기록됨");

    fireEvent.click(screen.getByRole("button", { name: /체인에서 직접 확인/ }));
    expect(await screen.findByText("체인을 읽지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText(/기록이 없다는 뜻은 아닙니다/)).toBeInTheDocument();
  });

  it("다시 기록하면 옛 루트의 확인 결과는 지운다 — 다른 근거의 답을 남기지 않는다", async () => {
    ports.latest.mockResolvedValue(recordOf(OTHER_ROOT));
    ports.checkChain.mockResolvedValue(chainCheck({ merkleRoot: OTHER_ROOT, anchoredPayloadHash: OTHER_ROOT }));
    ports.record.mockResolvedValue(recordOf(CURRENT_ROOT));
    const { container } = render(<ExportView countryCode="KR" />);
    await screen.findByText(/기록한 뒤로 계산이 달라졌습니다/);

    fireEvent.click(screen.getByRole("button", { name: /체인에서 직접 확인/ }));
    await screen.findByText("체인에 이 근거가 있습니다");

    fireEvent.click(screen.getByRole("button", { name: "다시 기록하기" }));
    await waitFor(() => expect(container.querySelector('[data-surface="evidence-chain-result"]')).toBeNull());
  });
});
