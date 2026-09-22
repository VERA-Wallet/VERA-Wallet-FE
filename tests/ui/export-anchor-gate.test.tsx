import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReportLedgerCsv } from "@/lib/export/report";
import { ruleSetListSchema } from "@/lib/http/tax-dto";
import type { EvidenceDetail } from "@/lib/ports/tax-evidence";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import type { EvidenceDocument, EvidenceFileLeaf } from "@/lib/tax/evidence";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";

const ports = vi.hoisted(() => ({
  list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn(), estimate: vi.fn(), listRuleSets: vi.fn(),
  // 셋 다 심어야 한다. `document`를 빼면 클릭 흐름이 죽고, `latest`를 빼면 복원이 죽는다.
  document: vi.fn(), latest: vi.fn(), record: vi.fn(),
}));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEngine: { estimate: ports.estimate, listRuleSets: ports.listRuleSets },
  taxEvidenceProvider: { document: ports.document, latest: ports.latest, record: ports.record },
}));

// 복원이 파일을 만드는지 보는 스파이. 묶음에서는 첫 접촉에 CSV·XLSX를 만들 이유가 없다(계획 §5).
const spies = vi.hoisted(() => ({ buildBundle: vi.fn() }));
vi.mock("@/lib/export/report-bundle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export/report-bundle")>();
  return {
    ...actual,
    buildReportBundle: (...args: Parameters<typeof actual.buildReportBundle>) => {
      spies.buildBundle();
      return actual.buildReportBundle(...args);
    },
  };
});

