import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectWalletFlow } from "@/components/wallet/connect-wallet-flow";
import { AuthClientError, type AuthClient } from "@/lib/ports/auth-client";
import type { WalletPort } from "@/lib/ports/wallet-port";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

function walletPort(): WalletPort {
  return {
    connect: vi.fn(),
    getAccount: () => ({ address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", chainId: 8453 }),
    signMessage: vi.fn().mockResolvedValue("0xsigned"),
    subscribeConnection: () => () => undefined,
  };
}

function authClient(): AuthClient {
  return { requestNonce: vi.fn(), verify: vi.fn(), presentDid: vi.fn(), registerWatchWallet: vi.fn(), logout: vi.fn(), getSession: vi.fn() };
}

describe("wallet connection SIWE flow", () => {
  beforeEach(() => { push.mockReset(); refresh.mockReset(); });

  it("uses server nonce fields in the SIWE message and verifies the signature", async () => {
    const port = walletPort();
    const auth = authClient();
    const nonce = { nonce: "noncefromserver123", domain: "wallet.example", uri: "https://wallet.example/login", chainId: 8453, issuedAt: "2026-07-30T00:00:00.000Z", expiresAtMs: 1785373200000 };
    vi.mocked(auth.requestNonce).mockResolvedValue(nonce);
    const cache = new QueryClient();
    cache.setQueryData(["portfolio", "wallets"], { wallets: [] });
    render(<ConnectWalletFlow walletPort={port} authClient={auth} />, cache);
    // 기본 경로는 주소 입력이다. 서명 경로는 방법 선택에서 브라우저 지갑 행을 골라야 나온다.
    fireEvent.click(screen.getByRole("button", { name: /브라우저 지갑으로 연결/ }));
    fireEvent.click(screen.getByRole("button", { name: "서명하고 추가" }));
    await waitFor(() => expect(port.signMessage).toHaveBeenCalled());
    const message = vi.mocked(port.signMessage).mock.calls[0][0];
    expect(message).toContain("wallet.example wants you to sign in");
    expect(message).toContain("URI: https://wallet.example/login");
    expect(message).toContain("Nonce: noncefromserver123");
    expect(message).toContain("Issued At: 2026-07-30T00:00:00.000Z");
    expect(port.signMessage).toHaveBeenCalledWith(message, port.getAccount());
    expect(auth.verify).toHaveBeenCalledWith({ message, signature: "0xsigned" });
    // 서명 성공은 대시보드 진입이 아니라 **불러오기 진입**이다. 쿼리가 빠지면 모달이 뜨지 않고
    // 사용자는 동기화가 끝나기 전 대시보드를 빈 화면으로 본다.
    expect(push).toHaveBeenCalledWith("/dashboard?importing=1");
    expect(cache.getQueryState(["portfolio", "wallets"])?.isInvalidated).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not sign a stale address after the extension changes account", async () => {
    const port = walletPort();
    const auth = authClient();
    render(<ConnectWalletFlow walletPort={port} authClient={auth} initialStep="siwe" />);
    port.getAccount = () => ({ address: "0x0000000000000000000000000000000000000001", chainId: 8453 });
    fireEvent.click(screen.getByRole("button", { name: "서명하고 추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("계정 또는 네트워크가 변경");
    expect(auth.requestNonce).not.toHaveBeenCalled();
    expect(port.signMessage).not.toHaveBeenCalled();
  });

  // 주소 입력은 서명 없이 등록하는 기본 경로다. 체크섬을 흘려보내면 존재하지 않는 주소가 등록되고
  // 사용자는 "거래가 왜 안 뜨죠"로 돌아온다 — 형식·체크섬·정규화·중복을 한 번에 못박는다.
  it("registers a pasted address without signing, normalizing it to checksum form", async () => {
    const auth = authClient();
    vi.mocked(auth.registerWatchWallet).mockResolvedValue({ walletAddress: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" });
    const cache = new QueryClient();
    cache.setQueryData(["portfolio", "wallets"], { wallets: [] });
    render(<ConnectWalletFlow walletPort={walletPort()} authClient={auth} />, cache);

    fireEvent.click(screen.getByRole("button", { name: /주소로 추가/ }));
    fireEvent.change(screen.getByLabelText("지갑 주소"), { target: { value: "0x71c7656ec7ab88b098defb751b7401b5f6d8976f" } });
    // 유효한 주소가 들어오면 조회 체인이 읽기 전용으로 보이고, "다음"이 확인 시트를 연다.
    expect(screen.getByText("EVM 주소 확인 완료")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByRole("dialog", { name: "지갑 추가 확인" })).toHaveTextContent("0x71C7656EC7ab88b098defB751B7401B5f6d8976F");
    fireEvent.click(screen.getByRole("button", { name: "추가하고 거래 불러오기" }));

    await waitFor(() => expect(auth.registerWatchWallet).toHaveBeenCalledWith({ address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" }));
    expect(auth.verify).not.toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard?importing=1"));
    expect(cache.getQueryState(["portfolio", "wallets"])?.isInvalidated).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("rejects an address whose checksum does not match instead of registering it", async () => {
    const auth = authClient();
    render(<ConnectWalletFlow walletPort={walletPort()} authClient={auth} />);

    fireEvent.click(screen.getByRole("button", { name: /주소로 추가/ }));
    // 마지막 글자만 대소문자를 뒤집은 값 — 형식은 맞지만 EIP-55 체크섬이 깨진다.
    fireEvent.change(screen.getByLabelText("지갑 주소"), { target: { value: "0x71C7656EC7ab88b098defB751B7401B5f6d8976f" } });

    // 오류는 버튼을 누르기 전에 입력창 아래에 바로 보이고, 다음 단계는 잠긴다.
    expect(await screen.findByRole("alert")).toHaveTextContent("검증값");
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(auth.registerWatchWallet).not.toHaveBeenCalled();
  });

  it("blocks re-registering the wallet that is already bound", async () => {
    const auth = authClient();
    render(<ConnectWalletFlow walletPort={walletPort()} authClient={auth} boundAddress="0x71C7656EC7ab88b098defB751B7401B5f6d8976F" />);

    fireEvent.click(screen.getByRole("button", { name: /주소로 추가/ }));
    fireEvent.change(screen.getByLabelText("지갑 주소"), { target: { value: "0x71c7656ec7ab88b098defb751b7401b5f6d8976f" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("이미 등록된 지갑입니다");
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(auth.registerWatchWallet).not.toHaveBeenCalled();
  });

  // 확장 프로그램은 승인된 오리진에서 활성 계정을 그대로 돌려준다. 그대로 서명하면 같은 지갑을
  // 다시 등록하는 셈이고 서버는 upsert라 조용히 통과한다 — 서명을 요구하기 전에 끊어야 한다.
  it("blocks signing when the connected account is the wallet already bound", async () => {
    const port = walletPort();
    const auth = authClient();
    render(<ConnectWalletFlow walletPort={port} authClient={auth} boundAddress="0x71C7656EC7ab88b098defB751B7401B5f6d8976F" />);

    fireEvent.click(screen.getByRole("button", { name: /브라우저 지갑으로 연결/ }));

    // 서명 버튼이 잠기고 이유가 먼저 보인다 — 서명창을 띄운 뒤에 거절하지 않는다.
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 등록된 지갑입니다");
    expect(screen.getByRole("button", { name: "서명하고 추가" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "서명하고 추가" }));
    expect(auth.requestNonce).not.toHaveBeenCalled();
    expect(port.signMessage).not.toHaveBeenCalled();
  });

  it("shows the mismatch message for a 400 verification response", async () => {
    const port = walletPort();
    const auth = authClient();
    vi.mocked(auth.requestNonce).mockResolvedValue({ nonce: "nonce12345", domain: "wallet.example", uri: "https://wallet.example", chainId: 8453, issuedAt: "2026-07-30T00:00:00.000Z", expiresAtMs: 1785373200000 });
    vi.mocked(auth.verify).mockRejectedValue(new AuthClientError(400, "challenge_mismatch", "Challenge does not match signed message."));
    render(<ConnectWalletFlow walletPort={port} authClient={auth} />);
    // 기본 경로는 주소 입력이다. 서명 경로는 방법 선택에서 브라우저 지갑 행을 골라야 나온다.
    fireEvent.click(screen.getByRole("button", { name: /브라우저 지갑으로 연결/ }));
    fireEvent.click(screen.getByRole("button", { name: "서명하고 추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("인증 요청 불일치");
  });
});
const delayedNonce = { nonce: "noncefromserver123", domain: "wallet.example", uri: "https://wallet.example/login", chainId: 8453, issuedAt: "2026-07-30T00:00:00.000Z", expiresAtMs: 1785373200000 };

it("keeps the action locked through server verification and delayed navigation", async () => {
  push.mockReset();
  const port = walletPort(), auth = authClient();
  vi.mocked(auth.requestNonce).mockResolvedValue(delayedNonce);
  let finish!: (value: Awaited<ReturnType<AuthClient["verify"]>>) => void;
  vi.mocked(auth.verify).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<ConnectWalletFlow walletPort={port} authClient={auth} initialStep="siwe" />);
  const start = screen.getByRole("button", { name: "서명하고 추가" });
  fireEvent.click(start); fireEvent.click(start);
  expect(await screen.findByRole("button", { name: "서명 확인 중…" })).toBeDisabled();
  expect(auth.requestNonce).toHaveBeenCalledTimes(1);
  expect(auth.verify).toHaveBeenCalledTimes(1);
  finish({} as Awaited<ReturnType<AuthClient["verify"]>>);
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  const pendingNavigation = screen.getByRole("button", { name: "거래 조회 준비 중…" });
  expect(pendingNavigation).toBeDisabled();
  fireEvent.click(pendingNavigation);
  expect(auth.requestNonce).toHaveBeenCalledTimes(1);
});

it("does not verify a late wallet signature after leaving the signing step", async () => {
  push.mockReset();
  const port = walletPort(), auth = authClient();
  vi.mocked(auth.requestNonce).mockResolvedValue(delayedNonce);
  let finish!: (value: string) => void;
  vi.mocked(port.signMessage).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<ConnectWalletFlow walletPort={port} authClient={auth} initialStep="siwe" />);
  fireEvent.click(screen.getByRole("button", { name: "서명하고 추가" }));
  await waitFor(() => expect(port.signMessage).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
  finish("0xsigned");
  await waitFor(() => expect(screen.getByRole("button", { name: /브라우저 지갑으로 연결/ })).toBeInTheDocument());
  expect(auth.verify).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

it("does not navigate on a late verification response after unmount", async () => {
  push.mockReset();
  const port = walletPort(), auth = authClient();
  vi.mocked(auth.requestNonce).mockResolvedValue(delayedNonce);
  let finish!: (value: Awaited<ReturnType<AuthClient["verify"]>>) => void;
  vi.mocked(auth.verify).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ConnectWalletFlow walletPort={port} authClient={auth} initialStep="siwe" />);
  fireEvent.click(screen.getByRole("button", { name: "서명하고 추가" }));
  await waitFor(() => expect(auth.verify).toHaveBeenCalledTimes(1));
  view.unmount();
  finish({} as Awaited<ReturnType<AuthClient["verify"]>>);
  await Promise.resolve();
  expect(push).not.toHaveBeenCalled();
});


it.each(["connect", "sign"] as const)("shows %s guidance only after five seconds of wallet waiting", async (kind) => {
  vi.useFakeTimers();
  const originalEthereum = (window as Window & { ethereum?: unknown }).ethereum;
  try {
    (window as Window & { ethereum?: unknown }).ethereum = {};
    const port = walletPort(), auth = authClient();
    if (kind === "connect") {
      port.getAccount = () => null;
      vi.mocked(port.connect).mockImplementation(() => new Promise(() => {}));
    } else {
      vi.mocked(auth.requestNonce).mockResolvedValue(delayedNonce);
      vi.mocked(port.signMessage).mockImplementation(() => new Promise(() => {}));
    }
    const view = render(<ConnectWalletFlow walletPort={port} authClient={auth} initialStep="siwe" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: kind === "connect" ? "지갑 연결하기" : "서명하고 추가" })); });
    const message = kind === "connect" ? /이 사이트의 연결 요청을 확인/ : /지갑 확장 프로그램을 열어 서명 요청을 승인/;
    await act(async () => { vi.advanceTimersByTime(4999); });
    expect(screen.queryByText(message)).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(screen.getByText(message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
    expect(screen.queryByText(message)).toBeNull();
    view.unmount();
  } finally {
    (window as Window & { ethereum?: unknown }).ethereum = originalEthereum;
    vi.useRealTimers();
  }
});


describe("MetaMask mobile connection", () => {
  it("connects without an injected extension and waits for approval before offering signature", async () => {
    const port = walletPort();
    port.getAccount = () => null;
    let resolve!: (account: { address: string; chainId: number }) => void;
    vi.mocked(port.connect).mockImplementation(() => new Promise(done => { resolve = done; }));
    const auth = authClient();
    render(<ConnectWalletFlow walletPort={port} authClient={auth} initialStep="siwe" />);
    fireEvent.click(screen.getByRole("button", { name: "MetaMask로 연결" }));
    expect(port.connect).toHaveBeenCalledWith("metamask");
    expect(screen.getByRole("button", { name: "지갑 응답 대기 중…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "지갑 연결하기" })).toBeDisabled();
    expect(auth.requestNonce).not.toHaveBeenCalled();
    await act(async () => resolve({ address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", chainId: 8453 }));
    expect(screen.getByRole("button", { name: "서명하고 추가" })).toBeEnabled();
    expect(port.signMessage).not.toHaveBeenCalled();
  });

  it("allows retry after MetaMask rejects the connection", async () => {
    const port = walletPort(); port.getAccount = () => null;
    vi.mocked(port.connect).mockRejectedValue({ cause: { code: 4001 } });
    render(<ConnectWalletFlow walletPort={port} authClient={authClient()} initialStep="siwe" />);
    fireEvent.click(screen.getByRole("button", { name: "MetaMask로 연결" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("지갑 연결을 취소했습니다");
    expect(screen.getByRole("button", { name: "MetaMask로 연결" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "MetaMask로 연결" }));
    await waitFor(() => expect(port.connect).toHaveBeenCalledTimes(2));
  });

  it("does not re-enter signing when a late mobile approval arrives after leaving", async () => {
    const port = walletPort(); port.getAccount = () => null;
    let resolve!: (account: { address: string; chainId: number }) => void;
    vi.mocked(port.connect).mockImplementation(() => new Promise(done => { resolve = done; }));
    const auth = authClient();
    render(<ConnectWalletFlow walletPort={port} authClient={auth} initialStep="siwe" />);
    fireEvent.click(screen.getByRole("button", { name: "MetaMask로 연결" }));
    fireEvent.click(screen.getByRole("button", { name: "대신 주소만 붙여넣기" }));
    await act(async () => resolve({ address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", chainId: 8453 }));
    expect(screen.getByLabelText("지갑 주소")).toBeInTheDocument();
    expect(auth.requestNonce).not.toHaveBeenCalled();
    expect(port.signMessage).not.toHaveBeenCalled();
  });
});

function render(ui: React.ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return renderBase(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
