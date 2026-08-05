"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { authClient as compositionAuthClient } from "@/lib/composition-root.client";
import type { AuthClient } from "@/lib/ports/auth-client";
import type { WalletAccount, WalletPort } from "@/lib/ports/wallet-port";
import { wagmiWalletPort } from "@/lib/wallet/wagmi-wallet-port";

export function WalletSessionWatcher({ walletPort = wagmiWalletPort, authClient = compositionAuthClient }: { walletPort?: WalletPort; authClient?: AuthClient }) {
  const router = useRouter();
  const accountRef = useRef<WalletAccount | null>(null);

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
      void authClient
        .logout()
        .catch((cause: unknown) => console.error("세션 종료 요청이 실패했습니다.", cause))
        .finally(() => router.push("/login"));
    });
  }, [authClient, router, walletPort]);

  return null;
}
