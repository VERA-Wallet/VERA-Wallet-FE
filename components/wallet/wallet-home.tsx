"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { SessionWalletVerification } from "@/lib/ports/session-snapshot";
import { useHoldings } from "@/lib/queries/holdings";
import { holdingsFromDto, walletChains } from "@/lib/wallet/holdings";
import { WalletPortfolio } from "@/components/wallet/wallet-portfolio";
import { AccountView } from "@/components/wallet/account-view";

/**
 * 연결된 지갑의 홈 화면. 두 뷰를 오간다:
 * - portfolio: 지갑 홈(상단 계정·주소·평가액 총합, 보유 토큰 목록).
 * - account: 상단 계정을 누르면 열리는 "계정" 화면(뒤로가기 + 지갑 추가).
 *
 * 보유 자산은 BE의 온체인 잔액 + 현재가에서 온다(`GET /api/wallet/holdings`). 표시 중인 지갑은
 * 세션(서버)이 단일 진실이라 주소는 서버에서 내려준 값을 쓴다. 체인은 세션이 아니라 보유 자산에서
 * 파생한다 — EVM 주소는 체인 불문 동일하고, 세션 계약에는 chainId가 없다.
 *
 * NFT·디파이는 아직 실데이터 경로가 없어 화면에서 내렸다. 데모 상수를 실잔액 옆에 그대로 두면
 * 어느 쪽이 사실인지 화면만 보고는 구분할 수 없다.
 *
 * 지갑 추가는 로그인과 무관하다. 신원은 DID 세션이 쥐고 지갑은 그 아래 등록되는 별도 바인딩이라,
 * 지갑을 하나 더 붙이려고 세션을 끊을 이유가 없다 — 이미 등록된 지갑도 그대로 남는다.
 */
export function WalletHome({
  walletAddress,
  walletVerification = null,
}: {
  walletAddress: string;
  walletVerification?: SessionWalletVerification;
}) {
  const router = useRouter();
  const [view, setView] = useState<"portfolio" | "account">("portfolio");
  const holdings = useHoldings(walletAddress);

  const model = useMemo(
    () => (holdings.data ? holdingsFromDto(holdings.data) : { tokens: [], unpricedCount: 0, spamCount: 0 }),
    [holdings.data],
  );
  // 자산이 실제로 놓여 있는 체인. 불러오기 모달과 같은 소스라 화면 간 체인 목록이 어긋나지 않는다.
  const chains = useMemo(() => walletChains(model.tokens, [], []), [model.tokens]);

  if (view === "account") {
    return (
      <AccountView
        address={walletAddress}
        chains={chains}
        walletVerification={walletVerification}
        onBack={() => setView("portfolio")}
        onAddWallet={() => router.push("/connect-wallet")}
      />
    );
  }

  return (
    <WalletPortfolio
      address={walletAddress}
      chains={chains}
      tokens={model.tokens}
      unpricedCount={model.unpricedCount}
      spamCount={model.spamCount}
      skippedChainIds={holdings.data?.skippedChainIds ?? []}
      truncatedChainIds={holdings.data?.truncatedChainIds ?? []}
      isLoading={holdings.isLoading}
      isError={holdings.isError}
      onRetry={() => void holdings.refetch()}
      onOpenAccount={() => setView("account")}
    />
  );
}
