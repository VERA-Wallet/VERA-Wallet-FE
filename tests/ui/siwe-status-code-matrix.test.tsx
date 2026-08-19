import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConnectWalletFlow } from "@/components/wallet/connect-wallet-flow";
import { AuthClientError, type AuthClient } from "@/lib/ports/auth-client";
import type { WalletAccount, WalletPort } from "@/lib/ports/wallet-port";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const account: WalletAccount = { address: "0x1111111111111111111111111111111111111111", chainId: 1 };

function walletPort(): WalletPort {
  return {
    getAccount: () => account,
    connect: async () => account,
    signMessage: async () => "0xsignature",
    subscribeConnection: () => () => undefined,
  };
}

function authClientRejecting(error: AuthClientError): AuthClient {
  return {
    requestNonce: async () => { throw error; },
    verify: async () => { throw error; },
    presentDid: async () => { throw error; },
    logout: async () => undefined,
    getSession: async () => ({ didVerified: false, countryCode: null, walletAddress: null, chainId: null }),
  };
}

// FE mock도 이제 BE와 같은 status다 — code 기준 분기는 원인 구분 정확성을 위해 유지
const matrix: Array<[string, number, string, string]> = [
  ["BE replay", 409, "already-consumed", "인증 요청 불일치"],
  ["BE challenge mismatch", 400, "challenge_mismatch", "인증 요청 불일치"],
  ["OFF mock replay", 409, "already-consumed", "인증 요청 불일치"],
  ["OFF mock mismatch", 400, "challenge_mismatch", "인증 요청 불일치"],
  ["challenge not found", 400, "challenge_not_found", "인증 요청을 찾을 수 없습니다. 다시 시도해 주세요."],
  ["expired challenge", 410, "challenge_expired", "만료됨 — 다시 시도"],
  ["invalid signature", 401, "invalid_signature", "서명을 확인할 수 없습니다."],
];

describe("SIWE error code mapping", () => {
  it.each(matrix)("maps %s to its own message", async (_name, status, code, expected) => {
    render(<ConnectWalletFlow walletPort={walletPort()} authClient={authClientRejecting(new AuthClientError(status, code, "raw backend message"))} />);
    await userEvent.click(screen.getByRole("button", { name: "SIWE 서명으로 계속" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
  });

  it("does not collapse an unrelated 400 into the mismatch message", async () => {
    render(<ConnectWalletFlow walletPort={walletPort()} authClient={authClientRejecting(new AuthClientError(400, "invalid_request", "chainId is required."))} />);
    await userEvent.click(screen.getByRole("button", { name: "SIWE 서명으로 계속" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("chainId is required.");
    expect(alert).not.toHaveTextContent("인증 요청 불일치");
  });
});
