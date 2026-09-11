"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import Link from "next/link";
import type { SessionWalletVerification } from "@/lib/ports/session-snapshot";
import { demoDefiPositions, demoNftHoldings, holdingsFromDto, walletChains } from "@/lib/wallet/holdings";
import { HoldingsFetchError } from "@/lib/adapters/http/holdings-provider.http";
import { useHoldings } from "@/lib/queries/holdings";
import { WalletPortfolio } from "@/components/wallet/wallet-portfolio";
import { AccountView } from "@/components/wallet/account-view";

/**
 * 연결된 지갑의 홈 화면. 두 뷰를 오간다:
 * - portfolio: 지갑 홈(상단 계정·주소·평가액 총합, 보유 토큰 목록).
 * - account: 상단 계정을 누르면 열리는 "계정" 화면(뒤로가기 + 지갑 추가).
 *
 * 토큰 보유분은 `/api/portfolio/holdings`(mock 모드면 데모 지갑, ON 모드면 BE 실잔액)에서 온다. NFT·디파이는
 * 아직 데모 예시다. 표시 중인 지갑은 세션(서버)이 단일 진실이라 주소는 서버에서 내려준 값을 쓴다.
 * 체인은 세션이 아니라 보유 자산에서 파생한다 — EVM 주소는 체인 불문 동일하고, 세션 계약에는 chainId가 없다.
 *
 * 조회 중·실패는 빈 지갑과 다르다. 이전 캐시를 "지금 것"처럼 단정하지 않고 각 상태를 따로 그린다.
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
  const query = useHoldings();
  const provenance = query.data?.provenance ?? "mock";
  const holdings = useMemo(() => (query.data ? holdingsFromDto(query.data.data.holdings) : []), [query.data]);
  // NFT·디파이는 mock(데모 지갑)에서만 그린다. 실지갑에 데모 NFT를 섞으면 상단 총액이 존재하지 않는 2만 달러를 말한다.
  const nfts = useMemo(() => (provenance === "mock" ? demoNftHoldings() : []), [provenance]);
  const defi = useMemo(() => (provenance === "mock" ? demoDefiPositions() : []), [provenance]);
  // 자산이 실제로 놓여 있는 체인. 불러오기 모달과 같은 소스라 화면 간 체인 목록이 어긋나지 않는다.
  const chains = useMemo(() => walletChains(holdings, nfts, defi), [holdings, nfts, defi]);

  if (query.data === undefined) {
    if (query.isError) {
      const failure = describeFailure(query.error);
      return (
        <main data-surface="wallet-portfolio-error" className="min-h-dvh px-5 py-6">
          <p className="font-semibold text-zinc-900">보유 자산을 불러오지 못했습니다</p>
          <p className="mt-2 text-sm leading-6 text-zinc-600">{failure.message}</p>
          {failure.kind === "session" ? (
            <Link href="/login" className="mt-4 inline-block rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
              다시 로그인
            </Link>
          ) : (
            <button type="button" onClick={() => void query.refetch()} className="mt-4 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
              다시 시도
            </button>
          )}
        </main>
      );
    }
    return (
      <main data-surface="wallet-portfolio-loading" className="min-h-dvh px-5 py-6" aria-busy="true">
        <p className="text-sm text-zinc-500">보유 자산을 불러오는 중입니다…</p>
      </main>
    );
  }
  // 데이터가 있는 채로 재조회 중이거나 배경 재조회가 실패한 경우: 이전 값을 지우지 않되 "지금 것"이라고 단정하지도 않는다.
  const freshness = query.isError ? "stale" : query.isFetching ? "refreshing" : undefined;

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
      tokens={holdings}
      nfts={nfts}
      defi={defi}
      provenance={query.data.provenance}
      asOf={query.data.data.asOf}
      coverage={{
        skippedChainIds: query.data.data.skippedChainIds,
        truncatedChainIds: query.data.data.truncatedChainIds,
        unresolvedCount: query.data.data.unresolvedCount,
        droppedCount: query.data.data.droppedCount,
      }}
      freshness={freshness}
      onOpenAccount={() => setView("account")}
    />
  );
}

/**
 * 실패를 사용자 말로. 서버·BE의 message는 영어 원문이라 화면에 그대로 싣지 않고, 보존된 code로 고른다.
 * 세션 만료는 "다시 시도"로 풀리지 않으므로 로그인 경로를 준다.
 */
function describeFailure(error: unknown): { kind: "session" | "retry"; message: string } {
  const code = error instanceof HoldingsFetchError ? error.code : null;
  switch (code) {
    case "unauthorized":
      return { kind: "session", message: "로그인이 만료되었습니다. 다시 로그인한 뒤 확인해 주세요." };
    case "not_found":
      return { kind: "retry", message: "등록된 지갑이 없습니다. 지갑을 먼저 등록해 주세요." };
    case "service_unavailable":
    case "upstream_unavailable":
      return { kind: "retry", message: "잔액 서버에서 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요." };
    case "rate_limited":
      return { kind: "retry", message: "조회가 너무 잦아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요." };
    default:
      return { kind: "retry", message: "잠시 후 다시 시도해 주세요." };
  }
}
