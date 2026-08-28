import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImportProgressGate } from "@/components/dashboard/import-progress-gate";
import { ImportProgressModal } from "@/components/wallet/import-progress-modal";
import { demoDefiPositions, demoNftHoldings, demoWalletChains, demoWalletHoldings, walletChains } from "@/lib/wallet/holdings";
import { chainLabel } from "@/lib/format";
import {
  EVM_CHAIN_IDS,
  IMPORT_STEPS,
  IMPORT_STEP_DURATIONS_MS,
  SCAN_STEP_INDEX,
  SLOW_IMPORT_MS,
  chainScanState,
  importProgressPercent,
  isEvmChain,
  mockProgressAt,
  stepState,
  type ImportProgress,
  type ScanChain,
} from "@/lib/wallet/import-progress";

/**
 * 지갑 연결 직후 "거래 불러오는 중" 모달.
 *
 * 이 화면이 지켜야 하는 것은 넷이다 — 진행을 **사실대로** 말할 것(끝나지 않은 단계를 끝났다고 하지 않기),
 * **무엇을 훑는지** 보일 것(자산이 있는 체인), 기다리지 않을 자유를 줄 것(백그라운드),
 * 그리고 끝나면 **스스로 비켜줄 것**. 마지막 하나가 깨지면 불러오기가 끝난 뒤에도 대시보드가 영영 가려진다.
 */

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const ADDRESS = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

/** 세 체인짜리 합성 목록. `txCount`는 resync 응답이 준 수집 건수다. */
const CHAINS: ScanChain[] = [
  { chainId: 1, chainName: "Ethereum", txCount: 5 },
  { chainId: 137, chainName: "Polygon", txCount: 2 },
  { chainId: 8453, chainName: "Base", txCount: 1 },
];

function running(stepIndex: number, elapsedMs = 0, scannedChainCount = 0): ImportProgress {
  return { phase: "running", stepIndex, elapsedMs, scannedChainCount };
}

function renderModal(progress: ImportProgress, overrides: Partial<{ onBackground: () => void; onRetry: () => void; chains: ScanChain[] }> = {}) {
  return render(
    <ImportProgressModal
      open
      progress={progress}
      walletAddress={ADDRESS}
      chains={overrides.chains ?? CHAINS}
      onBackground={overrides.onBackground ?? (() => undefined)}
      onRetry={overrides.onRetry}
    />,
  );
}

/** 단계 li를 라벨로 집는다. 아이콘은 aria-hidden이라 상태는 글자와 sr-only 문장으로만 확인한다. */
function stepItem(label: string) {
  return within(screen.getByRole("list", { name: "불러오기 진행 단계" })).getByText(label).closest("li")!;
}

/** 체인 li를 이름으로 집는다. */
function chainItem(name: string) {
  return within(screen.getByRole("list", { name: "조회할 체인" })).getByText(name).closest("li")!;
}

afterEach(() => {
  replace.mockReset();
});

describe("보유 체인 집계", () => {
  it("자산이 있는 체인만, 자산이 많은 순으로 나온다", () => {
    const chains = walletChains(
      [{ chainId: 1 }, { chainId: 1 }, { chainId: 137 }] as never,
      [{ chainId: 8453 }] as never,
      [{ chainId: 137 }] as never,
    );
    // 1은 2건, 137은 2건(토큰+디파이), 8453은 1건 → 동수는 chainId 오름차순.
    expect(chains.map((chain) => chain.chainId)).toEqual([1, 137, 8453]);
    expect(chains.map((chain) => chain.assetCount)).toEqual([2, 2, 1]);
  });

  it("보유가 없는 체인은 아예 목록에 없다", () => {
    // 잔액 없는 체인을 훑는 것은 사용자에게도 인덱서에도 낭비다.
    const chains = walletChains([{ chainId: 1 }] as never, [], []);
    expect(chains).toHaveLength(1);
    expect(chains[0].chainId).toBe(1);
  });

  it("데모 지갑의 체인은 지갑 홈이 그리는 자산과 같은 소스에서 나온다", () => {
    const expected = walletChains(demoWalletHoldings(), demoNftHoldings(), demoDefiPositions());
    expect(demoWalletChains()).toEqual(expected);
    // 두 소스가 갈리면 불러오기 화면과 지갑 홈이 서로 다른 체인을 말하게 된다.
    expect(demoWalletChains().length).toBeGreaterThan(1);
  });

  it("데모 체인은 전부 EVM이고 이름을 아는 체인이다", () => {
    for (const chain of demoWalletChains()) {
      expect(isEvmChain(chain.chainId)).toBe(true);
      // 이름을 모르는 체인이 섞이면 화면이 "chain 999를 조회하는 중"이라고 말한다.
      expect(chain.chainName).not.toMatch(/^chain /);
    }
  });

  it("인식 대상은 EVM 체인뿐이다", () => {
    expect(EVM_CHAIN_IDS).toContain(1);
    // 비EVM(예: Solana의 관용 식별자)은 지금 인식 대상이 아니다.
    expect(isEvmChain(101)).toBe(false);
  });
});

