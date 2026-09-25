import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WalletLinkCard } from "@/components/report-vc/wallet-link-card";
import { SettingsView } from "@/components/settings/settings-view";
import type { ReportVcClient } from "@/lib/report-vc/client";
import { FIXTURE_CAPABILITIES, FIXTURE_LINKED, fixtureLinkAttempt } from "@/lib/report-vc/fixtures";
import { ReportVcError } from "@/lib/report-vc/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const live = <T,>(data: T) => ({ data, provenance: "live" as const });

type Fake = { [K in keyof ReportVcClient]: ReturnType<typeof vi.fn> };

function fakeClient(over: Partial<Fake> = {}): Fake {
  return {
    capabilities: vi.fn().mockResolvedValue(live(FIXTURE_CAPABILITIES)),
    walletState: vi.fn().mockResolvedValue(live({ status: "unlinked" })),
    createLinkAttempt: vi.fn().mockImplementation(async () => live(fixtureLinkAttempt(Date.now(), 10_000))),
    linkAttemptStatus: vi.fn().mockResolvedValue(live({ status: "pending", retryAfterMs: 2000 })),
    cancelLinkAttempt: vi.fn().mockResolvedValue(undefined),
    unlinkWallet: vi.fn().mockResolvedValue(undefined),
    evidenceIssuance: vi.fn(),
    requestIssuance: vi.fn(),
    issuanceStatus: vi.fn(),
    cancelIssuance: vi.fn(),
    createVerification: vi.fn(),
    verificationStatus: vi.fn(),
    cancelVerification: vi.fn(),
    checkFile: vi.fn(),
    ...over,
  };
}

const client = (fake: Fake) => fake as unknown as ReportVcClient;
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom에는 클립보드가 없다. 복사 버튼(축약 표시)이 그려지도록 심는다.
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function renderCard(fake: Fake) {
  render(<WalletLinkCard client={client(fake)} />);
  await flush();
}

async function startLinking(fake: Fake) {
  await renderCard(fake);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "증명서 지갑 연결" })); });
  await flush();
}