// 내려받기는 구독 전제다. 활성 플랜을 심어야 행이 열려 게이트까지 도달한다.
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  return { ...actual, usePlan: () => ({ plan: { tier: "pro" as const, taxYear: 2027, activatedAt: "2027-01-01T00:00:00.000Z" }, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { renderReportPages } from "@/tests/ui/helpers/report-pages";

const estimate = EVIDENCE_FIXTURE_ESTIMATE;
const TX_HASH = `0x${"ab".repeat(32)}`;
const OTHER_ROOT = `0x${"77".repeat(32)}`;

const summary = {
  periodPnl: "3000000", computableEventCount: 5, taxableEventCount: 2, pendingReviewCount: 0,
  currency: "KRW", period: { from: "2027-01-01T00:00:00.000Z", to: "2028-01-01T00:00:00.000Z" },
};

type AnchorStatus = "pending" | "anchored" | "failed";

/** 기록 한 건. 루트는 **묻는 쪽이 정한다** — mock이 다른 루트를 지어내면 계약이 아니라 더블을 검증한다. */
function detail(merkleRoot: string, anchorStatus: AnchorStatus): EvidenceDetail {
  const done = anchorStatus === "anchored";
  return {
    merkleRoot,
    countryCode: "KR",
    taxYear: 2027,
    leafCount: 8,
    version: 1,
    leaves: [],
    recordedAt: "2027-05-01T00:00:00.000Z",
    anchorStatus,
    txHash: done ? TX_HASH : null,
    blockNumber: done ? "1284" : null,
    anchoredAt: done ? "2027-05-01T00:00:01.200Z" : null,
    explorerUrl: null,
  };
}

/** 포트 호출 순서. "조회가 먼저, 등록은 사용자가 확인한 뒤"가 이 게이트의 계약이다. */
let order: string[] = [];

const answers = (status: AnchorStatus | null) => async (root: string) => {
  order.push("document");
  return status === null ? null : detail(root, status);
};
const records = (status: AnchorStatus) => async (evidence: EvidenceDocument) => {
  order.push("record");
  return detail(evidence.merkleRoot, status);
};

/** 저장된 파일. 이름과 바이트를 함께 본다 — 등록이 확정되기 전에 파일이 나가면 여기 남는다. */
const saved: { filename: string; blob: Blob }[] = [];
let realClick: typeof HTMLAnchorElement.prototype.click;
let realCreate: typeof URL.createObjectURL;
let realRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  for (const port of Object.values(ports)) port.mockReset();
  spies.buildBundle.mockClear();
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summary);
  ports.estimate.mockResolvedValue(estimate);
  ports.listRuleSets.mockImplementation(async () => ruleSetListSchema.parse(listRuleSetSummaries()));
  ports.latest.mockResolvedValue(null);
  ports.document.mockResolvedValue(null);

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
  // 행이 열리는 순간이 곧 "계산까지 확정됨"이다 — 계산이 오는 중이면 화면이 행을 열지 않는다.
  await waitFor(() => expect(csv).toBeEnabled());
  const xlsx = screen.getByRole("button", { name: "세무사 전달용 내려받기" });
  return { ...view, csv, xlsx };
}

const card = () => document.querySelector('[data-surface="download-card"]') as HTMLElement;
const surface = (name: string) => document.querySelector(`[data-surface="${name}"]`);
/** 시트의 「내려받기」. 카드 제목(「내려받기」)은 버튼이 아니고, 시트는 닫혀 있으면 렌더되지 않는다. */
const confirmIn = (sheet: HTMLElement) => within(sheet).getByRole("button", { name: "내려받기" });

describe("내보내기 묶음 등록 게이트", () => {
  it("행을 탭하면 시트가 열리고, 확인한 뒤에야 루트로 묻고 등록한다", async () => {
    ports.document.mockImplementation(answers(null));
    ports.record.mockImplementation(records("anchored"));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    const sheet = await screen.findByRole("dialog");
    // 탭 한 번이 곧 트랜잭션이 되지 않는다. 확인 전에는 등록도 저장도 없다.
    expect(ports.record).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);

    fireEvent.click(confirmIn(sheet));
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(order).toEqual(["document", "record"]);
    // 조회는 **루트 기준**이다. `latest()`로 폴링하면 계산을 고쳤다 되돌린 사용자가 이미 체인에
    // 올라간 루트를 두고 영원히 타임아웃한다(계획 §2).
    expect(ports.latest).not.toHaveBeenCalled();

    const askedRoot = ports.document.mock.calls[0][0] as string;
    expect(askedRoot).toMatch(/^0x[0-9a-f]{64}$/);
    const evidence = ports.record.mock.calls[0][0] as EvidenceDocument;
    // 조회한 루트를 그대로 등록한다. 둘이 갈리면 조회가 아무것도 막지 못한다.
    expect(evidence.merkleRoot).toBe(askedRoot);
    expect(evidence.version).toBe(1);
    // 묶음의 핵심 계약: 헤더가 0번이고, 파일 잎 둘이 판정 뒤 고정 순서로 붙는다.
    expect(evidence.leaves[0].kind).toBe("header");
    const files = evidence.leaves.slice(-2) as EvidenceFileLeaf[];
    expect(files.map((leaf) => leaf.kind)).toEqual(["file", "file"]);
    expect(files.map((leaf) => leaf.file)).toEqual(["csv", "xlsx"]);
    // 해시를 낸 바이트와 저장한 바이트가 같아야 등록이 의미를 가진다.
    expect(saved[0].filename).toMatch(/\.csv$/);
    expect(files[0].byteLength).toBe(saved[0].blob.size);
  });

  it("루트가 이미 등록돼 있으면 시트도 열지 않고 새 트랜잭션 없이 저장한다", async () => {
    ports.document.mockImplementation(answers("anchored"));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(ports.record).not.toHaveBeenCalled();
    expect(ports.document).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(surface("anchor-done")?.textContent).toContain("체인에 등록됐어요");
  });

  it("진행 중인 시도가 이미 있으면 다시 등록하지 않고 그 시도에 올라탄다", async () => {
    ports.document.mockImplementationOnce(answers("pending")).mockImplementation(answers("anchored"));
    const { csv } = await renderMain();

    vi.useFakeTimers();
    fireEvent.click(csv);
    await act(async () => {});
    await act(async () => {});

    expect(ports.record).not.toHaveBeenCalled();
    expect(surface("anchor-progress")?.textContent).toContain("이미 등록을 요청했어요");

    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    expect(ports.record).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
  });

  it("등록하는 동안 두 행이 함께 잠기고, 확정 전에는 파일이 나가지 않는다", async () => {
    ports.document.mockImplementation(answers(null));
    let finishRecord = () => {};
    ports.record.mockImplementation((evidence: EvidenceDocument) => new Promise<EvidenceDetail>((resolve) => {
      order.push("record");
      finishRecord = () => resolve(detail(evidence.merkleRoot, "anchored"));
    }));
    const { csv, xlsx } = await renderMain();

    fireEvent.click(csv);
    fireEvent.click(confirmIn(await screen.findByRole("dialog")));
    await waitFor(() => expect(surface("anchor-progress")).not.toBeNull());

    // 등록이 하나이므로 잠기는 것도 둘 다다 — 파일별 등록과 달라지는 지점이다.
    expect(csv).toBeDisabled();
    expect(xlsx).toBeDisabled();
    expect(saved).toHaveLength(0);

    await act(async () => { finishRecord(); });
    await waitFor(() => expect(saved).toHaveLength(1));
  });

  it("확인 단계에서 다른 행도 눌러 두면 등록은 한 번이고 둘 다 저장된다", async () => {
    ports.document.mockImplementation(answers(null));
    ports.record.mockImplementation(records("anchored"));
    const { csv, xlsx } = await renderMain();

    fireEvent.click(csv);
    const first = await screen.findByRole("dialog");
    // 같은 루트가 이미 확인 단계에 있다. 다른 행을 눌러도 새 조회·새 등록이 아니라 저장 목록에 더해진다.
    fireEvent.click(within(first).getByRole("button", { name: "닫기" }));
    fireEvent.click(xlsx);
    const second = await screen.findByRole("dialog");
    fireEvent.click(confirmIn(second));
    await waitFor(() => expect(saved).toHaveLength(2));

    expect(ports.record).toHaveBeenCalledTimes(1);
    expect(ports.document).toHaveBeenCalledTimes(1);
    expect(saved.map((file) => file.filename.slice(-4))).toEqual([".csv", "xlsx"]);
  });

  it("등록 직후의 failed는 아직 옛 라벨이다 — 유예 창 안에서는 계속 기다린다", async () => {
    // BE에서 `failed`는 `attempts >= 5` 뒤의 라벨이고 재POST는 큐에 다시 넣을 뿐이다.
    // 유예가 없으면 재시도가 누를 때마다 즉시 실패로 끝나 영원히 빠져나갈 수 없다.
    ports.document.mockImplementationOnce(answers(null)).mockImplementation(answers("failed"));
    ports.record.mockImplementation(records("failed"));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    const sheet = await screen.findByRole("dialog");
    vi.useFakeTimers();
    fireEvent.click(confirmIn(sheet));
    await act(async () => {});
    await act(async () => {});
    expect(surface("anchor-failed")).toBeNull();

    // 첫 두 폴링(1.5초·4.5초)은 유예 5초 안이다.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    expect(surface("anchor-failed")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(surface("anchor-failed")).toBeNull();
    expect(surface("anchor-progress")).not.toBeNull();

    // 세 번째 폴링은 9.5초다. 유예가 지났으므로 이제 `failed`는 실패다.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(surface("anchor-failed")?.textContent).toContain("체인에 등록하지 못했어요");
    expect(saved).toHaveLength(0);
  });

  it("폴링 간격은 1.5 → 3 → 5초로 점증한다", async () => {
    ports.document.mockImplementationOnce(answers(null)).mockImplementation(answers("pending"));
    ports.record.mockImplementation(records("pending"));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    const sheet = await screen.findByRole("dialog");
    vi.useFakeTimers();
    fireEvent.click(confirmIn(sheet));
    await act(async () => {});
    await act(async () => {});
    // 첫 조회(확인 단계) 한 번. 이후는 전부 폴링이다.
    expect(ports.document).toHaveBeenCalledTimes(1);

    const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
    await tick(1_400); expect(ports.document).toHaveBeenCalledTimes(1);
    await tick(200); expect(ports.document).toHaveBeenCalledTimes(2);
    await tick(2_800); expect(ports.document).toHaveBeenCalledTimes(2);
    await tick(200); expect(ports.document).toHaveBeenCalledTimes(3);
    await tick(4_800); expect(ports.document).toHaveBeenCalledTimes(3);
    await tick(200); expect(ports.document).toHaveBeenCalledTimes(4);
    expect(saved).toHaveLength(0);
  });

  it("제한 시간 안에 확정되지 않으면 기다림을 끝내고 파일은 내보내지 않는다", async () => {
    ports.document.mockImplementationOnce(answers(null)).mockImplementation(answers("pending"));
    ports.record.mockImplementation(records("pending"));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    const sheet = await screen.findByRole("dialog");
    vi.useFakeTimers();
    // 간격이 점증하므로 예산을 넘겨 보는 폴링은 59.5초가 아니라 64.5초다.
    fireEvent.click(confirmIn(sheet));
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });

    expect(saved).toHaveLength(0);
    // 타임아웃도 같은 고정 문구다 — BE가 사유를 주지 않으므로 지어내지 않는다(F1).
    expect(surface("anchor-failed")?.textContent).toContain("체인에 등록하지 못했어요. 다시 시도하면 새로 등록해요.");
  });

  it("실패한 뒤에도 빠져나갈 길이 있다. 다시 시도가 새 등록을 연다", async () => {
    ports.document.mockImplementationOnce(answers(null)).mockImplementation(answers("failed"));
    ports.record.mockImplementationOnce(records("failed")).mockImplementation(records("anchored"));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    const sheet = await screen.findByRole("dialog");
    vi.useFakeTimers();
    fireEvent.click(confirmIn(sheet));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(saved).toHaveLength(0);
    expect(surface("anchor-failed")).not.toBeNull();

    fireEvent.click(within(sheet).getByRole("button", { name: "다시 시도" }));
    await act(async () => {});
    await act(async () => {});

    expect(ports.record).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(1);
    expect(surface("anchor-done")).not.toBeNull();
    expect(surface("anchor-failed")).toBeNull();
  });

  it("등록 호출 자체가 던져도 조용히 파일을 내보내지 않는다", async () => {
    ports.document.mockImplementation(answers(null));
    ports.record.mockRejectedValue(new Error("등록 요청이 거절됐습니다."));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    fireEvent.click(confirmIn(await screen.findByRole("dialog")));

    // 카드 상단 줄과 시트가 같은 사실을 말한다. 어느 쪽을 보고 있든 실패를 놓치지 않게.
    expect(await screen.findAllByText("등록 요청이 거절됐습니다.")).toHaveLength(2);
    expect(saved).toHaveLength(0);
  });

  it("카드에 처음 닿으면 최근 등록만 읽는다 — 파일도 루트도 만들지 않는다", async () => {
    ports.latest.mockResolvedValue(detail(OTHER_ROOT, "anchored"));
    await renderMain();

    // 마운트만으로는 아무것도 하지 않는다.
    expect(ports.latest).not.toHaveBeenCalled();

    fireEvent.pointerOver(card());
    await waitFor(() => expect(ports.latest).toHaveBeenCalledTimes(1));

    expect(ports.latest.mock.calls[0]).toEqual(["KR", 2027]);
    expect(ports.document).not.toHaveBeenCalled();
    expect(ports.record).not.toHaveBeenCalled();
    // 복원은 파일을 아예 만들지 않는다. 호버만 한 사람이 XLSX 생성 비용을 내지 않는다.
    expect(spies.buildBundle).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    // 루트를 맞춰 보지 않았으므로 「체인에 등록됐어요」라고 단정하지 않는다.
    expect(surface("anchor-done")).toBeNull();
    expect(surface("anchor-idle")?.textContent).toContain("최근 등록");
    // 시트는 탭했을 때만 열린다 — 복원 경로가 대화상자로 포커스를 끌고 가면 안 된다.
    expect(screen.queryByRole("dialog")).toBeNull();

    // 호버·포커스를 반복해도 조회는 늘지 않는다.
    fireEvent.pointerOver(card());
    fireEvent.focusIn(card());
    await act(async () => {});
    expect(ports.latest).toHaveBeenCalledTimes(1);
  });

  it("연도를 바꾸면 앞 루트의 등록 상태를 버린다", async () => {
    ports.document.mockImplementation(answers("anchored"));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    await waitFor(() => expect(surface("anchor-done")).not.toBeNull());

    // 연도 칩 → 바텀시트 → 다른 해. 훅은 마운트된 채 입력만 갈리는 경로다.
    fireEvent.click(screen.getByRole("button", { name: /2027년 귀속/ }));
    fireEvent.click(await screen.findByRole("button", { name: /2026년 귀속/ }));

    // 옛 루트의 등록 한 줄이 새 연도의 사실인 척 남지 않는다.
    await waitFor(() => expect(surface("anchor-done")).toBeNull());
    await waitFor(() => expect(csv).toBeEnabled());
    expect(surface("anchor-idle")).not.toBeNull();
  });

  it("등록 중에 연도를 왕복해도 죽은 시도가 되살아나지 않는다", async () => {
    ports.document.mockImplementationOnce(answers(null)).mockImplementation(answers("pending"));
    ports.record.mockImplementation(records("pending"));
    const { csv } = await renderMain();

    fireEvent.click(csv);
    const sheet = await screen.findByRole("dialog");
    vi.useFakeTimers();
    fireEvent.click(confirmIn(sheet));
    await act(async () => {});
    await act(async () => {});
    expect(surface("anchor-progress")).not.toBeNull();
    const polls = ports.document.mock.calls.length;

    // 2027 → 2026 → 2027. 돌아온 자리에 옛 스냅샷이 남아 있으면 폴링은 죽은 채로 행만 잠긴다.
    fireEvent.click(screen.getByRole("button", { name: /2027년 귀속/ }));
    fireEvent.click(screen.getByRole("button", { name: /2026년 귀속/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: /2026년 귀속/ }));
    fireEvent.click(screen.getByRole("button", { name: /2027년 귀속/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(surface("anchor-progress")).toBeNull();
    expect(surface("anchor-failed")).toBeNull();
    expect(surface("anchor-done")).toBeNull();
    expect(csv).toBeEnabled();

    // 끊긴 폴링은 시간이 지나도 다시 돌지 않는다 — 파일도 나가지 않는다.
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(ports.document.mock.calls.length).toBe(polls);
    expect(saved).toHaveLength(0);
  });

  it("사용자가 시키지 않은 계산 갱신이 등록을 끊으면 그 사실을 말한다", async () => {
    ports.document.mockImplementation(answers(null));
    let finishRecord = () => {};
    ports.record.mockImplementation((evidence: EvidenceDocument) => new Promise<EvidenceDetail>((resolve) => {
      finishRecord = () => resolve(detail(evidence.merkleRoot, "anchored"));
    }));
    const { csv, client } = await renderMain();

    fireEvent.click(csv);
    fireEvent.click(confirmIn(await screen.findByRole("dialog")));
    await waitFor(() => expect(surface("anchor-progress")).not.toBeNull());

    // 등록이 도는 중에 백그라운드 재조회가 다른 계산을 물어 온다. 루트가 갈리므로 이 등록은 끊긴다.
    ports.estimate.mockResolvedValue({ ...estimate, notes: ["갱신 후"] });
    await act(async () => { await client.invalidateQueries({ queryKey: ["tax"] }); });

    // 조용히 idle로 돌아가면 사용자는 누른 적 없는 행 앞에 선다. 끊긴 이유를 남기고 길을 준다.
    await waitFor(() => expect(screen.getByText("계산이 갱신되어 등록을 다시 시작해야 합니다.")).toBeInTheDocument());
    expect(surface("anchor-progress")).toBeNull();
    expect(surface("anchor-retry")).not.toBeNull();

    // 끊긴 등록이 뒤늦게 확정돼도 파일은 나가지 않는다 — 그 바이트는 이미 이 화면의 파일이 아니다.
    await act(async () => { finishRecord(); });
    expect(saved).toHaveLength(0);
    expect(surface("anchor-done")).toBeNull();
  });

  it("세무사 전달용으로 시작해도 저장되는 파일은 XLSX다", async () => {
    ports.document.mockImplementation(answers("anchored"));
    const { xlsx } = await renderMain();

    fireEvent.click(xlsx);
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(saved[0].filename).toMatch(/\.xlsx$/);
    expect(ports.record).not.toHaveBeenCalled();
  });

  it("등록할 계산 근거가 없는 기간은 게이트가 걸리지 않는다", async () => {
    // 파일은 온체인 값만으로 만들 수 있고, 등록할 「계산」이 없다는 것이 사실이다.
    // 하드 게이트의 취지는 "등록할 수 있는데 안 하고 내보내는 것"을 막는 것이다(계획 §11 확정 결정).
    ports.estimate.mockRejectedValue(new Error("engine down"));
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027, gateEnabled: true });
    const csv = await screen.findByRole("button", { name: "직접 신고용 내려받기" });
    await waitFor(() => expect(csv).toBeEnabled());

    fireEvent.pointerOver(card());
    fireEvent.click(csv);
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(ports.latest).not.toHaveBeenCalled();
    expect(ports.document).not.toHaveBeenCalled();
    expect(ports.record).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(surface("anchor-idle")?.textContent).toContain("등록할 계산 근거가 없어요");
  });

  it("만들 수 없는 파일은 확인하지도 않는다", async () => {
    // 지갑 미연결은 `blockedReason`이 덮는 상태다. 게이트는 그 규칙 뒤에 선다.
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, walletConnected: false, gateEnabled: true });
    await screen.findByRole("button", { name: "직접 신고용 내려받기" });

    fireEvent.pointerOver(card());
    await act(async () => {});

    expect(ports.latest).not.toHaveBeenCalled();
    expect(ports.document).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "직접 신고용 내려받기" })).toBeDisabled();
  });

  it("게이트를 끄면 예전처럼 곧바로 같은 바이트를 저장한다", async () => {
    const { csv } = await renderMain(false);

    fireEvent.pointerOver(card());
    fireEvent.click(csv);
    await waitFor(() => expect(saved).toHaveLength(1));

    expect(ports.latest).not.toHaveBeenCalled();
    expect(ports.document).not.toHaveBeenCalled();
    expect(ports.record).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(surface("anchor-idle")).toBeNull();
    expect(surface("anchor-progress")).toBeNull();
    expect(surface("anchor-done")).toBeNull();
    // 게이트 이전과 같은 파일이다 — 묶음을 거치느라 바이트가 달라지지 않는다.
    expect(saved[0].blob.type).toBe("text/csv;charset=utf-8");
    expect(saved[0].blob.size).toBe(new TextEncoder().encode(createReportLedgerCsv([], estimate)).byteLength);
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
    expect(ports.document).not.toHaveBeenCalled();
  });

  it("계산이 아직 오는 중이면 내려받기를 열지 않는다", async () => {
    let releaseEstimate: () => void = () => {};
    ports.estimate.mockImplementationOnce(() => new Promise((resolve) => { releaseEstimate = () => resolve(estimate); }));
    renderReportPages({ pages: ["main"], countryCode: "KR", currentYear: 2027, latestActivityYear: 2027, gateEnabled: true });

    const csv = await screen.findByRole("button", { name: "직접 신고용 내려받기" });
    // 원장·요약은 도착했다(`ready`). 남은 것은 계산뿐이고, 그 계산도 루트의 일부다.
    await waitFor(() => expect(screen.queryByText("거래 내역을 불러오는 중입니다.")).toBeNull());
    expect(csv).toBeDisabled();

    fireEvent.click(csv);
    await act(async () => {});
    expect(ports.document).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);

    await act(async () => { releaseEstimate(); });
    await waitFor(() => expect(csv).toBeEnabled());
  });

  it("접근성 이름과 잠금 표식은 화면 밖 테스트가 읽는 계약이다", async () => {
    const { csv, xlsx } = await renderMain();

    // 보이는 제목과 접근성 이름이 같아야 한다 — Playwright는 텍스트를, vitest는 접근성 이름을 본다.
    expect(csv).toHaveTextContent("직접 신고용 내려받기");
    expect(xlsx).toHaveTextContent("세무사 전달용 내려받기");
    // 카드 제목은 정확히 한 단어다(`report-split`이 완전 일치로 찾는다).
    expect(screen.getByText("내려받기")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "보고서 보기" })).toHaveAttribute("data-surface", "report-open");
    // 상태 줄은 스스로 말한다 — 시트를 닫고 백그라운드로 기다리는 경로가 있으므로.
    expect(surface("anchor-idle")?.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
  });
});