describe("불러오기 진행 모델", () => {
  it("경과 시간이 단계 경계를 넘을 때만 다음 단계로 넘어간다", () => {
    // 첫 단계 지속시간 직전은 아직 0번, 직후는 1번이어야 한다. 경계에서 한 칸 앞서면
    // 화면이 끝나지 않은 일을 끝났다고 말하게 된다.
    expect(mockProgressAt(IMPORT_STEP_DURATIONS_MS[0] - 1, 3)).toMatchObject({ phase: "running", stepIndex: 0 });
    expect(mockProgressAt(IMPORT_STEP_DURATIONS_MS[0], 3)).toMatchObject({ phase: "running", stepIndex: 1 });
  });

  it("모든 단계를 지나면 완료가 되고 남은 단계도 남은 체인도 없다", () => {
    const total = IMPORT_STEP_DURATIONS_MS.reduce((sum, duration) => sum + duration, 0);
    const progress = mockProgressAt(total, 3);
    expect(progress.phase).toBe("done");
    expect(progress.scannedChainCount).toBe(3);
    expect(importProgressPercent(progress)).toBe(100);
    for (const [index] of IMPORT_STEPS.entries()) expect(stepState(progress, index)).toBe("done");
  });

  it("체인은 조회 단계 안에서만 하나씩 끝난다", () => {
    const scanStartedAt = IMPORT_STEP_DURATIONS_MS[0];
    const scanDuration = IMPORT_STEP_DURATIONS_MS[SCAN_STEP_INDEX];
    // 조회 시작 직후엔 아무 체인도 끝나지 않았다.
    expect(mockProgressAt(scanStartedAt, 3).scannedChainCount).toBe(0);
    // 절반쯤이면 3개 중 1개.
    expect(mockProgressAt(scanStartedAt + scanDuration / 2, 3).scannedChainCount).toBe(1);
    // 조회 단계가 끝나기 전에는 마지막 체인이 끝나지 않는다 — 미리 3을 주면 끝난 척이 된다.
    expect(mockProgressAt(scanStartedAt + scanDuration - 1, 3).scannedChainCount).toBe(2);
  });

  it("조회 단계 이전에는 어떤 체인도 시작하지 않는다", () => {
    const progress = mockProgressAt(0, 3);
    expect(progress.scannedChainCount).toBe(0);
    for (const [index] of CHAINS.entries()) expect(chainScanState(progress, index)).toBe("pending");
  });

  it("조회 단계를 지나면 모든 체인이 완료다", () => {
    // 정규화·손익 계산 중인데 체인이 "대기"로 남아 있으면 화면이 뒤로 간 것처럼 보인다.
    const progress = running(SCAN_STEP_INDEX + 1, 5_000, 3);
    for (const [index] of CHAINS.entries()) expect(chainScanState(progress, index)).toBe("done");
  });

  it("조회 중에는 끝난 체인·현재 체인·대기 체인이 갈린다", () => {
    const progress = running(SCAN_STEP_INDEX, 2_000, 1);
    expect(chainScanState(progress, 0)).toBe("done");
    expect(chainScanState(progress, 1)).toBe("scanning");
    expect(chainScanState(progress, 2)).toBe("pending");
  });

  it("실패는 조회 중이던 체인에만 붙고 끝난 체인을 되돌리지 않는다", () => {
    // 이미 조회한 체인의 거래는 실제로 손에 있다. 전부 실패로 칠하면 사용자는 아무것도 안 됐다고 읽는다.
    const progress: ImportProgress = { phase: "failed", stepIndex: SCAN_STEP_INDEX, elapsedMs: 5_000, scannedChainCount: 1 };
    expect(chainScanState(progress, 0)).toBe("done");
    expect(chainScanState(progress, 1)).toBe("failed");
    expect(chainScanState(progress, 2)).toBe("pending");
  });

  it("진행 중에는 현재 단계만 running이고 뒤는 pending이다", () => {
    const progress = running(1);
    expect(stepState(progress, 0)).toBe("done");
    expect(stepState(progress, 1)).toBe("running");
    expect(stepState(progress, 2)).toBe("pending");
  });

  it("단계 실패는 현재 단계에만 표시되고 앞서 끝난 단계를 되돌리지 않는다", () => {
    const progress: ImportProgress = { phase: "failed", stepIndex: 2, elapsedMs: 5_000, scannedChainCount: 3 };
    expect(stepState(progress, 0)).toBe("done");
    expect(stepState(progress, 2)).toBe("failed");
    expect(stepState(progress, 3)).toBe("pending");
  });

  it("진행률은 시간이 아니라 완료한 단계 수에서 나온다", () => {
    // 시간에서 뽑으면 실제 상태를 꽂는 순간 막대와 목록이 서로 다른 말을 한다.
    expect(importProgressPercent(running(0, 999_999))).toBe(0);
    expect(importProgressPercent(running(2, 0))).toBe(50);
  });
});

