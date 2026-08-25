"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { AssetMark } from "@/components/ui/asset-mark";
import { ChainIcon } from "@/components/ui/chain-icon";
import { TokenIcon, hasTokenMark } from "@/components/ui/token-icon";
import { WalletMark } from "@/components/wallet/wallet-mark";
import { chainLabel, formatFiat, shortHash } from "@/lib/format";
import { portfolioTotalUsd, type DefiPosition, type Holding, type NftHolding } from "@/lib/wallet/holdings";

type Tab = "token" | "nft" | "defi";

const PALETTE = ["#4F46E5", "#0891B2", "#059669", "#D97706", "#DB2777", "#7C3AED", "#2563EB", "#DC2626"];

/** 시드에서 결정론적으로 고른 목록 구분색. 브랜드 색이라고 주장하지 않는다. */
function seededColor(seed: string, offset: number): string {
  let hash = offset;
  for (const character of seed) hash = (hash * 31 + character.codePointAt(0)!) % 997;
  return PALETTE[hash % PALETTE.length];
}

function initials(text: string): string {
  return text.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?";
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
      {hasTokenMark(holding.symbol) ? (
        <TokenIcon symbol={holding.symbol} size={40} />
      ) : (
        <AssetMark
          event={{ asset_symbol: holding.symbol, asset_icon_url: null, token_id: null, asset_type: "ERC20" }}
          size={40}
        />
      )}
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
        <p className="mt-0.5 text-xs tabular-nums text-zinc-400">
          {holding.amount} {holding.symbol}
        </p>
      </div>
    </li>
  );
}

/** NFT 썸네일. 아트워크를 흉내 내지 않고, 컬렉션에서 결정론적으로 만든 그라디언트 + 모노그램 플레이스홀더다. */
function NftThumb({ nft }: { nft: NftHolding }) {
  const from = seededColor(nft.shortName, 0);
  const to = seededColor(nft.shortName, 7);
  return (
    <div
      aria-hidden="true"
      className="flex aspect-square w-full items-center justify-center rounded-xl text-lg font-bold text-white"
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {initials(nft.shortName)}
    </div>
  );
}

function NftCard({ nft }: { nft: NftHolding }) {
  return (
    <li data-surface="nft-card" className="rounded-card border border-zinc-100 p-2 shadow-card">
      <div className="relative">
        <NftThumb nft={nft} />
        <span className="absolute bottom-1.5 right-1.5 rounded-full bg-white ring-2 ring-white">
          <ChainIcon chainId={nft.chainId} size={16} />
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-zinc-900">
        {nft.shortName} <span className="font-normal text-zinc-400">#{nft.tokenId}</span>
      </p>
      <p className="truncate text-xs text-zinc-500">{nft.collection}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-zinc-900">
        {formatFiat(nft.floorUsd, "USD")} <span className="text-xs font-normal text-zinc-400">바닥가</span>
      </p>
    </li>
  );
}

function ProtocolMark({ protocol }: { protocol: string }) {
  return (
    <svg aria-hidden="true" className="shrink-0" width={40} height={40} viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="20" fill={seededColor(protocol, 3)} />
      <text x="20" y="25.5" textAnchor="middle" fontSize="14" fontWeight="700" fill="#ffffff">
        {initials(protocol).slice(0, 2)}
      </text>
    </svg>
  );
}

function DefiRow({ position }: { position: DefiPosition }) {
  const meta = [position.kindLabel, position.asset, position.apy ? `APY ${position.apy}` : null].filter(Boolean).join(" · ");
  return (
    <li data-surface="defi-row" className="flex items-center gap-3 py-3">
      <BadgedAvatar chainId={position.chainId} ariaLabel={`${position.protocol} · ${position.chainName}`}>
        <ProtocolMark protocol={position.protocol} />
      </BadgedAvatar>
      <div className="min-w-0 flex-1">
        <p className="min-w-0 truncate font-semibold text-zinc-900">{position.protocol}</p>
        <p className="mt-0.5 truncate text-sm text-zinc-500">{meta}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums text-zinc-900">{formatFiat(position.valueUsd, "USD")}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{position.chainName}</p>
      </div>
    </li>
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
  chainId,
  tokens,
  nfts,
  defi,
  onOpenAccount,
}: {
  address: string;
  chainId: number;
  tokens: Holding[];
  nfts: NftHolding[];
  defi: DefiPosition[];
  onOpenAccount: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("token");
  const [network, setNetwork] = useState<number | "all">("all");
  const [copied, setCopied] = useState(false);

  const total = useMemo(() => portfolioTotalUsd(tokens, nfts, defi), [tokens, nfts, defi]);

  const activeChainIds = useMemo(() => {
    const source = tab === "nft" ? nfts : tab === "defi" ? defi : tokens;
    return [...new Set(source.map((item) => item.chainId))].sort((left, right) => left - right);
  }, [tab, tokens, nfts, defi]);

  const shownTokens = useMemo(() => tokens.filter((item) => network === "all" || item.chainId === network), [tokens, network]);
  const shownNfts = useMemo(() => nfts.filter((item) => network === "all" || item.chainId === network), [nfts, network]);
  const shownDefi = useMemo(() => defi.filter((item) => network === "all" || item.chainId === network), [defi, network]);

  function selectTab(next: Tab) {
    setTab(next);
    setNetwork("all"); // 탭마다 네트워크 구성이 달라 선택을 초기화한다.
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 접근이 막혀도 화면을 깨뜨리지 않는다 — 주소는 칩에 그대로 보인다.
    }
  }

  const shownCount = tab === "nft" ? shownNfts.length : tab === "defi" ? shownDefi.length : shownTokens.length;

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
            <ChainIcon chainId={chainId} size={16} />
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
          데모 예시 데이터(USD) 기준입니다 — 실시간 시세·잔액이 아닙니다.
        </p>
      </header>

      <section className="mt-5">
        <div role="tablist" aria-label="자산 종류" className="flex gap-4 border-b border-zinc-200">
          {([
            ["token", "토큰"],
            ["nft", "NFT"],
            ["defi", "디파이"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => selectTab(value)}
              className={`-mb-px border-b-2 pb-2 text-sm font-semibold transition-colors ${
                tab === value ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400"
              }`}
            >
              {label}
            </button>
          ))}
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

        {shownCount === 0 ? (
          <p data-surface="wallet-portfolio-filter-empty" className="mt-6 text-center text-sm text-zinc-500">
            {tab === "nft"
              ? "보유한 NFT가 없습니다."
              : tab === "defi"
                ? "디파이 포지션이 없습니다."
                : "선택한 조건에 해당하는 자산이 없습니다."}
          </p>
        ) : tab === "nft" ? (
          <ul className="mt-3 grid grid-cols-2 gap-3">
            {shownNfts.map((nft) => (
              <NftCard key={nft.key} nft={nft} />
            ))}
          </ul>
        ) : tab === "defi" ? (
          <ul className="mt-1 divide-y divide-zinc-100">
            {shownDefi.map((position) => (
              <DefiRow key={position.key} position={position} />
            ))}
          </ul>
        ) : (
          <ul className="mt-1 divide-y divide-zinc-100">
            {shownTokens.map((holding) => (
              <TokenRow key={holding.key} holding={holding} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
