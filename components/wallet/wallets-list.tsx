"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { ChainIcon } from "@/components/ui/chain-icon";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { ExchangeComingSoon } from "@/components/wallet/exchange-coming-soon";
import { WalletMark } from "@/components/wallet/wallet-mark";
import { WalletVerificationBadge, walletLabel } from "@/components/wallet/wallet-verification-badge";
import { chainLabel, formatFiat, shortHash } from "@/lib/format";
import type { RegisteredWalletDTO, WalletSummaryDTO } from "@/lib/http/dto";
import { useHoldings, useRegisteredWallets } from "@/lib/queries/holdings";

/**
 * 지갑 탭. 등록한 지갑을 나열하고 위에 전체 평가액을 둔다. 행을 누르면 그 지갑의 포트폴리오로 들어간다.
 *
 * 두 소스를 따로 읽는다:
 * - 목록(등록 방식·주소)은 저장소가 아는 사실이라 먼저, 그리고 잔액 조회가 실패해도 그려진다.
 * - 잔액·체인·평가액은 온체인 조회라 늦게 오고 실패할 수 있다. 그동안 값 자리는 스켈레톤이고, 실패하면
 *   총액 카드가 이유를 말하고 행마다 "잔액 미확인"을 쓴다. 숫자를 0으로 채우지 않는다.
 */
export function WalletsList(): React.JSX.Element {
  const wallets = useRegisteredWallets();
  const holdings = useHoldings();
  const summaries = useMemo(() => new Map((holdings.data?.data.byWallet ?? []).map((wallet) => [wallet.address.toLowerCase(), wallet])), [holdings.data]);
  const balanceState: "pending" | "error" | "ready" = holdings.data ? (holdings.isError ? "error" : "ready") : holdings.isError ? "error" : "pending";

  return (
    <main className="min-h-dvh px-5 py-8">
      <header data-surface="wallets-summary">
        <p className="text-sm font-semibold text-primary-500">데이터 소스</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">지갑·거래소 연결</h1>
        <p className="mt-1 text-sm text-zinc-500">여기 있는 소스의 거래만 목록과 계산에 들어갑니다.</p>
      </header>

      <TotalCard state={balanceState} walletCount={wallets.data?.wallets.length ?? null} holdings={holdings} />

      <section className="mt-6">
        {wallets.data === undefined ? (
          wallets.isError ? (
            <Card data-surface="wallets-error">
              <p className="font-semibold text-zinc-900">지갑 목록을 불러오지 못했습니다</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">잠시 후 다시 시도해 주세요. 로그인이 만료됐다면 다시 로그인해 주세요.</p>
              <button type="button" onClick={() => void wallets.refetch()} className="mt-4 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900">
                다시 시도
              </button>
            </Card>
          ) : (
            <div data-surface="wallets-loading" aria-busy="true" className="flex flex-col gap-3">
              <Skeleton className="h-5 w-28" />
              <Card className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-[10px]" /><span className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-3 w-40" /></span></Card>
            </div>
          )
        ) : (
          <>
            <h2 className="text-sm font-semibold text-zinc-500">등록한 지갑 {wallets.data.wallets.length}개</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {wallets.data.wallets.map((wallet) => (
                <WalletRow key={wallet.walletAddress.toLowerCase()} wallet={wallet} summary={summaries.get(wallet.walletAddress.toLowerCase()) ?? null} balanceState={balanceState} />
              ))}
            </ul>
          </>
        )}

        <Link href="/connect-wallet" data-surface="wallets-add" className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-primary-500 py-3.5 font-semibold text-white">
          지갑 추가하기
        </Link>
        <p className="mt-3 text-xs leading-4 text-zinc-400">로그인은 유지되고 이미 등록한 지갑도 그대로 남습니다. 등록한 지갑들의 거래는 함께 합산됩니다.</p>
      </section>

      <section className="mt-6">
        <ExchangeComingSoon />
      </section>
    </main>
  );
}

