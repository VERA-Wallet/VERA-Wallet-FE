"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { authClient as compositionAuthClient } from "@/lib/composition-root.client";
import type { AuthClient } from "@/lib/ports/auth-client";
import { demoDefiPositions, demoNftHoldings, demoWalletHoldings } from "@/lib/wallet/holdings";
import { WalletPortfolio } from "@/components/wallet/wallet-portfolio";
import { AccountView } from "@/components/wallet/account-view";

/**
 * 연결된 지갑의 홈 화면. 두 뷰를 오간다:
 * - portfolio: 지갑 홈(상단 계정·주소·평가액 총합, 보유 토큰 목록).
 * - account: 상단 계정을 누르면 열리는 "계정" 화면(뒤로가기 + 다른 지갑 연결).
 *
 * 보유 자산은 데모 보유 소스(ETH·USDT·USDC + 데모 시세)에서 온다. 지갑 바인딩은 세션(서버)이 단일
 * 진실이라 주소·체인은 서버에서 내려준 값을 쓴다. 다른 지갑 연결은 세션을 종료하고 로그인부터 다시
 * 인증하는 명시적 핸드오프다(WalletSessionWatcher 보안 규약 준수).
 */
export function WalletHome({
  walletAddress,
  chainId,
  authClient = compositionAuthClient,
}: {
  walletAddress: string;
  chainId: number;
  authClient?: AuthClient;
}) {
  const router = useRouter();
  const [view, setView] = useState<"portfolio" | "account">("portfolio");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const holdings = useMemo(() => demoWalletHoldings(), []);
  const nfts = useMemo(() => demoNftHoldings(), []);
  const defi = useMemo(() => demoDefiPositions(), []);

  async function connectOtherWallet() {
    setSwitchError(null);
    setSwitching(true);
    try {
      // 세션을 먼저 종료해 다른 지갑을 깨끗한 상태에서 다시 인증한다. 로그인으로 보내야 재바인딩이 시작된다.
      await authClient.logout();
      router.push("/login");
    } catch {
      // 로그아웃이 실패했는데 로그인으로 보내면 세션이 살아있는데 보호됐다고 오해하게 된다.
      setSwitchError("세션을 종료하지 못했습니다. 다시 시도해 주세요.");
      setSwitching(false);
    }
  }

  if (view === "account") {
    return (
      <AccountView
        address={walletAddress}
        chainId={chainId}
        onBack={() => setView("portfolio")}
        onConnectOther={connectOtherWallet}
        switching={switching}
        error={switchError}
      />
    );
  }

  return (
    <WalletPortfolio
      address={walletAddress}
      chainId={chainId}
      tokens={holdings}
      nfts={nfts}
      defi={defi}
      onOpenAccount={() => setView("account")}
    />
  );
}
