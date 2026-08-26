import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectWalletFlow } from "@/components/wallet/connect-wallet-flow";
import { AuthClientError, type AuthClient } from "@/lib/ports/auth-client";
import type { WalletPort } from "@/lib/ports/wallet-port";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function walletPort(): WalletPort {
  return {
    connect: vi.fn(),
    getAccount: () => ({ address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", chainId: 8453 }),
    signMessage: vi.fn().mockResolvedValue("0xsigned"),
    subscribeConnection: () => () => undefined,
  };
}

function authClient(): AuthClient {
  return { requestNonce: vi.fn(), verify: vi.fn(), presentDid: vi.fn(), logout: vi.fn(), getSession: vi.fn() };
}

describe("wallet connection SIWE flow", () => {
  beforeEach(() => { push.mockReset(); });

  it("uses server nonce fields in the SIWE message and verifies the signature", async () => {
    const port = walletPort();
    const auth = authClient();
    const nonce = { nonce: "noncefromserver123", domain: "wallet.example", uri: "https://wallet.example/login", chainId: 8453, issuedAt: "2026-07-30T00:00:00.000Z", expiresAtMs: 1785373200000 };
    vi.mocked(auth.requestNonce).mockResolvedValue(nonce);
    render(<ConnectWalletFlow walletPort={port} authClient={auth} />);
    fireEvent.click(screen.getByRole("button", { name: "SIWE 서명으로 계속" }));
    await waitFor(() => expect(port.signMessage).toHaveBeenCalled());
    const message = vi.mocked(port.signMessage).mock.calls[0][0];
    expect(message).toContain("wallet.example wants you to sign in");
    expect(message).toContain("URI: https://wallet.example/login");
    expect(message).toContain("Nonce: noncefromserver123");
    expect(message).toContain("Issued At: 2026-07-30T00:00:00.000Z");
    expect(auth.verify).toHaveBeenCalledWith({ message, signature: "0xsigned" });
    // 서명 성공은 대시보드 진입이 아니라 **불러오기 진입**이다. 쿼리가 빠지면 모달이 뜨지 않고
    // 사용자는 동기화가 끝나기 전 대시보드를 빈 화면으로 본다.
    expect(push).toHaveBeenCalledWith("/dashboard?importing=1");
  });

  it("shows the mismatch message for a 400 verification response", async () => {
    const port = walletPort();
    const auth = authClient();
    vi.mocked(auth.requestNonce).mockResolvedValue({ nonce: "nonce12345", domain: "wallet.example", uri: "https://wallet.example", chainId: 8453, issuedAt: "2026-07-30T00:00:00.000Z", expiresAtMs: 1785373200000 });
    vi.mocked(auth.verify).mockRejectedValue(new AuthClientError(400, "challenge_mismatch", "Challenge does not match signed message."));
    render(<ConnectWalletFlow walletPort={port} authClient={auth} />);
    fireEvent.click(screen.getByRole("button", { name: "SIWE 서명으로 계속" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("인증 요청 불일치");
  });
});