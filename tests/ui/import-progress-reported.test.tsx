import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImportProgressGate } from "@/components/dashboard/import-progress-gate";
import { ImportChainList } from "@/components/wallet/import-chain-list";
import { chainLabel } from "@/lib/format";
import { eventQueryKey } from "@/lib/queries/events";
import { IMPORT_STEPS, SCAN_STEP_INDEX } from "@/lib/wallet/import-progress";
import { IMPORT_POLL_INTERVAL_MS, type ImportSyncProgress } from "@/lib/wallet/import-sync";
import {
  IDLE_IMPORT_TRACKER_STATE,
  importProgressFrom,
  importScanChains,
  reportedDoneChainCount,
  reportedProgressAt,
  reportedScanProgress,
} from "@/lib/wallet/import-tracker";
import { renderWithImportTracker } from "@/tests/support/import-tracker";

/**
 * BE가 진행 중 보고한 체인별 사실로 그리는 진행.
 *
 * 지켜야 하는 것: 보고가 있으면 타이머 연출을 쓰지 않을 것, 체인은 병렬로 끝나므로 순서와 무관하게 각 체인의
 * 실제 상태를 그릴 것, 지갑이 여럿이면 한 체인은 모든 지갑의 합으로 말할 것, 체인 하나가 저장을 마칠 때마다
 * 원장을 다시 받을 것(큰 지갑이 끝날 때까지 빈 화면이지 않도록).
 */

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/dashboard" }));

const ADDRESS = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

/** 지갑 둘. 1번 체인은 한 지갑이 아직 추적 중이고, 137은 둘 다 끝났고, 42161은 한 지갑이 실패했다. */
const reported: ImportSyncProgress = {
  updatedAt: "2026-09-19T00:00:00.000Z",
  bindings: [
    {
      bindingId: "b1",
      walletAddress: "0xA",
      chains: [
        { chainId: 1, phase: "tracing", fetched: 1200, traced: { done: 312, total: 1200 }, saved: 0 },
        { chainId: 10, phase: "pending", fetched: 0, saved: 0 },
        { chainId: 137, phase: "done", fetched: 968, saved: 968 },
        { chainId: 8453, phase: "saving", fetched: 571, saved: 300 },
        { chainId: 42161, phase: "failed", fetched: 0, saved: 0, message: "arbitrum-mainnet repeated pageKey (incomplete)" },
      ],
    },
    {
      bindingId: "b2",
      walletAddress: "0xB",
      chains: [
        { chainId: 1, phase: "done", fetched: 10, saved: 10 },
        { chainId: 10, phase: "pending", fetched: 0, saved: 0 },
        { chainId: 137, phase: "done", fetched: 2, saved: 2 },
        { chainId: 8453, phase: "done", fetched: 0, saved: 0 },
        { chainId: 42161, phase: "done", fetched: 5, saved: 5 },
      ],
    },
  ],
};