describe("불러오기 모달", () => {
  it("무엇을 어느 지갑에서 불러오는지 보여준다", () => {
    renderModal(running(1));
    expect(screen.getByRole("dialog", { name: "거래를 불러오는 중" })).toBeTruthy();
    // 주소 전문은 모달을 뒤덮으므로 축약형이되, 사용자가 자기 지갑임을 알아볼 만큼은 남는다.
    expect(screen.getByText(/0x71C765/)).toBeTruthy();
  });

  it("스캔 대상 체인을 전부 로고와 이름으로 나열한다", () => {
    renderModal(running(SCAN_STEP_INDEX, 2_000, 1));
    const list = screen.getByRole("list", { name: "조회할 체인" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(CHAINS.length);
    for (const chain of CHAINS) {
      // 아이콘만으로는 어느 체인인지 단정할 수 없다 — 이름이 함께 있어야 한다.
      expect(within(list).getByText(chain.chainName)).toBeTruthy();
      expect(list.querySelector(`[data-chain-icon="${chain.chainId}"]`)).toBeTruthy();
    }
    expect(screen.getByText(`지원하는 EVM 체인 ${CHAINS.length}곳`)).toBeTruthy();
  });

  it("수집 건수는 아는 체인에만 붙이고 모르는 값은 0으로 꾸미지 않는다", () => {
    renderModal(running(SCAN_STEP_INDEX, 2_000, 1));
    expect(within(chainItem("Ethereum")).getByText("거래 5건")).toBeTruthy();
    expect(within(chainItem("Base")).getByText("거래 1건")).toBeTruthy();

    // 응답 전에는 건수를 모른다 — 0을 그리면 "이 체인엔 아무것도 없다"로 읽힌다.
    renderModal(running(SCAN_STEP_INDEX, 2_000, 1), { chains: [{ chainId: 1, chainName: "Ethereum" }] });
    expect(screen.queryByText(/거래 0건/)).toBeNull();
  });

  it("체인별 조회 상태를 글자로 구분한다", () => {
    renderModal(running(SCAN_STEP_INDEX, 2_000, 1));
    // 색만으로 구분하면 저해상도·색맹 사용자에게는 세 줄이 같은 상태로 보인다.
    expect(within(chainItem("Ethereum")).getByText("완료")).toBeTruthy();
    expect(within(chainItem("Polygon")).getByText("조회 중")).toBeTruthy();
    expect(within(chainItem("Base")).getByText("대기")).toBeTruthy();
  });

  it("조회 단계에서는 몇 개 체인이 끝났는지 스크린리더에 알린다", () => {
    renderModal(running(SCAN_STEP_INDEX, 2_000, 1));
    // 단계 이름만 읽으면 진척이 없는 것처럼 들린다.
    expect(screen.getByText(`${IMPORT_STEPS[SCAN_STEP_INDEX].label} — 체인 3곳 중 1곳 완료`)).toBeTruthy();
  });

  it("진행 중인 단계만 무엇을 기다리는지 말한다", () => {
    renderModal(running(1));
    const current = IMPORT_STEPS[1];
    expect(within(stepItem(current.label)).getByText(current.runningText)).toBeTruthy();
    // 아직 오지 않은 단계가 설명을 달면 이미 진행 중인 것처럼 보인다.
    expect(within(stepItem(IMPORT_STEPS[2].label)).queryByText(IMPORT_STEPS[2].runningText)).toBeNull();
  });

  it("오래 걸리면 기다리지 않아도 된다고 먼저 말한다", () => {
    renderModal(running(1, SLOW_IMPORT_MS - 1));
    expect(screen.queryByText(/거래가 많아 시간이 걸리고 있습니다/)).toBeNull();

    renderModal(running(1, SLOW_IMPORT_MS));
    expect(screen.getAllByText(/거래가 많아 시간이 걸리고 있습니다/).length).toBeGreaterThan(0);
  });

  it("백그라운드로 보내면 기다림만 끝나고 취소로 말하지 않는다", () => {
    const onBackground = vi.fn();
    renderModal(running(1), { onBackground });
    fireEvent.click(screen.getByRole("button", { name: "백그라운드에서 계속" }));
    expect(onBackground).toHaveBeenCalledOnce();
    // "취소"라고 쓰면 동기화가 멈춘다는 뜻이 되는데, 실제로 멈출 수단이 없다.
    expect(screen.queryByRole("button", { name: /취소/ })).toBeNull();
    expect(screen.getByText("창을 닫아도 불러오기는 계속됩니다.")).toBeTruthy();
  });

  it("Esc는 모달을 닫되 취소가 아니라 백그라운드로 보낸다", () => {
    const onBackground = vi.fn();
    renderModal(running(1), { onBackground });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onBackground).toHaveBeenCalledOnce();
  });

  it("배경을 클릭해도 닫히지 않는다", () => {
    const onBackground = vi.fn();
    const { container } = renderModal(running(1), { onBackground });
    // 진행 중 실수로 닫는 것을 막는다 — 배경은 닫기 버튼이 아니라 가림막이다.
    const backdrop = container.querySelector('[aria-hidden="true"].absolute')!;
    fireEvent.click(backdrop);
    expect(onBackground).not.toHaveBeenCalled();
  });

  it("실패하면 불러온 만큼은 볼 수 있다고 말하고 재시도를 준다", () => {
    const onRetry = vi.fn();
    renderModal({ phase: "failed", stepIndex: 2, elapsedMs: 4_000, scannedChainCount: 3 }, { onRetry });
    expect(screen.getByRole("alert").textContent).toContain("불러온 만큼만");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "불러온 거래만 보기" })).toBeTruthy();
  });

  it("완료 상태에서는 진행 중 문구와 버튼이 남지 않는다", () => {
    // 이미 끝났는데 "계속됩니다"와 백그라운드 버튼이 남으면 화면이 사실과 다른 말을 한다.
    renderModal({ phase: "done", stepIndex: IMPORT_STEPS.length, elapsedMs: 7_000, scannedChainCount: 3 });
    expect(screen.getByRole("dialog", { name: "거래를 불러왔습니다" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "백그라운드에서 계속" })).toBeNull();
    expect(screen.queryByText("창을 닫아도 불러오기는 계속됩니다.")).toBeNull();
    expect(screen.getByText("대시보드로 이동합니다.")).toBeTruthy();
  });

  it("닫혀 있으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(
      <ImportProgressModal
        open={false}
        progress={running(1)}
        walletAddress={ADDRESS}
        chains={CHAINS}
        onBackground={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("불러오기 게이트", () => {
  // BE `POST /api/events/resync` 계약 미러: 지원 체인 전체를 항상 포함하는 체인별 수집 건수.
  const syncEnvelope = {
    data: {
      bindings: 1,
      fetched: 6,
      normalized: 6,
      chains: [
        { chainId: 1, fetched: 3 },
        { chainId: 8453, fetched: 2 },
        { chainId: 42161, fetched: 1 },
        { chainId: 10, fetched: 0 },
        { chainId: 137, fetched: 0 },
      ],
      skipped: [],
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(syncEnvelope), { status: 201 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("지원하는 EVM 체인 전체를 스캔 대상으로 나열한다", () => {
    render(<ImportProgressGate walletAddress={ADDRESS} />);
    const list = screen.getByRole("list", { name: "조회할 체인" });
    // BE 인덱서는 지원 체인 전체를 스캔한다 — "자산이 있는 체인만"은 응답 전에는 알 수 없는 사실이다.
    for (const chainId of EVM_CHAIN_IDS) {
      expect(within(list).getByText(chainLabel(chainId))).toBeTruthy();
    }
  });

  it("응답이 오면 체인별 수집 건수가 사실로 붙는다", async () => {
    render(<ImportProgressGate walletAddress={ADDRESS} />);
    // resync 응답(fetch→json→setState) 마이크로태스크 체인을 정산한다.
    await act(async () => {});
    expect(within(chainItem("Ethereum")).getByText("거래 3건")).toBeTruthy();
    expect(within(chainItem("Base")).getByText("거래 2건")).toBeTruthy();
  });

  it("응답이 오기 전에는 타이머가 끝나도 완료를 말하지 않는다", () => {
    // 완료는 실제 응답에서만 나온다 — 연출 타이머는 완료를 만들 수 없다.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<never>(() => undefined)));
    render(<ImportProgressGate walletAddress={ADDRESS} />);
    const total = IMPORT_STEP_DURATIONS_MS.reduce((sum, duration) => sum + duration, 0);
    act(() => {
      vi.advanceTimersByTime(total + 100);
    });
    expect(screen.getByRole("dialog", { name: "거래를 불러오는 중" })).toBeTruthy();
  });

  it("resync가 실패하면 실패를 말하고 재시도를 준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    render(<ImportProgressGate walletAddress={ADDRESS} />);
    await act(async () => {});
    expect(screen.getByRole("dialog", { name: "거래를 다 불러오지 못했습니다" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it("불러오기가 끝나면 스스로 닫고 URL에서 importing을 지운다", async () => {
    render(<ImportProgressGate walletAddress={ADDRESS} />);
    expect(screen.getByRole("dialog")).toBeTruthy();

    // 완료는 실제 응답 AND 연출 타이머 종료다 — 응답을 먼저 정산한 뒤 전체 단계를 지나게 한다.
    await act(async () => {});
    const total = IMPORT_STEP_DURATIONS_MS.reduce((sum, duration) => sum + duration, 0);
    act(() => {
      vi.advanceTimersByTime(total + 100);
    });
    expect(screen.getByRole("dialog", { name: "거래를 불러왔습니다" })).toBeTruthy();

    // 완료 표시를 읽을 틈을 준 뒤 비켜난다. 남아 있으면 끝난 불러오기가 대시보드를 계속 가린다.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    // push면 뒤로가기가 방금 끝난 불러오기 화면을 되살린다.
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("백그라운드를 누르면 즉시 대시보드를 내준다", () => {
    render(<ImportProgressGate walletAddress={ADDRESS} />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "백그라운드에서 계속" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });
});
