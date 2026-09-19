"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ChainIcon } from "@/components/ui/chain-icon";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { WalletMark } from "@/components/wallet/wallet-mark";
import { chainLabel, formatFiat, shortHash } from "@/lib/format";
import type { RegisteredWalletDTO, WalletSummaryDTO } from "@/lib/http/dto";
import { useHoldings, useRegisteredWallets } from "@/lib/queries/holdings";

type SourceTab = "wallet" | "exchange";
type BalanceState = "pending" | "error" | "ready";

/**
 * 지갑 탭. 자산 요약형 구조: 상단바(제목 + "지갑 불러오기" 시트), 인라인 전체 평가액, 소스 탭(지갑·거래소),
 * 회색 그룹 카드 안의 지갑 행(금액 → 주소 + 잔액 있는 체인 로고 → ›). 행을 누르면 그 지갑의 포트폴리오로 들어간다.
 *
 * 두 소스를 따로 읽는다:
 * - 목록(주소)은 저장소가 아는 사실이라 먼저, 그리고 잔액 조회가 실패해도 그려진다.
 * - 잔액·체인·평가액은 온체인 조회라 늦게 오고 실패할 수 있다. 그동안 값 자리는 스켈레톤이고, 실패하면
 *   헤드라인이 이유를 말하고 행마다 "US$?"와 "잔액 미확인"을 쓴다. 숫자를 0으로 채우지 않는다.
 * 등록 방식 배지·이름은 목록에 두지 않는다(2026-09-11 결정).
 */
