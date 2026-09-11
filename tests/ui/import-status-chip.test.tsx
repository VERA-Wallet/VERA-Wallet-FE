import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { TOAST_AUTO_DISMISS_MS } from "@/components/ui/toast";
import { ImportCompleteToast } from "@/components/wallet/import-complete-toast";
import { ImportStatusChip } from "@/components/wallet/import-status-chip";
import { useImportTracker } from "@/components/wallet/import-tracker-provider";
import { renderWithImportTracker } from "@/tests/support/import-tracker";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { FIXTURE_TAX_YEAR } from "@/tests/fixtures/tax-year";
import { isSpam } from "@/lib/review";
import { eventQueryKey } from "@/lib/queries/events";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import { IMPORT_POLL_INTERVAL_MS } from "@/lib/wallet/import-sync";
import { IMPORT_JOB_STORAGE_KEY, SLOW_IMPORT_CHIP_MS } from "@/lib/wallet/import-tracker";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 모달을 걷은 뒤에도 앱이 불러오기를 계속 말하는가.
 *
 * 지켜야 하는 것은 셋이다 — 진행 중이면 **어느 탭에서든** 말할 것, 실패·유실·부분 실패를 **구분해서** 말할 것,
 * 끝나면 무엇이 들어왔는지 **찾아갈 길**을 줄 것. 마지막이 없으면 사용자는 들어온 거래가 어디 있는지 알 수 없다.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/dashboard" }));

const ports = vi.hoisted(() => ({
  list: vi.fn(),
  getSummary: vi.fn(),
  reclassify: vi.fn(),
  getById: vi.fn(),
  listRuleSets: vi.fn(),
  estimate: vi.fn(),
}));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list, reclassify: ports.reclassify, getById: ports.getById },
  summaryProvider: { getSummary: ports.getSummary },
  taxEngine: { listRuleSets: ports.listRuleSets, estimate: ports.estimate },
}));

const ADDRESS = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

const syncResult = {
  bindings: 1,
  fetched: 6,
  normalized: 6,
  chains: [
    { chainId: 1, fetched: 3 },
    { chainId: 10, fetched: 0 },
    { chainId: 137, fetched: 0 },
    { chainId: 8453, fetched: 2 },
    { chainId: 42161, fetched: 1 },
  ],
  skipped: [] as { bindingId: string; chainId?: number; code: string }[],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 현행 BE 계약 미러: POST는 202 + jobId, GET은 지정한 상태 순서대로 답한다. */
function jobFetch(statuses: Array<{ status: string; extra?: Record<string, unknown> }>) {
  let polls = 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/api/events/resync")) {
      return json({ data: { jobId: "job-1", status: "queued" } }, 202);
    }
    if (url.includes("/api/events/resync/job-1")) {
      const step = statuses[Math.min(polls, statuses.length - 1)];
      polls += 1;
      return json({ data: { jobId: "job-1", status: step.status, ...(step.extra ?? {}) } }, 200);
    }
    throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
  });
}

/** 불러오기를 시작시키는 버튼만 있는 최소 구독자. 칩·토스트는 이 트래커 하나를 함께 본다. */
function StartButton() {
  const { start } = useImportTracker();
  return <button type="button" onClick={() => start(ADDRESS)}>start</button>;
}

const clickStart = () => act(() => void fireEvent.click(screen.getByRole("button", { name: "start" })));

async function poll(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IMPORT_POLL_INTERVAL_MS + 5);
    });
  }
}

afterEach(() => {
  push.mockReset();
  replace.mockReset();
  window.sessionStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
  vi.unstubAllGlobals();
});

