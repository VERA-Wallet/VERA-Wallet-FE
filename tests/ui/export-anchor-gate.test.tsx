import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReportLedgerCsv } from "@/lib/export/report";
import { ruleSetListSchema } from "@/lib/http/tax-dto";
import type { ReportAnchorRecord } from "@/lib/ports/report-anchor";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";

const ports = vi.hoisted(() => ({
  list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), estimate: vi.fn(), listRuleSets: vi.fn(),
  latest: vi.fn(), record: vi.fn(), anchorGet: vi.fn(), anchorRegister: vi.fn(),
}));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEngine: { estimate: ports.estimate, listRuleSets: ports.listRuleSets },
  taxEvidenceProvider: { latest: ports.latest, record: ports.record },
  reportAnchorProvider: { get: ports.anchorGet, register: ports.anchorRegister },
}));

// 내려받기는 구독 전제다. 활성 플랜을 심어야 버튼이 열려 게이트까지 도달한다.
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  return { ...actual, usePlan: () => ({ plan: { tier: "pro" as const, taxYear: 2027, activatedAt: "2027-01-01T00:00:00.000Z" }, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { renderReportPages } from "@/tests/ui/helpers/report-pages";

const estimate = EVIDENCE_FIXTURE_ESTIMATE;
const FILE_HASH = `0x${"11".repeat(32)}`;
const TX_HASH = `0x${"ab".repeat(32)}`;

const summary = {
  periodPnl: "3000000", computableEventCount: 5, taxableEventCount: 2, pendingReviewCount: 0,
  currency: "KRW", period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
};

function anchored(over: Partial<ReportAnchorRecord> = {}): ReportAnchorRecord {
  return {
    fileHash: FILE_HASH,
    algorithm: "keccak256",
    kind: "csv",
    countryCode: "KR",
    taxYear: 2027,
    byteLength: 1234,
    recordedAt: "2027-05-01T00:00:00.000Z",
    anchorStatus: "anchored",
    attempt: 1,
    txHash: TX_HASH,
    blockNumber: "1284",
    anchoredAt: "2027-05-01T00:00:01.200Z",
    explorerUrl: null,
    failureReason: null,
    lastFailureAt: null,
    ...over,
  };
}

const pending = (over: Partial<ReportAnchorRecord> = {}) =>
  anchored({ anchorStatus: "pending", txHash: null, blockNumber: null, anchoredAt: null, ...over });

const failed = (over: Partial<ReportAnchorRecord> = {}) =>
  anchored({
    anchorStatus: "failed", txHash: null, blockNumber: null, anchoredAt: null,
    failureReason: "체인 노드가 응답하지 않았습니다.", lastFailureAt: "2027-05-01T00:00:02.000Z", ...over,
  });

/** 저장된 파일. 이름과 바이트를 함께 본다 — 등록이 확정되기 전에 파일이 나가면 여기 남는다. */
const saved: { filename: string; blob: Blob }[] = [];
let realClick: typeof HTMLAnchorElement.prototype.click;
let realCreate: typeof URL.createObjectURL;
let realRevoke: typeof URL.revokeObjectURL;
/** 포트 호출 순서. "조회가 먼저, 등록은 필요할 때만"이 이 게이트의 계약이다. */
let order: string[] = [];

beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset();
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summary);
  ports.estimate.mockResolvedValue(estimate);
  ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  ports.latest.mockResolvedValue(null);

  order = [];
  saved.length = 0;
  let nextBlob: Blob | null = null;
  realClick = HTMLAnchorElement.prototype.click;
  realCreate = URL.createObjectURL;
  realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (object: Blob | MediaSource) => { nextBlob = object as Blob; return "blob:stub"; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
    saved.push({ filename: this.download, blob: nextBlob as Blob });
  };
});

afterEach(() => {
  HTMLAnchorElement.prototype.click = realClick;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  vi.useRealTimers();
});