function TotalCard({ state, walletCount, holdings }: { state: "pending" | "error" | "ready"; walletCount: number | null; holdings: ReturnType<typeof useHoldings> }): React.JSX.Element {
  const data = holdings.data?.data;
  const provenance = holdings.data?.provenance;
  if (state === "error" && !data) {
    return (
      <Card data-surface="wallets-total-error" role="alert" className="mt-6 border border-orange-200">
        <p className="text-xs text-zinc-500">등록한 지갑 전체 평가액</p>
        <p className="mt-1 text-4xl font-bold tracking-tight text-zinc-400">—</p>
        <p className="mt-2 text-sm font-semibold text-zinc-900">잔액을 불러오지 못했습니다</p>
        <p className="mt-1 text-sm leading-5 text-zinc-600">잔액 서버에서 응답을 받지 못했습니다. 지갑 목록은 그대로이고, 거래 내역과 계산에는 영향이 없습니다.</p>
        <button type="button" onClick={() => void holdings.refetch()} className="mt-3 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900">
          다시 시도
        </button>
      </Card>
    );
  }
  return (
    <Card data-surface="wallets-total" className="mt-6" aria-busy={state === "pending"}>
      <p className="text-xs text-zinc-500">등록한 지갑 전체 평가액</p>
      {data ? (
        <>
          <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-zinc-900">{formatFiat(data.totalValueUsd, "USD")}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            {provenance === "mock" ? <MockProvenanceChip /> : null}
            <span>
              {provenance === "mock" ? "데모 예시 데이터(USD) 기준입니다." : `토큰 평가액 — 온체인 잔액과 DexScreener 시세 (${formatAsOf(data.asOf)} 기준).`}
              {walletCount !== null && walletCount > 1 ? ` 지갑 ${walletCount}개 합산.` : ""}
              {data.unpricedCount > 0 ? ` 시세 없는 자산 ${data.unpricedCount}개는 총액에서 뺐습니다.` : ""}
            </span>
          </p>
          {holdings.isError ? <p data-surface="wallets-total-stale" className="mt-1 text-xs text-amber-700">최근 조회에 실패해 이전 결과를 보여주고 있습니다.</p> : holdings.isFetching ? <p className="mt-1 text-xs text-zinc-500">잔액을 다시 확인하는 중입니다.</p> : null}
        </>
      ) : (
        <>
          <Skeleton className="mt-2 h-10 w-44" />
          <p role="status" className="mt-2 text-xs text-zinc-400">{walletCount === null ? "지갑의 잔액을 확인하는 중입니다…" : `지갑 ${walletCount}개의 잔액을 확인하는 중입니다…`}</p>
        </>
      )}
    </Card>
  );
}

function WalletRow({ wallet, summary, balanceState }: { wallet: RegisteredWalletDTO; summary: WalletSummaryDTO | null; balanceState: "pending" | "error" | "ready" }): React.JSX.Element {
  const address = wallet.walletAddress;
  return (
    <li>
      <Link
        href={`/wallets/${address.toLowerCase()}`}
        data-surface="wallet-row"
        aria-label={`${walletLabel(wallet.verificationMethod)} ${address} 포트폴리오 열기`}
        className="flex items-center gap-3 rounded-card bg-white py-4 pl-5 pr-4 shadow-card transition-colors hover:bg-zinc-50"
      >
        <WalletMark />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-zinc-900">{walletLabel(wallet.verificationMethod)}</p>
            <WalletVerificationBadge verification={wallet.verificationMethod} />
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-600">{shortHash(address)}</p>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
            {summary ? (
              summary.chainIds.length === 0 ? (
                <span>잔액이 있는 네트워크 없음</span>
              ) : (
                <>
                  <span className="flex items-center" aria-label={`네트워크 ${summary.chainIds.map(chainLabel).join(", ")}`}>
                    {summary.chainIds.map((chainId, index) => (
                      <span key={chainId} className={`inline-flex rounded-full ring-2 ring-white ${index > 0 ? "-ml-1.5" : ""}`}>
                        <ChainIcon chainId={chainId} size={16} />
                      </span>
                    ))}
                  </span>
                  <span>{summary.chainIds.length}개 네트워크 · 자산 {summary.holdingsCount}개</span>
                </>
              )
            ) : balanceState === "error" ? (
              <span className="text-zinc-400">잔액 미확인</span>
            ) : (
              <><Skeleton className="h-4 w-16 rounded-full" /><Skeleton className="h-3 w-28" /></>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {summary ? (
            <p className="font-semibold tabular-nums text-zinc-900">{formatFiat(summary.totalValueUsd, "USD")}</p>
          ) : balanceState === "error" ? (
            <p className="font-semibold text-zinc-400">—</p>
          ) : (
            <Skeleton className="h-5 w-16" />
          )}
          <svg aria-hidden="true" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </Link>
    </li>
  );
}

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
