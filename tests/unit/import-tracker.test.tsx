import { act, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useImportTracker } from "@/components/wallet/import-tracker-provider";
import { renderWithImportTracker } from "@/tests/support/import-tracker";
import type { QueryClient } from "@tanstack/react-query";
import { IMPORT_POLL_INTERVAL_MS } from "@/lib/wallet/import-sync";
import { IDLE_IMPORT_TRACKER_STATE, IMPORT_JOB_STORAGE_KEY, importedEventCount, isNewlyImportedEvent, reportedScanProgress, skippedChainIds } from "@/lib/wallet/import-tracker";
import { eventQueryKey } from "@/lib/queries/events";

/**
 * 불러오기 트래커의 수명.
 *
 * 이 트래커가 지켜야 하는 것은 넷이다 — 작업은 **하나만** 돌 것, 화면이 닫혀도 **멈추지 않을 것**,
 * 끝나면 **원장을 갱신할 것**, 그리고 결과를 **사실대로** 나눌 것(완료·부분 실패·실패·유실은 서로 다른 일이다).
 * 마지막 하나가 깨지면 "다 불러왔다"는 말과 함께 빠진 체인이 조용히 사라진다.
 */

/** 지금 보고 있는 화면. 마커를 걷는 경계는 컴포넌트 수명이 아니라 이 값의 변화에만 있다. */
const nav = vi.hoisted(() => ({ pathname: "/dashboard" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const ADDRESS = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

const syncResult = {
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
  skipped: [] as { bindingId: string; chainId?: number; code: string }[],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const jobEnvelope = (status: string, extra: Record<string, unknown> = {}) => ({
  data: { jobId: "job-1", status, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z", ...extra },
});

/** 현행 BE 계약 미러: POST는 202 + jobId, GET은 지정한 상태 순서대로 답하고 마지막 상태를 계속 반복한다. */
function jobFetch(statuses: Array<{ status: string; extra?: Record<string, unknown> }>, jobId = "job-1") {
  let polls = 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/api/events/resync")) return json(jobEnvelope("queued"), 202);
    if (url.includes(`/api/events/resync/${jobId}`)) {
      const step = statuses[Math.min(polls, statuses.length - 1)];
      polls += 1;
      return json({ data: { jobId, status: step.status, ...(step.extra ?? {}) } }, 200);
    }
    throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
  });
}

/**
 * 트래커를 눈에 보이게 만든 탐침. 상태를 글자로 내고 동작을 버튼으로 낸다 —
 * 훅 반환값을 테스트가 몰래 붙잡으면 그것이 어느 렌더의 값인지가 흐려진다.
 */
function TrackerProbe() {
  const { state, start, retry, clear } = useImportTracker();
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="error">{state.errorCode ?? ""}</span>
      <span data-testid="normalized">{state.result?.normalized ?? ""}</span>
      <span data-testid="skipped">{skippedChainIds(state.result).join(",")}</span>
      <span data-testid="known">{state.knownEventIds === null ? "unknown" : state.knownEventIds.join(",")}</span>
      <span data-testid="new">{state.newEventIds === null ? "unknown" : state.newEventIds.join(",")}</span>
      <span data-testid="counting">{String(state.countingNew)}</span>
      {/* 토스트가 말할 건수. 목록 차이가 사실이고, 목록을 못 받았을 때만 작업의 숫자로 물러난다. */}
      <span data-testid="count">{importedEventCount(state)}</span>
      <span data-testid="is-new-e3">{String(isNewlyImportedEvent(state, "e3"))}</span>
      <span data-testid="is-new-e1">{String(isNewlyImportedEvent(state, "e1"))}</span>
      <button type="button" onClick={() => start(ADDRESS)}>start</button>
      <button type="button" onClick={retry}>retry</button>
      <button type="button" onClick={clear}>clear</button>
    </div>
  );
}

/**
 * 탐침을 껍데기 **안에서** 떼어낼 수 있게 감싼다. 트리 전체를 다시 그리면 프로바이더까지 사라져
 * "화면만 닫혔다"가 아니라 "앱이 사라졌다"를 검증하게 된다 — 그 둘은 다른 사건이다.
 */
function ProbeHost() {
  const [visible, setVisible] = useState(true);
  return (
    <>
      {visible ? <TrackerProbe /> : null}
      <button type="button" onClick={() => setVisible(false)}>hide</button>
    </>
  );
}

const status = () => screen.getByTestId("status").textContent;
const clickStart = () => act(() => void fireEvent.click(screen.getByRole("button", { name: "start" })));

/** 폴링 한 바퀴(대기 + 응답 정산). */
async function poll(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IMPORT_POLL_INTERVAL_MS + 5);
    });
  }
}

function postCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
}

/** 지금 원장에 있는 것으로 치는 이벤트 id. 테스트가 불러오기 도중에 바꿔 "그 사이 들어온 거래"를 만든다. */
let ledger: string[] = [];
let ledgerFails = false;
let ledgerBlocks = false;

/**
 * 원장 조회를 캐시에 심는다. `setQueryData`가 아니라 `prefetchQuery`인 이유:
 * 조회 함수 없이 넣은 항목은 **다시 받을 수가 없고**, 완료 뒤 다시 받는 것이 바로 이번에 검증할 동작이다.
 */
function seedLedger(queryClient: QueryClient, ids: string[]) {
  ledger = ids;
  ledgerFails = false;
  ledgerBlocks = false;
  return queryClient.prefetchQuery({
    queryKey: [...eventQueryKey, 50],
    queryFn: async () => {
      if (ledgerBlocks) return new Promise<never>(() => {});
      if (ledgerFails) throw new Error("ledger unavailable");
      return { items: ledger.map((id) => ({ event: { id }, version: 1 })) };
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  nav.pathname = "/dashboard";
  window.sessionStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
});

afterEach(() => {
  window.sessionStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("불러오기 트래커", () => {
  it("접수부터 완료까지 상태가 사실을 따라간다", async () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "running" }, { status: "done", extra: { result: syncResult } }]));
    renderWithImportTracker(<TrackerProbe />);
    expect(status()).toBe("idle");

    clickStart();
    await act(async () => {});
    expect(status()).toBe("running");

    await poll(2);
    expect(status()).toBe("done");
    expect(screen.getByTestId("normalized").textContent).toBe("6");
  });

  it("완료하면 원장·요약·세금 추정 캐시를 각각 한 번 무효화한다", async () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: syncResult } }]));
    const { queryClient } = renderWithImportTracker(<TrackerProbe />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    clickStart();
    await act(async () => {});
    await poll();

    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    // 두 번 무효화하면 같은 조회가 두 번 나간다. 한 번도 안 하면 화면이 staleTime 동안 옛 원장을 말한다.
    expect(keys.filter((key) => key === JSON.stringify(["events", "list"]))).toHaveLength(1);
    expect(keys.filter((key) => key === JSON.stringify(["events", "summary"]))).toHaveLength(1);
    expect(keys.filter((key) => key === JSON.stringify(["tax", "estimate"]))).toHaveLength(1);
  });

  it("start를 두 번 눌러도 작업은 하나만 접수된다", async () => {
    const fetchMock = jobFetch([{ status: "running" }]);
    vi.stubGlobal("fetch", fetchMock);
    renderWithImportTracker(<TrackerProbe />);

    clickStart();
    clickStart();
    await act(async () => {});
    await poll();

    // 두 번 접수하면 인덱서가 같은 지갑을 두 번 훑고, 사용자에게는 진행이 처음으로 되돌아간 것처럼 보인다.
    expect(postCalls(fetchMock)).toHaveLength(1);
  });

  it("구독하던 화면이 사라져도 폴링은 계속된다", async () => {
    const fetchMock = jobFetch([{ status: "running" }]);
    vi.stubGlobal("fetch", fetchMock);
    renderWithImportTracker(<ProbeHost />);

    clickStart();
    await act(async () => {});
    await poll();
    const before = fetchMock.mock.calls.length;

    // 모달·칩이 걷혀도 작업의 주인은 껍데기다 — 화면이 닫히는 것은 취소가 아니다.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "hide" }));
    });
    await poll(3);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it("작업 상태가 404로 사라지면 실패가 아니라 유실로 말한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? json(jobEnvelope("queued"), 202)
        : json({ error: { code: "not_found", message: "Sync job not found." } }, 404)));
    renderWithImportTracker(<TrackerProbe />);

    clickStart();
    await act(async () => {});
    await poll();

    // 무엇이 됐는지 모른다는 뜻이라 "실패"와 다르다. 화면 문구도 갈려야 한다.
    expect(status()).toBe("lost");
    expect(screen.getByTestId("error").textContent).toBe("job_lost");
  });

  it("일부 체인이 빠진 결과는 완료가 아니라 부분 실패다", async () => {
    const partial = { ...syncResult, skipped: [{ bindingId: "b1", chainId: 137, code: "rpc_error" }] };
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: partial } }]));
    renderWithImportTracker(<TrackerProbe />);

    clickStart();
    await act(async () => {});
    await poll();

    // 빠진 체인을 삼키고 "다 불러왔다"고 하면 사용자는 없는 거래를 원장에서 찾게 된다.
    expect(status()).toBe("failed");
    expect(screen.getByTestId("skipped").textContent).toBe("137");
    // 들어온 만큼은 진짜다 — 결과를 버리지 않는다.
    expect(screen.getByTestId("normalized").textContent).toBe("6");
  });

  it("접수가 거절되면 실패로 남고 저장된 작업도 지운다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    renderWithImportTracker(<TrackerProbe />);

    clickStart();
    await act(async () => {});

    expect(status()).toBe("failed");
    expect(screen.getByTestId("error").textContent).toBe("http_503");
    expect(window.sessionStorage.getItem(IMPORT_JOB_STORAGE_KEY)).toBeNull();
  });

  it("로그아웃(401)은 실패로 말하지 않고 조용히 접는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    renderWithImportTracker(<TrackerProbe />);

    clickStart();
    await act(async () => {});

    // 세션이 끊긴 화면에 "불러오기 실패"를 띄우면 사용자는 데이터 문제라고 읽는다.
    expect(status()).toBe("idle");
  });

  it("새로고침 뒤에는 저장된 작업을 이어받고 다시 접수하지 않는다", async () => {
    window.sessionStorage.setItem(
      IMPORT_JOB_STORAGE_KEY,
      JSON.stringify({ jobId: "job-9", startedAt: Date.now() - 5_000, walletAddress: ADDRESS }),
    );
    const fetchMock = jobFetch([{ status: "running" }, { status: "done", extra: { result: syncResult } }], "job-9");
    vi.stubGlobal("fetch", fetchMock);

    renderWithImportTracker(<TrackerProbe />);
    // 첫 조회는 기다리지 않는다 — 이미 접수된 작업이라 지금 상태를 바로 물어본다.
    await act(async () => {});
    expect(status()).toBe("running");
    // 다시 접수하면 같은 지갑에 작업이 하나 더 생긴다 — 이어받기의 핵심은 POST를 하지 않는 것이다.
    expect(postCalls(fetchMock)).toHaveLength(0);

    await poll();
    expect(status()).toBe("done");
  });

  it("빈 원장에서 시작하면 끝난 뒤 나타난 거래가 전부 새 거래다", async () => {
    // 지갑을 처음 등록한 경우다. 작업이 보고한 건수를 믿으면 안 된다 — 읽기 경로의 첫 동기화가
    // 이미 원장을 채운 뒤 우리 resync가 돌면 작업은 0건을 돌려주는데, 화면에는 세 줄이 보인다.
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: { ...syncResult, fetched: 0, normalized: 0 } } }]));
    const { queryClient } = renderWithImportTracker(<TrackerProbe />);
    await seedLedger(queryClient, []);

    clickStart();
    await act(async () => {});
    ledger = ["e1", "e2", "e3"];
    await poll();
    await act(async () => {});

    expect(screen.getByTestId("known").textContent).toBe("");
    expect(screen.getByTestId("new").textContent).toBe("e1,e2,e3");
    // 작업은 0건이라 말했지만 원장에는 세 건이 새로 있다. 화면이 믿어야 하는 것은 원장이다.
    expect(screen.getByTestId("count").textContent).toBe("3");
    expect(screen.getByTestId("is-new-e3").textContent).toBe("true");
  });

  it("이미 있던 거래는 다시 새 거래가 되지 않는다", async () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: syncResult } }]));
    const { queryClient } = renderWithImportTracker(<TrackerProbe />);
    await seedLedger(queryClient, ["e1", "e2"]);

    clickStart();
    await act(async () => {});
    ledger = ["e1", "e2", "e3"];
    await poll();
    await act(async () => {});

    expect(screen.getByTestId("known").textContent).toBe("e1,e2");
    expect(screen.getByTestId("new").textContent).toBe("e3");
    expect(screen.getByTestId("count").textContent).toBe("1");
    // 이미 보던 거래에 "새로 들어옴"을 붙이면 마커가 아무것도 가리키지 못한다.
    expect(screen.getByTestId("is-new-e1").textContent).toBe("false");
  });

  it("목록을 다시 받지 못하면 작업이 보고한 건수로 물러난다", async () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: syncResult } }]));
    const { queryClient } = renderWithImportTracker(<TrackerProbe />);
    await seedLedger(queryClient, ["e1"]);

    clickStart();
    await act(async () => {});
    // 다시 받기가 실패한다. 옛 목록으로 비교하면 "새 거래 없음"이라 단정하게 되므로 세지 못했다고 말해야 한다.
    ledgerFails = true;
    await poll();
    await act(async () => {});

    expect(screen.getByTestId("new").textContent).toBe("unknown");
    expect(screen.getByTestId("count").textContent).toBe("6");
    expect(screen.getByTestId("is-new-e3").textContent).toBe("false");
  });

  it("세는 동안에는 아직 건수를 말하지 않는다", async () => {
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: syncResult } }]));
    const { queryClient } = renderWithImportTracker(<TrackerProbe />);
    await seedLedger(queryClient, []);
    // 목록이 영영 오지 않는 동안에도 상태는 done이지만, 건수는 아직 사실이 아니다.
    ledgerBlocks = true;

    clickStart();
    await act(async () => {});
    await poll();

    expect(status()).toBe("done");
    // 토스트는 이 깃발을 보고 기다린다 — 0건이라 말한 뒤 세 건으로 뒤집히면 어느 쪽이 사실인지 알 수 없다.
    expect(screen.getByTestId("counting").textContent).toBe("true");
  });

  it("진행 중 응답에 체인 정보가 없으면 진척을 모른다고 답한다", () => {
    // 현행 BE 계약: running 응답은 jobId·status뿐이다. 여기서 0곳을 돌려주면 화면이
    // "아무 것도 안 끝났다"고 단정하고, 타이머로 지어내면 끝나지 않은 조회를 완료라 부른다.
    const running = { ...IDLE_IMPORT_TRACKER_STATE, status: "running" as const, job: { jobId: "job-1", status: "running" as const } };
    expect(reportedScanProgress(running)).toBeNull();
  });

  it("진행 중 응답이 체인별 사실을 실어 주면 그대로 옮긴다", () => {
    // 계약이 넓어지면 화면은 고칠 것 없이 확정 표시로 바뀐다 — 판단의 근거가 한 곳에 있기 때문이다.
    const reported = { bindings: 1, fetched: 3, normalized: 3, chains: [{ chainId: 1, fetched: 3 }, { chainId: 10, fetched: 0 }], skipped: [] };
    const running = {
      ...IDLE_IMPORT_TRACKER_STATE,
      status: "running" as const,
      job: { jobId: "job-1", status: "running" as const, result: reported },
    };
    expect(reportedScanProgress(running)).toEqual({
      scannedChainCount: 2,
      totalChainCount: 5,
      currentChain: { chainId: 137, chainName: "Polygon" },
    });
  });

  it("재시도는 옛 작업을 버리고 새로 접수한다", async () => {
    const fetchMock = jobFetch([{ status: "failed", extra: { error: { code: "sync_unavailable", message: "failed" } } }]);
    vi.stubGlobal("fetch", fetchMock);
    renderWithImportTracker(<TrackerProbe />);

    clickStart();
    await act(async () => {});
    await poll();
    expect(status()).toBe("failed");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "retry" }));
    });
    expect(status()).toBe("running");
    expect(postCalls(fetchMock)).toHaveLength(2);
  });
});