describe("증명서 지갑 연결 카드", () => {
  it("BE가 없으면 '기능 준비 중'으로 보이고 연결 버튼을 내놓지 않는다", async () => {
    const fake = fakeClient({ capabilities: vi.fn().mockRejectedValue(new ReportVcError(404, "feature_unavailable", "not deployed")) });
    await renderCard(fake);
    expect(screen.getByRole("status")).toHaveTextContent("준비되지 않았습니다");
    expect(screen.queryByRole("button", { name: "증명서 지갑 연결" })).toBeNull();
    expect(fake.walletState).not.toHaveBeenCalled();
  });

  it("서버가 기능을 껐다고 말하면 그 사실만 보인다", async () => {
    await renderCard(fakeClient({ capabilities: vi.fn().mockResolvedValue(live({ ...FIXTURE_CAPABILITIES, walletLink: false })) }));
    expect(screen.getByRole("status")).toHaveTextContent("준비되지 않았습니다");
  });

  it("미연결이면 설명과 연결 버튼을 보이고, 암호화폐 지갑과 다른 지갑임을 말한다", async () => {
    await renderCard(fakeClient());
    expect(screen.getByText("증명서 지갑")).toBeInTheDocument();
    expect(document.querySelector('[data-surface="report-vc-wallet"]')?.textContent).toContain("암호화폐 거래 조회용 지갑과 별도로 연결");
    expect(screen.getByRole("button", { name: "증명서 지갑 연결" })).toBeEnabled();
  });

  it("QR을 그리고 폴링하다가 서버가 linked를 돌려줄 때만 연결 완료가 된다", async () => {
    const fake = fakeClient();
    await startLinking(fake);
    expect(fake.createLinkAttempt).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("증명서 지갑 연결 QR 코드").closest("svg")).toBeInTheDocument();
    // QR만으로는 연결이 아니다.
    expect(screen.queryByText("증명서 지갑이 연결되어 있습니다")).toBeNull();

    await tick(2000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("증명서 지갑이 연결되어 있습니다")).toBeNull();

    fake.linkAttemptStatus.mockResolvedValue(live(FIXTURE_LINKED));
    await tick(2000);
    expect(screen.getByText("증명서 지갑이 연결되어 있습니다")).toBeInTheDocument();
    // DID는 축약해 보이고 전문을 복사할 수 있다.
    expect(screen.getByText("did:omn:vera-p…0000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DID 복사" })).toHaveAttribute("title", FIXTURE_LINKED.did);
    // 연결이 끝나면 폴링도 끝난다.
    await tick(10_000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(2);
  });

  it("연결 버튼을 두 번 눌러도 시도는 하나다", async () => {
    const fake = fakeClient();
    await renderCard(fake);
    const button = screen.getByRole("button", { name: "증명서 지갑 연결" });
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    await flush();
    expect(fake.createLinkAttempt).toHaveBeenCalledTimes(1);
  });

  it("취소하면 서버에 알리고 늦게 온 성공을 무시한다", async () => {
    let finish!: (value: unknown) => void;
    const fake = fakeClient({ linkAttemptStatus: vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; })) });
    await startLinking(fake);
    await tick(2000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "취소하고 돌아가기" })); });
    expect(fake.cancelLinkAttempt).toHaveBeenCalledWith("link-preview-1");
    await act(async () => { finish(live(FIXTURE_LINKED)); await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByText("증명서 지갑이 연결되어 있습니다")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("연결을 취소했습니다");
    expect(screen.getByRole("button", { name: "증명서 지갑 연결" })).toBeInTheDocument();
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(1);
  });

  it("QR이 만료되면 폴링을 멈추고 새 QR을 안내한다", async () => {
    const fake = fakeClient();
    await startLinking(fake);
    await tick(11_000);
    expect(screen.getByRole("status")).toHaveTextContent("만료");
    const calls = fake.linkAttemptStatus.mock.calls.length;
    await tick(10_000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("button", { name: "증명서 지갑 연결" })).toBeInTheDocument();
  });

  it("다른 계정에 연결된 DID는 그 사실을 그대로 안내한다", async () => {
    const fake = fakeClient({ linkAttemptStatus: vi.fn().mockRejectedValue(new ReportVcError(409, "did_linked_to_other_account", "taken")) });
    await startLinking(fake);
    await tick(2000);
    expect(screen.getByRole("alert")).toHaveTextContent("다른 계정에 연결되어");
    await tick(10_000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(1);
  });

  it("연결 중 세션이 만료되면 멈추고 재로그인을 안내한다", async () => {
    const fake = fakeClient({ linkAttemptStatus: vi.fn().mockRejectedValue(new ReportVcError(401, "unauthorized", "Unauthorized")) });
    await startLinking(fake);
    await tick(2000);
    expect(screen.getByRole("alert")).toHaveTextContent("로그인이 만료");
    expect(screen.getByRole("link", { name: "다시 로그인" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "증명서 지갑 연결" })).toBeNull();
    await tick(10_000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(1);
  });

  it("429는 Retry-After 뒤 다시 묻는다", async () => {
    const fake = fakeClient({
      linkAttemptStatus: vi.fn()
        .mockRejectedValueOnce(new ReportVcError(429, "rate_limited", "slow", 5000))
        .mockResolvedValue(live({ status: "pending", retryAfterMs: 2000 })),
    });
    await startLinking(fake);
    await tick(2000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(1);
    await tick(4000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("연결 해제는 확인을 거쳐야 하고, 기존 증명서가 폐기된다고 단정하지 않는다", async () => {
    const fake = fakeClient({ walletState: vi.fn().mockResolvedValue(live(FIXTURE_LINKED)) });
    await renderCard(fake);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "연결 해제..." })); });
    const confirm = screen.getByRole("group", { name: "연결 해제 확인" });
    expect(confirm.textContent).not.toContain("폐기됩니다");
    expect(fake.unlinkWallet).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "유지하기" })); });
    expect(fake.unlinkWallet).not.toHaveBeenCalled();
    expect(screen.getByText("증명서 지갑이 연결되어 있습니다")).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "연결 해제..." })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "연결 해제" })); });
    await flush();
    expect(fake.unlinkWallet).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("해제했습니다");
    expect(screen.getByRole("button", { name: "증명서 지갑 연결" })).toBeInTheDocument();
  });

  it("해제가 실패하면 연결 상태를 유지한 채 오류를 보인다", async () => {
    const fake = fakeClient({ walletState: vi.fn().mockResolvedValue(live(FIXTURE_LINKED)), unlinkWallet: vi.fn().mockRejectedValue(new ReportVcError(503, "verifier_unavailable", "down")) });
    await renderCard(fake);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "연결 해제..." })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "연결 해제" })); });
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("연결하지 못했습니다");
    expect(screen.getByText("증명서 지갑이 연결되어 있습니다")).toBeInTheDocument();
  });

  it("mock 출처 응답에는 mock 데이터 칩이 붙는다", async () => {
    const fake = fakeClient({ walletState: vi.fn().mockResolvedValue({ data: FIXTURE_LINKED, provenance: "mock" }) });
    await renderCard(fake);
    expect(screen.getByTestId("mock-provenance")).toBeInTheDocument();
  });

  it("화면을 떠나면 폴링이 멈춘다", async () => {
    const fake = fakeClient();
    await startLinking(fake);
    await tick(2000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(1);
    cleanup();
    await tick(10_000);
    expect(fake.linkAttemptStatus).toHaveBeenCalledTimes(1);
  });
});

