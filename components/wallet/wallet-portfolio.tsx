"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { AssetLogo } from "@/components/ui/asset-logo";
import { ChainIcon } from "@/components/ui/chain-icon";
import { WalletMark } from "@/components/wallet/wallet-mark";
import { chainLabel, formatFiat, shortHash } from "@/lib/format";
import {
  compareDecimal,
  holdingGainUsd,
  holdingsGainSummary,
  returnPercent,
  totalValueUsd,
  type Holding,
  type WalletChain,
} from "@/lib/wallet/holdings";

/**
 * 평가손익·수익률 한 조각. 상승은 브랜드 receive(녹색), 하락은 dispose(적색) 토큰을 쓰고,
 * 색만으로 구분하지 못하는 사용자를 위해 부호(`+`/`−`)를 늘 함께 둔다. 손익은 mock 취득원가로
 * 계산한 **표시 산술**이다(세무 엔진이 아니다).
 */
function GainInline({ gainUsd, costUsd }: { gainUsd: string | null; costUsd: string | null }): React.JSX.Element | null {
  // 원가를 모르면 손익을 말하지 않는다. 0으로 뭉개면 "전액이 이익"이라는 없던 주장이 생긴다.
  if (gainUsd === null || costUsd === null) return null;
  const direction = compareDecimal(gainUsd, "0");
  const tone = direction > 0 ? "text-receive" : direction < 0 ? "text-dispose" : "text-zinc-500";
  const percent = returnPercent(costUsd, gainUsd);
  // formatFiat은 음수에 이미 `-`를 붙인다 — 양수일 때만 `+`를 더한다.
  const gainText = `${direction > 0 ? "+" : ""}${formatFiat(gainUsd, "USD")}`;
  const percentText = percent === null ? null : `${direction > 0 ? "+" : ""}${percent}%`;
  return (
    <span className={`tabular-nums ${tone}`}>
      {gainText}
      {percentText ? ` · ${percentText}` : ""}
    </span>
  );
}

/** 자산 마크 + 우하단 네트워크 배지. */
function BadgedAvatar({ chainId, ariaLabel, children }: { chainId: number; ariaLabel: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex shrink-0" aria-label={ariaLabel}>
      {children}
      <span className="absolute -bottom-1 -right-1 rounded-full bg-white ring-2 ring-white">
        <ChainIcon chainId={chainId} size={16} />
      </span>
    </span>
  );
}

function TokenAvatar({ holding }: { holding: Holding }) {
  return (
    <BadgedAvatar chainId={holding.chainId} ariaLabel={`${holding.name} · ${holding.chainName}`}>
      <AssetLogo
        event={{
          chain_id: holding.chainId,
          asset_type: holding.contract === null ? "NATIVE" : "ERC20",
          asset_contract: holding.contract,
          asset_symbol: holding.symbol,
          asset_icon_url: null,
          token_id: null,
        }}
        size={40}
      />
    </BadgedAvatar>
  );
}

function TokenRow({ holding }: { holding: Holding }) {
  return (
    <li data-surface="holding-row" className="flex items-center gap-3 py-3">
      <TokenAvatar holding={holding} />
      <div className="min-w-0 flex-1">
        <p className="min-w-0 truncate font-semibold text-zinc-900">{holding.symbol}</p>
        <p className="mt-0.5 truncate text-sm text-zinc-500">{formatFiat(holding.priceUsd, "USD")}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums text-zinc-900">{formatFiat(holding.valueUsd, "USD")}</p>
        {holding.costUsd === null ? null : (
          <p className="mt-0.5 text-xs font-medium">
            <GainInline gainUsd={holdingGainUsd(holding)} costUsd={holding.costUsd} />
          </p>
        )}
        <p className="mt-0.5 text-xs tabular-nums text-zinc-400">
          {holding.amount} {holding.symbol}
        </p>
      </div>
    </li>
  );
}

/**
 * 토큰 탭 상단 요약. 보이는 토큰들의 전체 평가액·평가손익·수익률을 한눈에 보인다.
 * NFT·디파이는 mock 취득원가가 없어 이 요약은 **토큰 보유분**만 집계한다 —
 * 상단 큰 총액(portfolioTotalUsd)과 뜻이 갈리지 않도록 무엇을 집계했는지 라벨로 밝힌다.
 */