/**
 * "새로 들어온 거래" 마커를 언제 걷는가.
 *
 * 경계는 **원장을 떠나는 순간**이지 컴포넌트가 마운트·언마운트되는 순간이 아니다.
 * 대시보드의 effect 정리에 두었을 때는 StrictMode(개발 기본값)의 마운트 → 정리 → 마운트가
 * 화면에 도착하자마자 마커를 지워, 48건을 불러왔다는 토스트 옆에서 마커만 하나도 뜨지 않았다.
 */
describe("새 거래 마커의 수명", () => {
  /** 원장 화면을 흉내 낸 구독자. 마커를 읽기만 한다 — 언제 걷을지는 이 화면이 정하지 않는다. */
  function LedgerView() {
    const { state } = useImportTracker();
    return <span data-testid="ledger-new">{state.newEventIds === null ? "unknown" : state.newEventIds.join(",")}</span>;
  }

  function Host({ showLedger }: { showLedger: boolean }) {
    return (
      <>
        <TrackerProbe />
        {showLedger ? <LedgerView /> : null}
      </>
    );
  }

  async function completeImport(strict: boolean) {
    vi.stubGlobal("fetch", jobFetch([{ status: "done", extra: { result: syncResult } }]));
    const rendered = renderWithImportTracker(<Host showLedger={false} />, { strict });
    await seedLedger(rendered.queryClient, []);
    clickStart();
    await act(async () => {});
    ledger = ["e1", "e2", "e3"];
    await poll();
    await act(async () => {});
    expect(screen.getByTestId("new").textContent).toBe("e1,e2,e3");
    return rendered;
  }

  it("원장 화면이 StrictMode로 마운트해도 마커는 살아남는다", async () => {
    const { rerenderInTracker } = await completeImport(true);

    // 불러오기가 끝난 뒤에 원장이 마운트되는 경우다 — 토스트의 "보러 가기"로 들어오는 길이 정확히 이것이다.
    await act(async () => {
      rerenderInTracker(<Host showLedger />);
    });

    // 정리 함수에 경계를 두었을 때는 이 순간 마커가 전부 사라졌다.
    expect(screen.getByTestId("ledger-new").textContent).toBe("e1,e2,e3");
    expect(screen.getByTestId("is-new-e3").textContent).toBe("true");
  });

  it("원장을 떠나면 마커를 걷는다", async () => {
    const { rerenderInTracker } = await completeImport(false);

    nav.pathname = "/wallets";
    await act(async () => {
      rerenderInTracker(<Host showLedger={false} />);
    });

    // 한 번 보고 떠난 거래는 더 이상 새 거래가 아니다. 남겨 두면 다음 불러오기에서 무엇이 새 것인지 구분할 수 없다.
    expect(screen.getByTestId("new").textContent).toBe("unknown");
    expect(screen.getByTestId("is-new-e3").textContent).toBe("false");
  });

  it("원장으로 들어오는 이동은 마커를 건드리지 않는다", async () => {
    nav.pathname = "/wallets";
    const { rerenderInTracker } = await completeImport(false);

    nav.pathname = "/dashboard";
    await act(async () => {
      rerenderInTracker(<Host showLedger />);
    });

    // 보러 오는 길에 마커를 지우면 사용자는 무엇이 새로 들어왔는지 영영 볼 수 없다.
    expect(screen.getByTestId("ledger-new").textContent).toBe("e1,e2,e3");
  });
});