describe("reportedProgressAt", () => {
  it("merges every wallet into one line per chain and keeps each chain's own state", () => {
    const progress = reportedProgressAt(reported, 5_000);
    expect(progress.phase).toBe("running");
    expect(progress.stepIndex).toBe(SCAN_STEP_INDEX);
    expect(progress.chains?.[1]).toEqual({ state: "scanning", detail: "내부 이동 확인 312/1,200" });
    expect(progress.chains?.[10]).toEqual({ state: "pending", detail: null });
    expect(progress.chains?.[137]).toEqual({ state: "done", detail: null, txCount: 970 });
    expect(progress.chains?.[8453]).toEqual({ state: "scanning", detail: "저장 중 300/571" });
    expect(progress.chains?.[42161]).toEqual({ state: "failed", detail: "arbitrum-mainnet repeated pageKey (incomplete)" });
    // 끝난 체인(완료·실패)만 센다 — 조회 중인 체인을 끝났다고 말하지 않는다.
    expect(progress.scannedChainCount).toBe(2);
  });

  it("moves past the scan step once every chain has finished, but does not call the job done", () => {
    const finished: ImportSyncProgress = {
      ...reported,
      bindings: reported.bindings.map((binding) => ({ ...binding, chains: binding.chains.map((chain) => ({ ...chain, phase: "done" as const })) })),
    };
    const progress = reportedProgressAt(finished, 0);
    expect(progress.phase).toBe("running");
    expect(progress.stepIndex).toBe(SCAN_STEP_INDEX + 1);
    expect(progress.scannedChainCount).toBe(5);
  });

  it("tells only the connected wallet's story when asked, and falls back to every wallet when that wallet is not in the report", () => {
    const own = reportedProgressAt(reported, 0, "0xb"); // 대소문자 차이는 같은 지갑이다
    expect(own.chains?.[1]).toEqual({ state: "done", detail: null, txCount: 10 });
    expect(own.chains?.[42161]).toEqual({ state: "done", detail: null, txCount: 5 });
    expect(own.scannedChainCount).toBe(4);
    const all = reportedProgressAt(reported, 0, "0xnotbound");
    expect(all.chains?.[1]?.state).toBe("scanning");
  });

  it("says how many wallets are through a chain when some are done and none is being scanned", () => {
    const partial: ImportSyncProgress = {
      updatedAt: reported.updatedAt,
      bindings: [
        { bindingId: "b1", walletAddress: "0xA", chains: [{ chainId: 1, phase: "done", fetched: 4, saved: 4 }] },
        { bindingId: "b2", walletAddress: "0xB", chains: [{ chainId: 1, phase: "pending", fetched: 0, saved: 0 }] },
        { bindingId: "b3", walletAddress: "0xC", chains: [{ chainId: 1, phase: "pending", fetched: 0, saved: 0 }] },
      ],
    };
    // 한 지갑은 끝났고 나머지는 차례를 기다린다 — '대기'도 '완료'도 아니다.
    expect(reportedProgressAt(partial, 0).chains?.[1]).toEqual({ state: "scanning", detail: "지갑 1/3 완료" });
  });

  it("counts (wallet, chain) pairs that finished saving", () => {
    expect(reportedDoneChainCount(reported)).toBe(5);
    expect(reportedDoneChainCount(null)).toBe(0);
  });
});

describe("importProgressFrom with a report", () => {
  it("ignores the timer entirely while the job is running", () => {
    // 타이머라면 999초는 이미 '완료'다. 보고가 있으면 보고가 말하는 조회 단계에 그대로 있어야 한다.
    const progress = importProgressFrom("running", 999_000, 5, reported);
    expect(progress.stepIndex).toBe(SCAN_STEP_INDEX);
    expect(progress.chains?.[137]?.state).toBe("done");
  });

  it("shows done right away when the job is done — there is nothing left to animate", () => {
    const progress = importProgressFrom("done", 0, 5, reported);
    expect(progress.phase).toBe("done");
    expect(progress.stepIndex).toBe(IMPORT_STEPS.length);
  });

  it("puts a count only on chains that actually finished", () => {
    const chains = importScanChains(null, reported);
    expect(chains.find((chain) => chain.chainId === 137)?.txCount).toBe(970);
    expect(chains.find((chain) => chain.chainId === 1)?.txCount).toBeUndefined();
  });

  it("feeds the chip: how many chains are done and which one is being scanned", () => {
    const scan = reportedScanProgress({
      ...IDLE_IMPORT_TRACKER_STATE,
      status: "running",
      job: { jobId: "job-1", status: "running", progress: reported },
    });
    expect(scan).toEqual({ scannedChainCount: 2, totalChainCount: 5, currentChain: { chainId: 1, chainName: chainLabel(1) }, note: null });
  });

  it("explains a wallet that is still queued behind other wallets, in the modal and in the chip", () => {
    const queued: ImportSyncProgress = {
      updatedAt: reported.updatedAt,
      bindings: [
        { bindingId: "b1", walletAddress: "0xBIG", chains: [{ chainId: 1, phase: "tracing", fetched: 900, traced: { done: 10, total: 90 }, saved: 0 }] },
        { bindingId: "b2", walletAddress: "0xOTHER", chains: [{ chainId: 1, phase: "pending", fetched: 0, saved: 0 }] },
        { bindingId: "b3", walletAddress: "0xMINE", chains: [{ chainId: 1, phase: "pending", fetched: 0, saved: 0 }] },
      ],
    };
    const progress = reportedProgressAt(queued, 0, "0xmine");
    expect(progress.chains?.[1]?.state).toBe("pending");
    expect(progress.note).toBe("다른 지갑 2개를 먼저 불러오는 중");
    const scan = reportedScanProgress({ ...IDLE_IMPORT_TRACKER_STATE, status: "running", walletAddress: "0xMINE", job: { jobId: "job-1", status: "running", progress: queued } });
    expect(scan).toMatchObject({ scannedChainCount: 0, currentChain: null, note: "다른 지갑 2개를 먼저 불러오는 중" });
    // 내 지갑 차례가 오면 안내는 사라진다.
    const mine = reportedProgressAt({ ...queued, bindings: queued.bindings.map((b) => (b.bindingId === "b3" ? { ...b, chains: [{ chainId: 1, phase: "fetching" as const, fetched: 3, saved: 0 }] } : b)) }, 0, "0xmine");
    expect(mine.note).toBeNull();
  });
});