describe("설정 화면의 증명서 지갑 섹션", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key), clear: () => store.clear(), key: () => null, length: 0 },
    });
  });

  it("기존 항목(플랜·화면·계정) 사이에 증명서 지갑 섹션이 들어가고 로그인 방식 설정과는 얽히지 않는다", async () => {
    const fake = fakeClient();
    const authClient = { requestNonce: vi.fn(), verify: vi.fn(), registerWatchWallet: vi.fn(), presentDid: vi.fn(), getSession: vi.fn(), logout: vi.fn().mockResolvedValue(undefined) };
    render(<SettingsView authClient={authClient as never} reportVcClient={client(fake)} />);
    await flush();
    expect(screen.getByRole("region", { name: "증명서 지갑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "증명서 지갑 연결" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /현재 플랜/ })).toBeInTheDocument();
    expect(authClient.presentDid).not.toHaveBeenCalled();
  });
});


it("shows a reauthentication link rather than asking the signed-in user to log out", async () => {
  const fake = fakeClient({ createLinkAttempt: vi.fn().mockRejectedValue(new ReportVcError(403, "cx_reauthentication_required", "recent verification required")) });
  await startLinking(fake);
  expect(screen.getByText(/최근 본인확인 후 15분/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "본인확인 다시 하기" })).toHaveAttribute("href", "/settings/verify-identity");
  expect(screen.queryByRole("button", { name: "증명서 지갑 연결" })).toBeNull();
  expect(fake.linkAttemptStatus).not.toHaveBeenCalled();
});

it("restores the existing QR after returning without restarting its expiry", async () => {
  const offer = fixtureLinkAttempt(Date.now(), 10_000);
  const fake = fakeClient({ createLinkAttempt: vi.fn().mockResolvedValue(live(offer)) });
  await startLinking(fake);
  cleanup();
  await tick(4000);
  await startLinking(fake);
  expect(screen.getByTitle("증명서 지갑 연결 QR 코드")).toBeInTheDocument();
  await tick(2000);
  expect(fake.linkAttemptStatus).toHaveBeenCalledWith(offer.attemptId, expect.any(AbortSignal));
  expect(fake.cancelLinkAttempt).not.toHaveBeenCalled();
  await tick(5000);
  expect(screen.getByRole("status")).toHaveTextContent("만료");
});