describe("불러오기 칩", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderChip() {
    return renderWithImportTracker(
      <>
        <StartButton />
        <ImportStatusChip />
      </>,
    );
  }

  it("불러오기 전에는 아무것도 그리지 않는다", () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "running" }]));
    renderChip();
    // 진행 중인 일이 없는데 자리를 차지하면 평소 화면이 늘 무언가를 기다리는 것처럼 보인다.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("진행 중에는 어느 탭에서든 불러오는 중이라고 말한다", async () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "running" }]));
    renderChip();
    clickStart();
    await act(async () => {});

    expect(within(screen.getByRole("status")).getByText("새 지갑 거래 불러오는 중")).toBeTruthy();
  });

  it("BE가 체인별 진척을 주지 않는 동안에는 몇 곳 끝났는지 말하지 않는다", async () => {
    // 현행 계약에서 running 응답에는 체인 정보가 없다. 연출 타이머로 "2곳 완료"를 지어내면
    // 사용자는 그것을 사실로 읽고, 실제로는 아직 첫 체인을 훑는 중일 수 있다.
    vi.stubGlobal("fetch", jobFetch([{ status: "running" }]));
    const { container } = renderChip();
    clickStart();
    await act(async () => {});
    await poll(3);

    const chip = screen.getByRole("status");
    expect(within(chip).getByText("체인 5곳을 조회하고 있어요")).toBeTruthy();
    expect(within(chip).queryByText(/곳 중/)).toBeNull();
    // 0%에 멈춘 원은 "아무 것도 안 끝났다"는 주장이다 — 모를 때는 도는 원을 쓴다.
    expect(container.querySelector('[data-progress-ring="indeterminate"]')).toBeTruthy();
  });

  it("BE가 체인별 진척을 주면 그때는 몇 곳 중 몇 곳인지 말한다", async () => {
    // 계약이 넓어지는 순간 화면은 고칠 것 없이 확정 표시로 바뀌어야 한다.
    const reported = { ...syncResult, fetched: 3, normalized: 3, chains: syncResult.chains.slice(0, 2) };
    vi.stubGlobal("fetch", jobFetch([{ status: "running", extra: { result: reported } }]));
    const { container } = renderChip();
    clickStart();
    await act(async () => {});
    await poll();

    const chip = screen.getByRole("status");
    expect(within(chip).getByText("체인 5곳 중 2곳 · Polygon 조회 중")).toBeTruthy();
    expect(container.querySelector('[data-progress-ring="determinate"]')).toBeTruthy();
  });

  it("오래 걸리면 단계 대신 오래 걸린다는 사실을 말한다", async () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "running" }]));
    renderChip();
    clickStart();
    await act(async () => {});
    await poll(Math.ceil(SLOW_IMPORT_CHIP_MS / IMPORT_POLL_INTERVAL_MS) + 1);

    // 침묵하면 사용자는 멈췄다고 읽고 새로고침한다.
    expect(within(screen.getByRole("status")).getByText("거래가 많아 시간이 걸려요")).toBeTruthy();
  });

  it("칩을 누르면 체인 목록을 보여주되 취소는 주지 않는다", async () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "running" }]));
    renderChip();
    clickStart();
    await act(async () => {});

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /새 지갑 거래 불러오는 중/ }));
    });
    const sheet = screen.getByRole("dialog", { name: "거래 불러오는 중" });
    expect(within(sheet).getByRole("list", { name: "조회할 체인" })).toBeTruthy();
    expect(within(sheet).getByText("이 창은 상태만 보여줘요. 닫아도 불러오기는 계속되고, 끝나면 알려드려요.")).toBeTruthy();
    // 멈출 수단이 없는데 "취소"를 두면 화면이 하지 못할 일을 약속하는 셈이다.
    expect(within(sheet).queryByRole("button", { name: /취소/ })).toBeNull();
  });

  it("시트는 칩이 불러오는 중이라 말하는 동안 어떤 체인도 완료라 하지 않는다", async () => {
    // 연출 타이머를 물렸을 때 실제로 났던 일이다 — 칩은 "불러오는 중", 시트는 다섯 곳 모두 "완료".
    // 한 앱이 같은 순간에 두 이야기를 하면 사용자는 어느 쪽을 믿을지 알 수 없다.
    vi.stubGlobal("fetch", jobFetch([{ status: "running" }]));
    const { container } = renderChip();
    clickStart();
    await act(async () => {});
    await poll(8);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /새 지갑 거래 불러오는 중/ }));
    });
    const list = within(screen.getByRole("dialog", { name: "거래 불러오는 중" })).getByRole("list", { name: "조회할 체인" });
    expect(within(list).getAllByText("조회 중")).toHaveLength(5);
    expect(within(list).queryByText("완료")).toBeNull();
    expect(within(list).queryByText("대기")).toBeNull();
    // 진척을 모르는데 막대가 특정 지점에 서 있으면 그 자체가 주장이 된다.
    expect(container.querySelector('[data-progress="indeterminate"]')).toBeTruthy();
    expect(container.querySelector('[data-progress="determinate"]')).toBeNull();
  });

  it("완료하면 칩은 물러난다 — 끝난 일을 계속 말하지 않는다", async () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: syncResult } }]));
    renderChip();
    clickStart();
    await act(async () => {});
    await poll();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("일부 체인만 실패하면 들어온 만큼은 반영됐다고 함께 말한다", async () => {
    const partial = { ...syncResult, skipped: [{ bindingId: "b1", chainId: 137, code: "rpc_error" }] };
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: partial } }]));
    renderChip();
    clickStart();
    await act(async () => {});
    await poll();

    const chip = screen.getByRole("alert");
    expect(within(chip).getByText("Polygon 거래를 못 불러왔어요")).toBeTruthy();
    // 전부 실패했다고 읽히면 사용자는 이미 손에 있는 거래까지 없는 것으로 안다.
    expect(within(chip).getByText("나머지 4곳 6건은 반영됐어요")).toBeTruthy();
    expect(within(chip).getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it("전부 실패하면 다시 시도를 준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    renderChip();
    clickStart();
    await act(async () => {});

    const chip = screen.getByRole("alert");
    expect(within(chip).getByText("거래를 불러오지 못했어요")).toBeTruthy();
    expect(within(chip).getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it("작업이 사라지면 실패가 아니라 확인할 수 없다고 말한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ data: { jobId: "job-1", status: "queued" } }, 202)
        : json({ error: { code: "not_found", message: "gone" } }, 404)));
    renderChip();
    clickStart();
    await act(async () => {});
    await poll();

    const chip = screen.getByRole("alert");
    // 실패했다고 단정하면 하지 않은 판단을 한 것이다 — 무엇이 됐는지 모른다는 것이 사실이다.
    expect(within(chip).getByText("불러오기 상태를 확인할 수 없어요")).toBeTruthy();
    expect(within(chip).getByText("서버가 재시작됐을 수 있어요")).toBeTruthy();
    expect(within(chip).getByRole("button", { name: "다시 불러오기" })).toBeTruthy();
  });
});