export function WalletsList(): React.JSX.Element {
  const wallets = useRegisteredWallets();
  const holdings = useHoldings();
  const [tab, setTab] = useState<SourceTab>("wallet");
  const [sheetOpen, setSheetOpen] = useState(false);
  const summaries = useMemo(() => new Map((holdings.data?.data.byWallet ?? []).map((wallet) => [wallet.address.toLowerCase(), wallet])), [holdings.data]);
  const balanceState: BalanceState = holdings.data ? "ready" : holdings.isError ? "error" : "pending";
  const data = holdings.data?.data;

  return (
    <main className="min-h-dvh px-5 pb-6 pt-2">
      <header data-surface="wallets-summary">
        <div className="flex items-center justify-between py-3">
          <h1 className="text-lg font-bold text-zinc-900">지갑</h1>
          <button type="button" onClick={() => setSheetOpen(true)} data-surface="wallets-import" className="text-[15px] font-semibold text-zinc-700">
            지갑 불러오기
          </button>
        </div>

        <div data-surface="wallets-total" aria-busy={balanceState === "pending"} className="mt-5">
          <p className="flex items-baseline gap-2 text-xl font-bold text-zinc-900">
            <span>전체 평가액</span>
            {data ? (
              <span className="tabular-nums">{formatFiat(data.totalValueUsd, "USD")}</span>
            ) : balanceState === "error" ? (
              <span className="text-zinc-400">—</span>
            ) : (
              <Skeleton className="h-6 w-24" />
            )}
          </p>
          {data ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              {holdings.data ? <ProvenanceChip provenance={holdings.data.provenance} /> : null}
              <span>
                {holdings.data?.provenance === "mock" ? "데모 예시 데이터(USD) 기준" : `온체인 잔액 × DexScreener 시세 · ${formatAsOf(data.asOf)} 기준`}
                {wallets.data && wallets.data.wallets.length > 1 ? ` · 지갑 ${wallets.data.wallets.length}개 합산` : ""}
                {data.unpricedCount > 0 ? ` · 시세 없는 자산 ${data.unpricedCount}개 제외` : ""}
              </span>
              {holdings.isError ? <span data-surface="wallets-total-stale" className="text-amber-700">최근 조회에 실패해 이전 결과입니다.</span> : holdings.isFetching ? <span className="text-zinc-500">다시 확인하는 중</span> : null}
            </p>
          ) : balanceState === "error" ? (
            <p role="alert" data-surface="wallets-total-error" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-dispose">
              <span>잔액 서버에서 응답을 받지 못했습니다. 거래 내역과 계산에는 영향이 없습니다.</span>
              <button type="button" onClick={() => void holdings.refetch()} className="font-bold underline underline-offset-2">다시 시도</button>
            </p>
          ) : (
            <p role="status" className="mt-1 text-xs text-zinc-400">
              {wallets.data ? `지갑 ${wallets.data.wallets.length}개의 잔액을 확인하는 중입니다…` : "지갑의 잔액을 확인하는 중입니다…"}
            </p>
          )}
        </div>
      </header>

      <div role="tablist" aria-label="자산 소스" className="-mx-5 mt-5 flex gap-6 border-b border-zinc-200 px-5">
        {([["wallet", "지갑"], ["exchange", "거래소"]] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 pb-2.5 text-base transition-colors ${tab === value ? "border-zinc-900 font-bold text-zinc-900" : "border-transparent font-semibold text-zinc-400"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "wallet" ? (
        <section data-surface="wallets-group" className="mt-4 flex flex-col gap-1 rounded-3xl bg-zinc-100 p-5">
          {wallets.data === undefined ? (
            wallets.isError ? (
              <div data-surface="wallets-error" className="py-2">
                <p className="font-semibold text-zinc-900">지갑 목록을 불러오지 못했습니다</p>
                <p className="mt-1 text-sm leading-5 text-zinc-600">잠시 후 다시 시도해 주세요. 로그인이 만료됐다면 다시 로그인해 주세요.</p>
                <button type="button" onClick={() => void wallets.refetch()} className="mt-3 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900">다시 시도</button>
              </div>
            ) : (
              <div data-surface="wallets-loading" aria-busy="true" className="flex items-center gap-3 py-2">
                <Skeleton className="h-10 w-10 rounded-[10px] bg-zinc-200" />
                <span className="flex flex-1 flex-col gap-2"><Skeleton className="h-6 w-24 bg-zinc-200" /><Skeleton className="h-4 w-36 bg-zinc-200" /></span>
              </div>
            )
          ) : wallets.data.wallets.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500">등록한 지갑이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {wallets.data.wallets.map((wallet) => (
                <WalletRow key={wallet.walletAddress.toLowerCase()} wallet={wallet} summary={summaries.get(wallet.walletAddress.toLowerCase()) ?? null} balanceState={balanceState} />
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setSheetOpen(true)} data-surface="wallets-add" className="mt-3 w-full rounded-2xl bg-white py-4 font-bold text-zinc-900 shadow-[0_1px_2px_rgb(24_24_27/0.04)]">
            지갑 추가하기
          </button>
        </section>
      ) : (
        <section data-surface="exchange-coming-soon" className="mt-4 flex flex-col gap-1 rounded-3xl bg-zinc-100 p-5">
          {[["UP", "업비트"], ["BB", "빗썸"], ["CO", "코인원"]].map(([mark, name]) => (
            <div key={name} className="flex items-center gap-3 py-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-200 text-xs font-bold text-zinc-500">{mark}</span>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold text-zinc-400">—</p>
                <p className="text-sm text-zinc-400">{name} · 준비 중</p>
              </div>
            </div>
          ))}
          <p className="mt-2 text-xs leading-4 text-zinc-400">거래소 계정 연동은 준비 중입니다. 지금은 지갑 연결로 온체인 거래를 불러옵니다.</p>
        </section>
      )}

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="지갑 불러오기">
        <ul data-surface="wallets-import-sheet" className="flex flex-col">
          <li>
            <Link href="/connect-wallet?method=browser" className="flex items-center gap-3.5 px-1 py-3.5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                <svg aria-hidden="true" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" strokeLinejoin="round" /><path d="M15.5 13.2h.01" strokeLinecap="round" strokeWidth="2.4" /></svg>
              </span>
              <span className="flex flex-col gap-0.5"><span className="text-[17px] font-semibold text-zinc-900">브라우저 지갑 연결</span><span className="text-[13px] text-zinc-500">서명으로 소유를 증명합니다</span></span>
            </Link>
          </li>
          <li>
            <Link href="/connect-wallet?method=address" className="flex items-center gap-3.5 px-1 py-3.5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                <svg aria-hidden="true" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4l10-10-4-4L4 16z" strokeLinejoin="round" /><path d="m13 7 4 4" strokeLinecap="round" /></svg>
              </span>
              <span className="flex flex-col gap-0.5"><span className="text-[17px] font-semibold text-zinc-900">주소만 등록 (직접 입력)</span><span className="text-[13px] text-zinc-500">서명 없이 관찰만 합니다</span></span>
            </Link>
          </li>
          <li className="flex items-center gap-3.5 px-1 py-3.5 opacity-50">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
              <svg aria-hidden="true" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16v12H4z" strokeLinejoin="round" /><path d="M8 12h8M8 15h5" strokeLinecap="round" /></svg>
            </span>
            <span className="flex flex-col gap-0.5"><span className="text-[17px] font-semibold text-zinc-900">거래소 계정</span><span className="text-[13px] text-zinc-500">업비트·빗썸 · 준비 중</span></span>
          </li>
        </ul>
      </BottomSheet>
    </main>
  );
}

function WalletRow({ wallet, summary, balanceState }: { wallet: RegisteredWalletDTO; summary: WalletSummaryDTO | null; balanceState: BalanceState }): React.JSX.Element {
  const address = wallet.walletAddress;
  const failed = summary === null && balanceState === "error";
  return (
    <li>
      <Link href={`/wallets/${address.toLowerCase()}`} data-surface="wallet-row" aria-label={`${address} 포트폴리오 열기`} className="flex items-center gap-3 py-2">
        <span className="relative inline-flex shrink-0">
          <WalletMark size={40} />
          {failed ? <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-dispose ring-2 ring-zinc-100" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          {summary ? (
            <p className="text-lg font-bold tabular-nums text-zinc-900">{formatFiat(summary.totalValueUsd, "USD")}</p>
          ) : failed ? (
            <p className="text-lg font-bold text-zinc-900">US$?</p>
          ) : (
            <Skeleton className="h-6 w-24 bg-zinc-200" />
          )}
          <p className="mt-0.5 flex items-center gap-2 text-[13px] text-zinc-500">
            <span className="font-mono">{shortHash(address)}</span>
            {summary ? (
              summary.chainIds.length > 0 ? (
                <span className="flex items-center" aria-label={`네트워크 ${summary.chainIds.map(chainLabel).join(", ")}`}>
                  {summary.chainIds.map((chainId, index) => (
                    <span key={chainId} className={`inline-flex rounded-full ring-2 ring-zinc-100 ${index > 0 ? "-ml-[5px]" : ""}`}>
                      <ChainIcon chainId={chainId} size={16} />
                    </span>
                  ))}
                </span>
              ) : null
            ) : failed ? (
              <span className="font-semibold text-dispose">잔액 미확인</span>
            ) : (
              <Skeleton className="h-4 w-[72px] rounded-full bg-zinc-200" />
            )}
          </p>
        </div>
        <svg aria-hidden="true" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-zinc-400">
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