function TokenHoldingsSummary({ holdings, chainId }: { holdings: Holding[]; chainId: number }): React.JSX.Element {
  const summary = holdingsGainSummary(holdings);
  return (
    <div data-surface="wallet-holdings-summary" className="mt-3 rounded-card border border-zinc-100 p-4 shadow-card">
      <p className="text-xs text-zinc-500">{chainLabel(chainId)} 평가액</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">{formatFiat(summary.valueUsd, "USD")}</p>
      {summary.gainUsd === null ? null : (
        <p className="mt-1 text-sm font-semibold">
          <span className="text-zinc-500">평가손익 </span>
          <GainInline gainUsd={summary.gainUsd} costUsd={summary.costUsd} />
        </p>
      )}
    </div>
  );
}


/**
 * 연결된 지갑의 지갑 홈(코인베이스형). 이 앱의 데이터/제약에 맞춘다:
 * - 토큰(ETH·USDT·USDC)·NFT(대중 컬렉션)·디파이 포지션을 각각 탭으로 보여준다.
 * - 값은 **데모 예시 데이터(USD)** 다 — 실시간 시세·잔액이 아니다(화면에 명시). 로고/아트워크는 기억으로
 *   그리지 않는다(토큰은 공개 벡터, NFT/프로토콜은 생성 플레이스홀더).
 * - 매수·스왑·전송·받기 액션과 광고 배너는 두지 않는다. 네트워크 배지는 자산 이미지 우하단에 얹는다.
 * - 각 탭은 평가액 내림차순으로 정렬된 상태로 들어온다.
 */