async function renderMain(gateEnabled = true) {
  const view = renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027, gateEnabled });
  const csv = await screen.findByRole("button", { name: "직접 신고용 내려받기" });
  // 버튼이 열리는 순간이 곧 "계산까지 확정됨"이다 — 계산이 오는 중이면 화면이 버튼을 열지 않는다.
  await waitFor(() => expect(csv).toBeEnabled());
  return { ...view, csv };
}

const cardOf = (kind: "csv" | "xlsx") => document.querySelector(`[data-anchor-kind="${kind}"]`) as HTMLElement;
const surface = (name: string) => document.querySelector(`[data-surface="${name}"]`);

describe("내보내기 등록 게이트", () => {
  it("누르면 조회부터 하고, 등록이 확정된 뒤에 파일이 나간다", async () => {
    ports.anchorGet.mockImplementation(async () => { order.push("get"); return null; });
    ports.anchorRegister.mockImplementation(async () => { order.push("register"); return anchored(); });
    const { csv } = await renderMain();

    fireEvent.click(csv);
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(order).toEqual(["get", "register"]);
    // 조회 키는 복합이다. 해시만 보내면 빈 기간에서 다른 연도의 기록을 집어 온다.
    expect(ports.anchorGet.mock.calls[0][0]).toEqual({
      fileHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      kind: "csv", countryCode: "KR", taxYear: 2027,
    });
    // 등록에 싣는 것은 일곱 필드뿐이다. 조회한 해시와 같은 해시를 등록한다.
    const input = ports.anchorRegister.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(["algorithm", "byteLength", "countryCode", "fileHash", "kind", "taxYear", "version"]);
    expect(input).toMatchObject({ version: 1, algorithm: "keccak256", kind: "csv", countryCode: "KR", taxYear: 2027 });
    expect(input.fileHash).toBe((ports.anchorGet.mock.calls[0][0] as { fileHash: string }).fileHash);
    // 해시를 낸 바이트와 저장한 바이트가 같아야 등록이 의미를 가진다.
    expect(input.byteLength).toBe(saved[0].blob.size);
    expect(saved[0].filename).toMatch(/\.csv$/);
  });

  it("등록하는 동안 버튼은 눌리지 않고, 무엇을 기다리는지 말한다", async () => {
    let finish: (record: ReportAnchorRecord) => void = () => {};
    ports.anchorGet.mockResolvedValue(null);
    ports.anchorRegister.mockReturnValue(new Promise<ReportAnchorRecord>((resolve) => { finish = resolve; }));
    const { csv } = await renderMain();

    fireEvent.click(csv);

    expect(await screen.findByText("체인에 등록하는 중입니다. 등록이 끝나면 파일이 저장됩니다.")).toBeInTheDocument();
    expect(surface("anchor-progress")).not.toBeNull();
    expect(csv).toBeDisabled();
    expect(csv).toHaveTextContent("체인에 등록하는 중…");
    expect(saved).toHaveLength(0);

    await act(async () => { finish(anchored()); });
    await waitFor(() => expect(saved).toHaveLength(1));
  });

  it("등록이 pending이면 확정될 때까지 폴링하고 그 뒤에야 저장한다", async () => {
    ports.anchorGet.mockResolvedValueOnce(null).mockResolvedValue(anchored());
    ports.anchorRegister.mockResolvedValue(pending());
    const { csv } = await renderMain();

    vi.useFakeTimers();
    fireEvent.click(csv);
    await act(async () => {});
    await act(async () => {});
    expect(saved).toHaveLength(0);
    expect(surface("anchor-progress")).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    expect(saved).toHaveLength(1);
    expect(surface("anchor-done")).not.toBeNull();
  });

  it("진행 중인 시도가 이미 있으면 다시 등록하지 않고 그 시도에 올라탄다", async () => {
    ports.anchorGet.mockResolvedValueOnce(pending()).mockResolvedValue(anchored());
    const { csv } = await renderMain();

    vi.useFakeTimers();
    fireEvent.click(csv);
    await act(async () => {});
    await act(async () => {});

    expect(ports.anchorRegister).not.toHaveBeenCalled();
    // 첫 시도와 다른 문구다. 사용자가 "또 누른 건가?"를 묻지 않게 한다.
    expect(screen.getByText("이미 등록을 요청한 파일입니다. 확정될 때까지 기다리는 중입니다.")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    expect(ports.anchorRegister).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
  });

  it("등록이 실패하면 파일을 내보내지 않고 이유와 다시 시도를 보인다", async () => {
    ports.anchorGet.mockResolvedValue(null);
    ports.anchorRegister.mockResolvedValue(failed());
    const { csv } = await renderMain();

    fireEvent.click(csv);

    expect(await screen.findByText(/체인 노드가 응답하지 않았습니다/)).toBeInTheDocument();
    expect(saved).toHaveLength(0);
    expect(surface("anchor-failed")).not.toBeNull();
    expect(surface("anchor-done")).toBeNull();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(csv).toBeDisabled();
  });

  it("등록 호출 자체가 던져도 조용히 파일을 내보내지 않는다", async () => {
    ports.anchorGet.mockResolvedValue(null);
    ports.anchorRegister.mockRejectedValue(new Error("등록 요청이 거절됐습니다."));
    const { csv } = await renderMain();

    fireEvent.click(csv);

    expect(await screen.findByText("등록 요청이 거절됐습니다.")).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it("제한 시간 안에 확정되지 않으면 기다림을 끝내고 파일은 내보내지 않는다", async () => {
    ports.anchorGet.mockResolvedValueOnce(null).mockResolvedValue(pending());
    ports.anchorRegister.mockResolvedValue(pending());
    const { csv } = await renderMain();

    vi.useFakeTimers();
    fireEvent.click(csv);
    await act(async () => {});
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });

    expect(saved).toHaveLength(0);
    expect(surface("anchor-failed")?.textContent).toMatch(/제한 시간/);
  });

  it("실패한 뒤에도 빠져나갈 길이 있다. 다시 시도가 새 시도를 연다", async () => {
    ports.anchorGet.mockResolvedValue(null);
    ports.anchorRegister.mockResolvedValueOnce(failed()).mockResolvedValue(anchored({ attempt: 2 }));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    const retry = await screen.findByRole("button", { name: "다시 시도" });
    expect(saved).toHaveLength(0);

    fireEvent.click(retry);
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(ports.anchorRegister).toHaveBeenCalledTimes(2);
    expect(surface("anchor-done")).not.toBeNull();
    expect(surface("anchor-failed")).toBeNull();
  });

  it("이미 등록된 파일은 새 트랜잭션 없이 바로 저장한다", async () => {
    ports.anchorGet.mockResolvedValue(anchored());
    const { csv } = await renderMain();

    fireEvent.click(csv);
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(ports.anchorRegister).not.toHaveBeenCalled();
    expect(ports.anchorGet).toHaveBeenCalledTimes(1);
  });

  it("카드에 처음 닿을 때만 등록 여부를 확인하고, 파일은 내보내지 않는다", async () => {
    ports.anchorGet.mockResolvedValue(anchored());
    await renderMain();

    // 마운트만으로는 파일도 만들지 않고 네트워크도 건드리지 않는다.
    expect(ports.anchorGet).not.toHaveBeenCalled();

    fireEvent.pointerOver(cardOf("csv"));
    await waitFor(() => expect(surface("anchor-done")).not.toBeNull());
    expect(ports.anchorGet).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(0);

    // 호버·포커스를 반복해도 조회는 늘지 않는다.
    fireEvent.pointerOver(cardOf("csv"));
    fireEvent.focusIn(cardOf("csv"));
    await act(async () => {});
    expect(ports.anchorGet).toHaveBeenCalledTimes(1);
    // 카드마다 자기 파일을 따로 확인한다. 한 장을 건드렸다고 다른 장이 등록을 말하지 않는다.
    expect(surface("anchor-done")?.closest("[data-anchor-kind]")).toHaveAttribute("data-anchor-kind", "csv");
  });

  it("연도를 바꾸면 앞 파일의 등록 상태를 버리고 새 키로 다시 확인한다", async () => {
    ports.anchorGet.mockResolvedValue(anchored());
    const { csv } = await renderMain();

    fireEvent.pointerOver(cardOf("csv"));
    await waitFor(() => expect(surface("anchor-done")).not.toBeNull());
    expect(ports.anchorGet.mock.calls[0][0]).toMatchObject({ taxYear: 2027 });

    // 연도 칩 → 바텀시트 → 다른 해. 훅은 마운트된 채 입력만 갈리는 경로다.
    fireEvent.click(screen.getByRole("button", { name: /2027년 귀속/ }));
    fireEvent.click(await screen.findByRole("button", { name: /2026년 귀속/ }));

    // 옛 파일의 등록 한 줄이 새 연도의 사실인 척 남지 않는다.
    await waitFor(() => expect(surface("anchor-done")).toBeNull());
    // 새 연도의 계산이 오는 동안에는 버튼이 닫혀 있고(만들 파일이 아직 확정되지 않았다), 오면 다시 열린다.
    await waitFor(() => expect(csv).toBeEnabled());

    // 복원도 다시 열린다 — 이번엔 새 연도의 키로 묻는다.
    fireEvent.pointerOver(cardOf("csv"));
    await waitFor(() => expect(ports.anchorGet).toHaveBeenCalledTimes(2));
    expect(ports.anchorGet.mock.calls[1][0]).toMatchObject({ kind: "csv", countryCode: "KR", taxYear: 2026 });
  });

  it("계산이 아직 오는 중이면 내려받기를 열지 않는다", async () => {
    let releaseEstimate: () => void = () => {};
    ports.estimate.mockImplementationOnce(() => new Promise((resolve) => { releaseEstimate = () => resolve(estimate); }));
    ports.anchorGet.mockResolvedValue(null);
    ports.anchorRegister.mockResolvedValue(anchored());
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027, gateEnabled: true });

    const csv = await screen.findByRole("button", { name: "직접 신고용 내려받기" });
    // 원장·요약은 도착했다(`ready`). 남은 것은 계산뿐이고, 그 계산도 파일의 일부다 —
    // 지금 만든 파일의 해시를 등록하면 곧 도착할 계산이 빠진 파일을 등록한 것이 된다.
    await waitFor(() => expect(screen.queryByText("거래 내역을 불러오는 중입니다.")).toBeNull());
    expect(csv).toBeDisabled();

    fireEvent.click(csv);
    await act(async () => {});
    expect(ports.anchorGet).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);

    // 계산이 도착하면 그때 열린다.
    await act(async () => { releaseEstimate(); });
    await waitFor(() => expect(csv).toBeEnabled());
  });

  it("게이트를 끄면 계산이 오는 중이어도 예전처럼 열려 있다", async () => {
    // 스위치를 내린 배포는 이 브랜치 이전과 한 글자도 다르지 않아야 한다 — 그 잠금은 게이트의 것이다.
    ports.estimate.mockImplementationOnce(() => new Promise(() => {}));
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027, gateEnabled: false });

    const csv = await screen.findByRole("button", { name: "직접 신고용 내려받기" });
    await waitFor(() => expect(screen.queryByText("거래 내역을 불러오는 중입니다.")).toBeNull());
    expect(csv).toBeEnabled();

    fireEvent.click(csv);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(ports.anchorGet).not.toHaveBeenCalled();
  });

  it("등록 중에 연도를 왕복해도 죽은 시도가 되살아나지 않는다", async () => {
    ports.anchorGet.mockResolvedValueOnce(null).mockResolvedValue(pending());
    ports.anchorRegister.mockResolvedValue(pending());
    const { csv } = await renderMain();

    vi.useFakeTimers();
    fireEvent.click(csv);
    await act(async () => {});
    await act(async () => {});
    expect(surface("anchor-progress")).not.toBeNull();
    expect(ports.anchorGet).toHaveBeenCalledTimes(1);

    // 2027 → 2026 → 2027. 돌아온 자리에 옛 스냅샷이 남아 있으면 폴링은 죽은 채로 버튼만 잠긴다.
    fireEvent.click(screen.getByRole("button", { name: /2027년 귀속/ }));
    fireEvent.click(screen.getByRole("button", { name: /2026년 귀속/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: /2026년 귀속/ }));
    fireEvent.click(screen.getByRole("button", { name: /2027년 귀속/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // 처음 상태로 돌아온 카드다 — 진행도 실패도 등록도 말하지 않고, 버튼은 눌린다.
    expect(surface("anchor-progress")).toBeNull();
    expect(surface("anchor-failed")).toBeNull();
    expect(surface("anchor-done")).toBeNull();
    expect(csv).toBeEnabled();

    // 끊긴 폴링은 시간이 지나도 다시 돌지 않는다(조회 수 그대로) — 파일도 나가지 않는다.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(ports.anchorGet).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(0);
  });

  it("사용자가 시키지 않은 계산 갱신이 등록을 끊으면 그 사실을 말한다", async () => {
    ports.anchorGet.mockResolvedValue(null);
    let finishRegister: () => void = () => {};
    ports.anchorRegister.mockReturnValue(new Promise<ReportAnchorRecord>((resolve) => { finishRegister = () => resolve(anchored()); }));
    const { csv, client } = await renderMain();

    // 아직 아무 시도도 없던 카드는 계산이 갱신돼도 말할 것이 없다. 첫 로딩을 경고로 만들지 않는다.
    ports.estimate.mockResolvedValue({ ...estimate, notes: ["갱신 전"] });
    await act(async () => { await client.invalidateQueries({ queryKey: ["tax"] }); });
    expect(surface("anchor-failed")).toBeNull();
    await waitFor(() => expect(csv).toBeEnabled());

    fireEvent.click(csv);
    expect(await screen.findByText("체인에 등록하는 중입니다. 등록이 끝나면 파일이 저장됩니다.")).toBeInTheDocument();

    // 등록이 도는 중에 백그라운드 재조회가 다른 계산을 물어 온다. 파일이 갈리므로 이 등록은 끊긴다.
    ports.estimate.mockResolvedValue({ ...estimate, notes: ["갱신 후"] });
    await act(async () => { await client.invalidateQueries({ queryKey: ["tax"] }); });

    // 조용히 idle로 돌아가면 사용자는 누른 적 없는 버튼 앞에 선다. 끊긴 이유를 남기고 길을 준다.
    // (재조회 알림은 무효화 프라미스보다 한 틱 늦게 도착한다 — 그래서 단언이 아니라 기다림이다.)
    await waitFor(() => expect(screen.getByText("계산이 갱신되어 등록을 다시 시작해야 합니다.")).toBeInTheDocument());
    expect(surface("anchor-progress")).toBeNull();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();

    // 끊긴 등록이 뒤늦게 확정돼도 파일은 나가지 않는다 — 그 바이트는 이미 이 화면의 파일이 아니다.
    await act(async () => { finishRegister(); });
    expect(saved).toHaveLength(0);
    expect(surface("anchor-done")).toBeNull();
    expect(surface("anchor-failed")).not.toBeNull();
  });

  it("느린 복원 조회는 그 사이 끝난 클릭 흐름의 결론을 덮지 않는다", async () => {
    let finishRestore: (record: ReportAnchorRecord | null) => void = () => {};
    ports.anchorGet
      // 첫 호출은 카드 접촉이 연 복원 조회다. 응답을 손에 쥐고 있다가 흐름이 끝난 뒤에 돌려준다.
      .mockReturnValueOnce(new Promise<ReportAnchorRecord | null>((resolve) => { finishRestore = resolve; }))
      .mockResolvedValue(null);
    ports.anchorRegister.mockResolvedValue(failed());
    const { csv } = await renderMain();

    fireEvent.pointerOver(cardOf("csv"));
    fireEvent.click(csv);
    expect(await screen.findByText(/체인 노드가 응답하지 않았습니다/)).toBeInTheDocument();

    await act(async () => { finishRestore(anchored()); });

    expect(surface("anchor-done")).toBeNull();
    expect(surface("anchor-failed")).not.toBeNull();
    expect(saved).toHaveLength(0);
  });

  it("등록 한 줄은 시각·파일 해시·거래 해시를 앞자리만 보인다", async () => {
    ports.anchorGet.mockResolvedValue(anchored());
    await renderMain();

    fireEvent.focusIn(cardOf("csv"));
    await waitFor(() => expect(surface("anchor-done")).not.toBeNull());

    const line = surface("anchor-done")?.textContent ?? "";
    expect(line).toContain("체인에 등록됨");
    expect(line).toContain(FILE_HASH.slice(0, 10));
    expect(line).toContain(TX_HASH.slice(0, 10));
    expect(line).toMatch(/2027/);
    // 탐색기가 없으면 링크를 만들지 않는다. 대신 조회에 쓸 전문을 남긴다.
    expect(screen.queryByRole("link", { name: /체인에서 확인하기/ })).toBeNull();
    expect(screen.getByText(TX_HASH)).toBeInTheDocument();
  });

  it("탐색기가 생기면 그 링크를 건다", async () => {
    ports.anchorGet.mockResolvedValue(anchored({ explorerUrl: "https://scan.example.test/tx/0xabc" }));
    await renderMain();

    fireEvent.focusIn(cardOf("csv"));
    await waitFor(() => expect(surface("anchor-done")).not.toBeNull());

    expect(screen.getByRole("link", { name: /체인에서 확인하기/ })).toHaveAttribute("href", "https://scan.example.test/tx/0xabc");
  });

  it("만들 수 없는 파일은 확인하지도 않는다", async () => {
    // 지갑 미연결은 `blockedReason`이 덮는 상태다. 게이트는 그 규칙 뒤에 선다.
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, walletConnected: false, gateEnabled: true });
    await screen.findByRole("button", { name: "직접 신고용 내려받기" });

    fireEvent.pointerOver(cardOf("csv"));
    await act(async () => {});

    expect(ports.anchorGet).not.toHaveBeenCalled();
    expect(surface("anchor-done")).toBeNull();
    expect(screen.getByRole("button", { name: "직접 신고용 내려받기" })).toBeDisabled();
  });

  it("게이트를 끄면 예전처럼 곧바로 같은 바이트를 저장한다", async () => {
    const { csv } = await renderMain(false);

    fireEvent.pointerOver(cardOf("csv"));
    fireEvent.click(csv);
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(ports.anchorGet).not.toHaveBeenCalled();
    expect(ports.anchorRegister).not.toHaveBeenCalled();
    expect(surface("anchor-progress")).toBeNull();
    expect(surface("anchor-done")).toBeNull();
    expect(surface("anchor-failed")).toBeNull();
    // 게이트 이전과 같은 파일이다 — 해시를 거치느라 바이트가 달라지지 않는다.
    expect(saved[0].blob.type).toBe("text/csv;charset=utf-8");
    expect(saved[0].blob.size).toBe(new TextEncoder().encode(createReportLedgerCsv([], estimate)).byteLength);
  });

  it("세무사 전달용도 같은 게이트를 지난다", async () => {
    ports.anchorGet.mockResolvedValue(null);
    ports.anchorRegister.mockResolvedValue(anchored({ kind: "xlsx" }));
    await renderMain();
    const xlsx = screen.getByRole("button", { name: "세무사 전달용 내려받기" });
    await waitFor(() => expect(xlsx).toBeEnabled());

    fireEvent.click(xlsx);
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(ports.anchorGet.mock.calls[0][0]).toMatchObject({ kind: "xlsx" });
    expect((ports.anchorRegister.mock.calls[0][0] as { kind: string }).kind).toBe("xlsx");
    expect(saved[0].filename).toMatch(/\.xlsx$/);
  });
});