describe("완료 토스트", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function completeImport() {
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: syncResult } }]));
    renderWithImportTracker(
      <>
        <StartButton />
        <ImportCompleteToast />
      </>,
    );
    clickStart();
    await act(async () => {});
    await poll();
  }

  it("몇 건이 들어왔는지 말하고 보러 갈 길을 준다", async () => {
    await completeImport();
    expect(screen.getByRole("status").textContent).toContain("거래 6건을 불러왔어요");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "보러 가기" }));
    });
    // 원장 화면이 아니면 그리로 데려간다 — 알림만 주고 길을 안 주면 들어온 거래를 찾아 헤맨다.
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("작업이 0건이라 말해도 원장에 새로 들어온 만큼을 센다", async () => {
    // 실제로 났던 일이다. 읽기 경로의 첫 동기화가 원장을 채운 뒤 우리 resync가 돌아 작업은 0건을 보고했고,
    // 목록에는 수십 줄이 있는데 토스트만 "새로 불러온 거래가 없어요"라고 말했다.
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: { ...syncResult, fetched: 0, normalized: 0 } } }]));
    const { queryClient } = renderWithImportTracker(
      <>
        <StartButton />
        <ImportCompleteToast />
      </>,
    );
    let rows: string[] = [];
    await act(async () => {
      await queryClient.prefetchQuery({
        queryKey: [...eventQueryKey, 50],
        queryFn: async () => ({ items: rows.map((id) => ({ event: { id }, version: 1 })) }),
      });
    });

    clickStart();
    await act(async () => {});
    // 불러오기가 도는 동안 원장이 채워진다 — 무엇이 새로 들어왔는지는 이 목록만 안다.
    rows = ["e1", "e2", "e3"];
    await poll();
    await act(async () => {});

    expect(screen.getByRole("status").textContent).toContain("거래 3건을 불러왔어요");
  });

  it("읽을 틈을 준 뒤 스스로 물러난다", async () => {
    await completeImport();
    expect(screen.queryByRole("status")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOAST_AUTO_DISMISS_MS + 50);
    });
    // 남아 있으면 하단 탭 위를 영영 덮는다.
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("대시보드 새 거래 마커", () => {
  // 폴링 시계를 쓰지 않으려 구 계약(POST가 결과를 바로 돌려줌)을 쓴다 — 마커의 근거는 완료 사실이지 폴링이 아니다.
  const displayable = createNormalizedEventFixtures(FIXTURE_TAX_YEAR, new Date(Date.UTC(FIXTURE_TAX_YEAR + 1, 0, 1)))
    .filter((event) => !isSpam(event));
  const newest = [...displayable].sort(
    (left, right) => Date.parse(right.block_timestamp) - Date.parse(left.block_timestamp),
  )[0];
  const older = displayable.filter((event) => event.id !== newest.id);
  const engine = new TaxEngineService(() => displayable);

  function serve(events: NormalizedEvent[]) {
    ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  }

  beforeEach(() => {
    vi.useRealTimers();
    serve(older);
    ports.getSummary.mockResolvedValue({
      periodPnl: "0",
      computableEventCount: 1,
      taxableEventCount: 1,
      pendingReviewCount: 0,
      currency: "KRW",
      period: { from: displayable[0].block_timestamp, to: newest.block_timestamp },
    });
    ports.getById.mockImplementation(async (id: string) => ({
      event: displayable.find((event) => event.id === id)!,
      version: 1,
      override_history: [],
    }));
    ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: syncResult }, 201)));
  });

  it("이번에 들어온 거래만 날짜 묶음에 표시하고 첫 건에 닻을 남긴다", async () => {
    const { container } = renderWithImportTracker(
      <>
        <StartButton />
        <DashboardView countryCode="KR" />
      </>,
    );

    // 불러오기 전 원장. 이 시점의 목록이 "원래 있던 거래"의 정의다.
    await waitFor(() => expect(container.querySelector(`[data-event-id="${older[0].id}"]`)).toBeTruthy());
    expect(screen.queryByText(/새로 들어온 거래/)).toBeNull();

    // 불러오기가 끝나면 원장이 갱신되고, 그때 새로 나타난 거래만 새 거래다.
    serve(displayable);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "start" }));
    });

    await waitFor(() => expect(screen.getByText("새로 들어온 거래 1")).toBeTruthy());
    const anchor = container.querySelector("[data-new-event]");
    // 토스트의 "보러 가기"가 찾아올 자리 — 새로 들어온 첫 거래여야 한다.
    expect(anchor?.getAttribute("data-event-id")).toBe(newest.id);
  });

  it("불러오는 중에는 이 건수가 아직 새 지갑을 모른다고 밝힌다", async () => {
    // 응답이 끝나지 않는 동안에도 화면은 계속 쓸 수 있어야 하고, 숫자가 왜 그대로인지 말해야 한다.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderWithImportTracker(
      <>
        <StartButton />
        <DashboardView countryCode="KR" />
      </>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "start" }));
    });

    await waitFor(() => expect(screen.getByText("새 지갑 거래는 불러온 뒤 반영돼요")).toBeTruthy());
  });
});