export function WalletPortfolio({
  address,
  chains,
  tokens,
  unpricedCount = 0,
  spamCount = 0,
  skippedChainIds = [],
  truncatedChainIds = [],
  isLoading = false,
  isError = false,
  onRetry,
  onOpenAccount,
}: {
  address: string;
  /** 자산이 있는 체인들(보유 자산 파생). 주소 칩이 "이 지갑이 걸쳐 있는 네트워크"를 이 목록으로 말한다. */
  chains: WalletChain[];
  tokens: Holding[];
  /** 시세를 확인하지 못해 목록에서 접은 건수. 0원이 아니라 "모른다"이므로 숫자로만 말한다. */
  unpricedCount?: number;
  /** 스팸으로 접은 건수. */
  spamCount?: number;
  /** 잔액을 읽지 못한 체인. 부분 실패를 빈 지갑으로 보이게 두지 않는다. */
  skippedChainIds?: number[];
  /** 토큰 상한에 걸려 잘린 체인. */
  truncatedChainIds?: number[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onOpenAccount: () => void;
}): React.JSX.Element {
  const [network, setNetwork] = useState<number | "all">("all");
  const [copied, setCopied] = useState(false);

  const total = useMemo(() => totalValueUsd(tokens), [tokens]);

  const activeChainIds = useMemo(
    () => [...new Set(tokens.map((item) => item.chainId))].sort((left, right) => left - right),
    [tokens],
  );

  const shownTokens = useMemo(() => tokens.filter((item) => network === "all" || item.chainId === network), [tokens, network]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 접근이 막혀도 화면을 깨뜨리지 않는다 — 주소는 칩에 그대로 보인다.
    }
  }

  return (
    <main className="min-h-dvh px-5 py-6">
      <header data-surface="wallet-portfolio-header">
        <button
          type="button"
          onClick={onOpenAccount}
          aria-label={`계정 열기 · ${address}`}
          className="flex items-center gap-2 rounded-full py-1 pr-2 text-left transition-colors hover:bg-zinc-100"
        >
          <WalletMark size={28} />
          <span className="font-semibold text-zinc-900">브라우저 지갑</span>
          <svg aria-hidden="true" className="text-zinc-500" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5">
            {/* 단일 체인 배지가 아니라 자산이 놓인 체인들을 겹쳐 보인다 — EVM 주소는 어느 한 체인의 것이 아니다. */}
            <span className="flex items-center" aria-label={`네트워크 ${chains.map((chain) => chain.chainName).join(", ")}`}>
              {chains.map((chain, index) => (
                <span key={chain.chainId} className={`inline-flex rounded-full ring-2 ring-zinc-100 ${index > 0 ? "-ml-1.5" : ""}`}>
                  <ChainIcon chainId={chain.chainId} size={16} />
                </span>
              ))}
            </span>
            <span className="font-mono text-sm text-zinc-700">{shortHash(address)}</span>
            <button
              type="button"
              onClick={copyAddress}
              aria-label="주소 복사"
              className="-mr-1 flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-200"
            >
              <svg aria-hidden="true" width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" strokeLinecap="round" />
              </svg>
            </button>
          </span>
          <span aria-live="polite" className="text-xs font-semibold text-emerald-600">
            {copied ? "복사됨" : ""}
          </span>
        </div>

        <p data-surface="wallet-total" className="mt-5 text-4xl font-bold tracking-tight text-zinc-900">
          {formatFiat(total, "USD")}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          온체인 잔액 × 현재 시세(USD) 기준입니다 — 세금 화면의 거래 시점 금액과는 다릅니다.
        </p>
        {/* 평가손익을 왜 안 그리는지 총액 바로 밑에서 말한다. 자리가 비어 있으면 "0"으로 읽힌다. */}
        <p data-surface="wallet-cost-basis-note" className="mt-1 text-xs text-zinc-400">
          평가손익은 취득원가가 있어야 계산됩니다 — 거래 이력의 원가와 연결되면 표시됩니다.
        </p>
      </header>

      <section className="mt-5">
        {/* 토큰 탭만 남긴다. NFT·디파이는 실데이터 경로가 아직 없어, 데모 상수를 실잔액 옆에 두면
            화면만 보고는 어느 쪽이 사실인지 구분할 수 없다. 경로가 생기면 탭으로 되돌린다. */}
        <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
          <h2 className="text-sm font-semibold text-zinc-900">토큰</h2>
          <span className="text-xs text-zinc-400">{tokens.length}종</span>
        </div>

        <div className="mt-3 flex items-center">
          <label className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600">
            <svg aria-hidden="true" width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 5h18M6 12h12M10 19h4" strokeLinecap="round" />
            </svg>
            <span className="sr-only">네트워크 필터</span>
            <select
              value={network}
              onChange={(event) => setNetwork(event.target.value === "all" ? "all" : Number(event.target.value))}
              className="bg-transparent pr-1 font-semibold text-zinc-700 focus:outline-none"
            >
              <option value="all">모든 네트워크</option>
              {activeChainIds.map((chain) => (
                <option key={chain} value={chain}>
                  {chainLabel(chain)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? (
          <p className="mt-6 text-center text-sm text-zinc-500">잔액을 불러오는 중입니다</p>
        ) : isError ? (
          <p role="alert" className="mt-6 rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            잔액을 불러오지 못했습니다.{" "}
            {onRetry ? <button type="button" className="font-semibold underline" onClick={onRetry}>다시 시도</button> : null}
          </p>
        ) : shownTokens.length === 0 ? (
          <p data-surface="wallet-portfolio-filter-empty" className="mt-6 text-center text-sm text-zinc-500">
            {tokens.length === 0 ? "보유한 토큰이 없습니다." : "선택한 조건에 해당하는 자산이 없습니다."}
          </p>
        ) : (
          <>
            {/* 필터가 없으면 이 카드는 위 총액과 같은 숫자다 — 같은 값을 두 번 크게 쓰지 않는다. */}
            {network === "all" ? null : <TokenHoldingsSummary holdings={shownTokens} chainId={network} />}
            <ul className="mt-1 divide-y divide-zinc-100">
              {shownTokens.map((holding) => (
                <TokenRow key={holding.key} holding={holding} />
              ))}
            </ul>
          </>
        )}

        {/* 접은 것과 못 읽은 것을 숫자로 말한다. 조용히 빼면 "내 토큰이 없어졌다"가 된다. */}
        {!isLoading && !isError && (unpricedCount > 0 || spamCount > 0 || skippedChainIds.length > 0 || truncatedChainIds.length > 0) ? (
          <p role="status" data-surface="wallet-holdings-notes" className="mt-3 border-l-2 border-zinc-200 pl-2 text-xs text-zinc-400">
            {[
              unpricedCount > 0 ? `시세를 확인하지 못한 ${unpricedCount}종은 목록에서 뺐습니다` : null,
              spamCount > 0 ? `에어드랍 스팸으로 판정한 ${spamCount}종을 숨겼습니다` : null,
              skippedChainIds.length > 0 ? `${skippedChainIds.map(chainLabel).join("·")} 잔액은 읽지 못했습니다` : null,
              truncatedChainIds.length > 0 ? `${truncatedChainIds.map(chainLabel).join("·")}은 토큰이 너무 많아 일부만 읽었습니다` : null,
            ].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </section>
    </main>
  );
}
