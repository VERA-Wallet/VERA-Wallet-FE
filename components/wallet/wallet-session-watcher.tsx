"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient as compositionAuthClient } from "@/lib/composition-root.client";
import type { AuthClient } from "@/lib/ports/auth-client";
import type { WalletAccount, WalletPort } from "@/lib/ports/wallet-port";
import { wagmiWalletPort } from "@/lib/wallet/wagmi-wallet-port";

export function WalletSessionWatcher({ walletPort = wagmiWalletPort, authClient = compositionAuthClient }: { walletPort?: WalletPort; authClient?: AuthClient }) {
  const router = useRouter();
  const accountRef = useRef<WalletAccount | null>(null);
  const [logoutFailed, setLogoutFailed] = useState(false);

  const logout = useCallback(() => {
    setLogoutFailed(false);
    void authClient
      .logout()
      .then(() => router.push("/login"))
      // finally에서 로그인 화면으로 이동하면 서버 세션이 살아있어도 사용자는 보호됐다고 오해할 수 있다.
      .catch((cause: unknown) => {
        console.error("세션 종료 요청이 실패했습니다.", cause);
        setLogoutFailed(true);
      });
  }, [authClient, router]);

  useEffect(() => {
    accountRef.current = walletPort.getAccount();

    return walletPort.subscribeConnection((nextAccount) => {
      const previous = accountRef.current;
      if (previous === null) {
        accountRef.current = nextAccount;
        return;
      }
      if (previous.address === nextAccount?.address && previous.chainId === nextAccount?.chainId) return;

      accountRef.current = nextAccount;
      logout();
    });
  }, [logout, walletPort]);

  if (!logoutFailed) return null;

  return (
    <div role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
      <p>세션을 종료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
      <button className="mt-3 rounded-xl bg-primary-500 px-3 py-2 font-semibold text-white" onClick={logout} type="button">
        다시 시도
      </button>
    </div>
  );
}
