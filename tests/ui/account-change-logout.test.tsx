import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WalletSessionWatcher } from "@/components/wallet/wallet-session-watcher";
import type { AuthClient } from "@/lib/ports/auth-client";
import type { WalletAccount, WalletPort } from "@/lib/ports/wallet-port";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockReset());

function authClient(): AuthClient {
  return { requestNonce: vi.fn(), verify: vi.fn(), presentDid: vi.fn(), logout: vi.fn().mockResolvedValue(undefined), getSession: vi.fn() };
}

function walletPort(account: WalletAccount | null) {
  let notify: ((state: WalletAccount | null) => void) | undefined;
  const port: WalletPort = {
    connect: vi.fn(),
    getAccount: () => account,
    signMessage: vi.fn(),
    subscribeConnection: (callback) => {
      notify = callback;
      return () => undefined;
    },
  };
  return { notify: (state: WalletAccount | null) => notify?.(state), port };
}

const account = { address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", chainId: 1 };

describe("WalletSessionWatcher", () => {
  it("does not log out or redirect for the initial null-to-account connection", async () => {
    const wallet = walletPort(null);
    const auth = authClient();
    render(<WalletSessionWatcher walletPort={wallet.port} authClient={auth} />);

    await act(async () => wallet.notify(account));

    expect(auth.logout).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("logs out and redirects when the account changes", async () => {
    const wallet = walletPort(account);
    const auth = authClient();
    render(<WalletSessionWatcher walletPort={wallet.port} authClient={auth} />);

    await act(async () => wallet.notify({ ...account, address: "0x8ba1f109551bD432803012645Ac136ddd64DBA72" }));

    await waitFor(() => expect(auth.logout).toHaveBeenCalledOnce());
    expect(push).toHaveBeenCalledWith("/login");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("logs out and redirects when only the chain changes", async () => {
    const wallet = walletPort(account);
    const auth = authClient();
    render(<WalletSessionWatcher walletPort={wallet.port} authClient={auth} />);

    await act(async () => wallet.notify({ ...account, chainId: 8453 }));

    await waitFor(() => expect(auth.logout).toHaveBeenCalledOnce());
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("does not redirect and shows a retry alert when logout fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wallet = walletPort(account);
    const auth = authClient();
    vi.mocked(auth.logout).mockRejectedValue(new Error("logout_failed"));
    render(<WalletSessionWatcher walletPort={wallet.port} authClient={auth} />);

    await act(async () => wallet.notify(null));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("세션 종료 요청이 실패했습니다.", expect.any(Error));
    errorSpy.mockRestore();
  });

  it("retries logout from the failure alert", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wallet = walletPort(account);
    const auth = authClient();
    vi.mocked(auth.logout).mockRejectedValueOnce(new Error("logout_failed")).mockResolvedValue(undefined);
    render(<WalletSessionWatcher walletPort={wallet.port} authClient={auth} />);

    await act(async () => wallet.notify(null));

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(2));
    // 재시도가 성공하면 실제로 로그인 화면으로 가고 실패 알림이 사라져야 한다. 호출 횟수만 보면 이 전이가 사라져도 통과한다.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    errorSpy.mockRestore();
  });
});