describe("ImportChainList with reported chains", () => {
  it("draws each chain's real state regardless of list order", () => {
    render(<ImportChainList chains={importScanChains(null, reported)} progress={reportedProgressAt(reported, 0)} />);
    const rows = within(screen.getByRole("list", { name: "조회할 체인" })).getAllByRole("listitem");
    const row = (chainId: number) => rows.find((item) => within(item).queryByText(chainLabel(chainId)) !== null)!;
    // 목록 순서는 1 → 10 → 137 → … 인데 137이 먼저 끝났다. 순서 기반 추정이면 10이 '조회 중', 137이 '대기'가 된다.
    expect(within(row(137)).getByText("완료")).toBeInTheDocument();
    expect(within(row(137)).getByText("거래 970건")).toBeInTheDocument();
    expect(within(row(10)).getByText("대기")).toBeInTheDocument();
    expect(within(row(1)).getByText("조회 중")).toBeInTheDocument();
    expect(within(row(1)).getByText("내부 이동 확인 312/1,200")).toBeInTheDocument();
    expect(within(row(8453)).getByText("저장 중 300/571")).toBeInTheDocument();
    expect(within(row(42161)).getByText("실패")).toBeInTheDocument();
    expect(within(row(42161)).getByText("arbitrum-mainnet repeated pageKey (incomplete)")).toBeInTheDocument();
  });
});

describe("ImportTracker refetches the ledger as chains land", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const envelope = (status: string, extra: Record<string, unknown> = {}) => ({
    data: { jobId: "job-1", status, createdAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z", ...extra },
  });
  const chains = (phases: Record<number, "pending" | "done">): ImportSyncProgress => ({
    updatedAt: "2026-09-19T00:00:00.000Z",
    bindings: [{ bindingId: "b1", walletAddress: ADDRESS, chains: [1, 10, 137, 8453, 42161].map((chainId) => ({ chainId, phase: phases[chainId] ?? "pending", fetched: 0, saved: 0 })) }],
  });
  const result = { bindings: 1, fetched: 3, normalized: 3, chains: [1, 8453, 42161, 10, 137].map((chainId) => ({ chainId, fetched: 0 })), skipped: [] };

  function jobFetch(steps: Array<{ status: string; extra?: Record<string, unknown> }>) {
    let polls = 0;
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/api/events/resync")) return json(envelope("queued"), 202);
      if (url.includes("/api/events/resync/job-1")) {
        const step = steps[Math.min(polls, steps.length - 1)];
        polls += 1;
        return json(envelope(step.status, step.extra));
      }
      throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });
  }
  const poll = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(IMPORT_POLL_INTERVAL_MS + 5);
      });
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    replace.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it("invalidates the ledger each time another chain finishes saving, not only at the end", async () => {
    vi.stubGlobal(
      "fetch",
      jobFetch([
        { status: "running", extra: { progress: chains({}) } },
        { status: "running", extra: { progress: chains({ 137: "done" }) } },
        { status: "running", extra: { progress: chains({ 137: "done" }) } }, // 같은 상태 — 다시 받지 않는다
        { status: "running", extra: { progress: chains({ 137: "done", 1: "done" }) } },
        { status: "done", extra: { result, progress: chains({ 137: "done", 1: "done" }) } },
      ]),
    );
    const rendered = renderWithImportTracker(<ImportProgressGate walletAddress={ADDRESS} />);
    const invalidate = vi.spyOn(rendered.queryClient, "invalidateQueries");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
    const ledgerInvalidations = () => invalidate.mock.calls.filter(([filters]) => filters?.queryKey === eventQueryKey).length;

    await poll(2); // 대기 → 137 완료
    expect(ledgerInvalidations()).toBe(1);
    await poll(1); // 같은 보고 — 늘지 않는다
    expect(ledgerInvalidations()).toBe(1);
    await poll(1); // 1번 체인도 완료
    expect(ledgerInvalidations()).toBe(2);
    await poll(1); // 작업 완료: 완료 시점의 무효화(원장은 refetchType none)가 더해진다
    expect(ledgerInvalidations()).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("dialog", { name: "거래를 불러왔습니다" })).toBeInTheDocument();
  });
});
