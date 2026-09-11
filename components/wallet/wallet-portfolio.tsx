"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { Provenance } from "@/lib/http/envelope";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { AssetLogo } from "@/components/ui/asset-logo";
import { ChainIcon } from "@/components/ui/chain-icon";
import Link from "next/link";
import { WalletMark } from "@/components/wallet/wallet-mark";
import { walletLabel } from "@/components/wallet/wallet-verification-badge";
import type { SessionWalletVerification } from "@/lib/ports/session-snapshot";
import { chainLabel, formatFiat, shortHash } from "@/lib/format";
import {
  compareDecimal,
  groupGainUsd,
  groupHoldings,
  holdingGainUsd,
  holdingsGainSummary,
  portfolioTotalUsd,
  returnPercent,
  unpricedCount,
  type DefiPosition,
  type Holding,
  type HoldingGroup,
  type NftHolding,
  type WalletChain,
} from "@/lib/wallet/holdings";

type Tab = "token" | "nft" | "defi";

const PALETTE = ["#4F46E5", "#0891B2", "#059669", "#D97706", "#DB2777", "#7C3AED", "#2563EB", "#DC2626"];

/** 조회가 불완전한 사실을 문장으로. 비어 있으면 "전부 읽었다"는 뜻이다. */
function coverageNotesOf(coverage: { skippedChainIds: number[]; truncatedChainIds: number[]; unresolvedCount: number; droppedCount: number } | undefined): string[] {
  if (!coverage) return [];
  const notes: string[] = [];
  if (coverage.skippedChainIds.length > 0) notes.push(`${coverage.skippedChainIds.map(chainLabel).join(", ")} 잔액을 읽지 못했습니다. 그 네트워크 자산은 표시되지 않습니다.`);
  if (coverage.truncatedChainIds.length > 0) notes.push(`${coverage.truncatedChainIds.map(chainLabel).join(", ")}의 토큰이 너무 많아 일부만 표시합니다.`);
  if (coverage.unresolvedCount > 0) notes.push(`토큰 ${coverage.unresolvedCount}개의 정보를 조회하지 못해 표시하지 않습니다.`);
  if (coverage.droppedCount > 0) notes.push(`형식이 맞지 않아 자산 ${coverage.droppedCount}개를 표시하지 못했습니다.`);
  return notes;
}

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

/** 시드에서 결정론적으로 고른 목록 구분색. 브랜드 색이라고 주장하지 않는다. */
function seededColor(seed: string, offset: number): string {
  let hash = offset;
  for (const character of seed) hash = (hash * 31 + character.codePointAt(0)!) % 997;
  return PALETTE[hash % PALETTE.length];
}

function initials(text: string): string {
  return text.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?";
}

const COST_STATUS_LABEL: Record<Holding["costStatus"], string> = {
  ready: "",
  partial: "원가 일부만 확인",
  unknown: "원가 미확인",
  fx_unavailable: "환율 조회 실패",
};

/**
 * 평가손익·수익률 한 조각. 상승은 브랜드 receive(녹색), 하락은 dispose(적색) 토큰을 쓰고,
 * 색만으로 구분하지 못하는 사용자를 위해 부호(`+`/`−`)를 늘 함께 둔다. 손익은 원장 취득원가로
 * 계산한 **표시 산술**이다(세무 엔진이 아니다). 시세나 원가가 없으면 숫자 대신 이유를 쓴다 — 0으로 그리지 않는다.
 */
function GainInline({ gainUsd, costUsd, reason }: { gainUsd: string | null; costUsd: string | null; reason?: string }): React.JSX.Element {
  if (gainUsd === null || costUsd === null) return <span className="text-zinc-400">{reason || "손익 미확인"}</span>;
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
        <p className="mt-0.5 text-xs font-medium">
          <GainInline
            gainUsd={holdingGainUsd(holding)}
            costUsd={holding.costUsd}
            reason={holding.valueUsd === null ? "시세 미확인" : COST_STATUS_LABEL[holding.costStatus] || undefined}
          />
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-zinc-400">
          {holding.amount} {holding.symbol}
        </p>
      </div>
    </li>
  );
}

/**
 * 같은 정식 자산의 체인별 행을 합친 묶음 행. 멤버가 하나면 `TokenRow`와 같다.
 * 로고는 첫 멤버(평가액 최대)로 그리고, 체인 배지는 멤버 체인 전부를 겹쳐 보인다. 누르면 체인별 내역이 펼쳐진다.
 * 손익은 멤버 전부 시세가 있고 원가가 ready일 때만 — 한 체인이라도 부족하면 이유를 쓴다.
 */
function GroupRow({ group }: { group: HoldingGroup }) {
  const [open, setOpen] = useState(false);
  if (group.members.length === 1) return <TokenRow holding={group.members[0]} />;
  const first = group.members[0];
  const gain = groupGainUsd(group);
  const reason = group.valueUsd === null
    ? "시세 미확인"
    : group.unpricedCount > 0
      ? `${group.unpricedCount}개 체인 시세 미확인`
      : COST_STATUS_LABEL[group.costStatus] || undefined;
  return (
    <li data-surface="holding-group" data-chains={group.chainIds.join(",")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${group.symbol} 체인별 보기`}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <span className="relative inline-flex shrink-0" aria-hidden="true">
          <AssetLogo
            event={{ chain_id: first.chainId, asset_type: first.contract === null ? "NATIVE" : "ERC20", asset_contract: first.contract, asset_symbol: first.symbol, asset_icon_url: null, token_id: null }}
            size={40}
          />
          <span className="absolute -bottom-1 -right-1 flex rounded-full bg-white ring-2 ring-white">
            {group.chainIds.slice(0, 3).map((chainId, index) => (
              <span key={chainId} className={`inline-flex rounded-full ring-2 ring-white ${index > 0 ? "-ml-1.5" : ""}`}>
                <ChainIcon chainId={chainId} size={16} />
              </span>
            ))}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate font-semibold text-zinc-900">
            {group.symbol}
            <span className="ml-1.5 text-xs font-medium text-zinc-400">{group.chainIds.length}개 체인</span>
          </p>
          <p className="mt-0.5 truncate text-sm text-zinc-500">{formatFiat(group.priceUsd, "USD")}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-zinc-900">{formatFiat(group.valueUsd, "USD")}</p>
          <p className="mt-0.5 text-xs font-medium">
            <GainInline gainUsd={gain} costUsd={group.costUsd} reason={reason} />
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-zinc-400">
            {group.amount} {group.symbol}
          </p>
        </div>
        <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <ul data-surface="holding-group-members" className="mb-2 ml-[52px] divide-y divide-zinc-100 rounded-xl bg-zinc-50 px-3">
          {group.members.map((member) => (
            <li key={member.key} data-surface="holding-group-member" className="flex items-center gap-2 py-2 text-sm">
              <ChainIcon chainId={member.chainId} size={16} />
              <span className="min-w-0 flex-1 truncate text-zinc-700">{member.chainName}</span>
              <span className="text-right">
                <span className="block tabular-nums font-semibold text-zinc-900">{formatFiat(member.valueUsd, "USD")}</span>
                <span className="block text-xs tabular-nums text-zinc-400">{member.amount} {member.symbol}</span>
                {member.costStatus !== "ready" ? <span className="block text-xs text-zinc-400">{COST_STATUS_LABEL[member.costStatus]}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * 토큰 탭 상단 요약. 보이는 토큰들의 전체 평가액·평가손익·수익률을 한눈에 보인다.
 * NFT·디파이는 취득원가가 없어 이 요약은 **토큰 보유분**만 집계한다 —
 * 상단 큰 총액(portfolioTotalUsd)과 뜻이 갈리지 않도록 무엇을 집계했는지 라벨로 밝힌다.
 * 시세·원가가 없는 행은 손익에서 빠지고, 몇 건이 빠졌는지 함께 말한다.
 */
function TokenHoldingsSummary({ holdings }: { holdings: Holding[] }): React.JSX.Element {
  const summary = holdingsGainSummary(holdings);
  return (
    <div data-surface="wallet-holdings-summary" className="mt-3 rounded-card border border-zinc-100 p-4 shadow-card">
      <p className="text-xs text-zinc-500">보유 토큰 평가액</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900">{formatFiat(summary.valueUsd, "USD")}</p>
      <p className="mt-1 text-sm font-semibold">
        <span className="text-zinc-500">평가손익 </span>
        <GainInline gainUsd={summary.gainUsd} costUsd={summary.costUsd} reason="원가 확인된 자산 없음" />
        {summary.excluded > 0 && summary.gainUsd !== null ? <span className="font-normal text-zinc-400"> · {summary.excluded}개 제외</span> : null}
      </p>
    </div>
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
 * - 토큰·NFT(대중 컬렉션)·디파이 포지션을 각각 탭으로 보여준다.
 * - 토큰은 `/api/portfolio/holdings`에서 온다. 출처가 mock이면 "데모 예시"라고 말하고, live면 조회 시각과
 *   시세 출처를 말한다. NFT·디파이는 아직 데모 예시다(화면에 명시). 로고/아트워크는 기억으로
 *   그리지 않는다(토큰은 공개 벡터, NFT/프로토콜은 생성 플레이스홀더).
 * - 매수·스왑·전송·받기 액션과 광고 배너는 두지 않는다. 네트워크 배지는 자산 이미지 우하단에 얹는다.
 * - 각 탭은 평가액 내림차순으로 정렬된 상태로 들어온다.
 */
export function WalletPortfolio({
  address,
  chains,
  tokens,
  nfts,
  defi,
  provenance,
  asOf,
  coverage,
  freshness,
  verification = null,
}: {
  address: string;
  /** 자산이 있는 체인들(보유 자산 파생). 주소 칩이 "이 지갑이 걸쳐 있는 네트워크"를 이 목록으로 말한다. */
  chains: WalletChain[];
  tokens: Holding[];
  nfts: NftHolding[];
  defi: DefiPosition[];
  /** 토큰 보유분의 출처. mock이면 데모 예시라고 말한다. */
  provenance: Provenance;
  /** 토큰 조회 시각(ISO). live일 때 "언제 기준"인지 말한다. */
  asOf: string | null;
  /** 조회가 불완전하다는 사실들 — 화면이 "전부 보여준다"고 단정하지 않게 한다. */
  coverage?: { skippedChainIds: number[]; truncatedChainIds: number[]; unresolvedCount: number; droppedCount: number };
  /** 데이터가 있는 채로 다시 조회 중이거나 배경 재조회가 실패했을 때. 이전 값을 "지금 것"처럼 단정하지 않게 알린다. */
  freshness?: "refreshing" | "stale";
  /** 등록 방식. 이름("등록한 주소"/"브라우저 지갑")만 정한다 — 배지는 두지 않는다. */
  verification?: SessionWalletVerification | string | null;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("token");
  const [network, setNetwork] = useState<number | "all">("all");
  const [copied, setCopied] = useState(false);

  // live면 NFT·디파이는 아직 조회하지 않으므로(빈 목록으로 들어온다) 총액은 토큰뿐이다. mock이면 데모 지갑 전체를 더한다.
  const total = useMemo(() => portfolioTotalUsd(tokens, nfts, defi), [tokens, nfts, defi]);
  const unpriced = useMemo(() => unpricedCount(tokens), [tokens]);
  const coverageNotes = useMemo(() => coverageNotesOf(coverage), [coverage]);
  const nftDefiSupported = provenance === "mock";

  const activeChainIds = useMemo(() => {
    const source = tab === "nft" ? nfts : tab === "defi" ? defi : tokens;
    return [...new Set(source.map((item) => item.chainId))].sort((left, right) => left - right);
  }, [tab, tokens, nfts, defi]);

  const shownTokens = useMemo(() => tokens.filter((item) => network === "all" || item.chainId === network), [tokens, network]);
  // 모든 네트워크를 볼 때만 같은 자산을 체인 너머로 합친다. 네트워크를 고르면 그 체인의 행 그대로다.
  const shownGroups = useMemo(() => (network === "all" ? groupHoldings(shownTokens) : shownTokens.map((holding) => groupHoldings([holding])[0])), [shownTokens, network]);
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
        <div className="-ml-2 flex items-center gap-2">
          <Link
            href="/wallets"
            aria-label="지갑 목록으로"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-200"
          >
            <svg aria-hidden="true" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <WalletMark size={28} />
          <span className="font-semibold text-zinc-900">{walletLabel(verification)}</span>
        </div>

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
        {provenance === "mock" ? (
          <p className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
            <MockProvenanceChip />
            <span>데모 예시 데이터(USD) 기준입니다 — 실시간 시세·잔액이 아닙니다.</span>
          </p>
        ) : (
          <p data-surface="wallet-total-note" className="mt-1 text-xs text-zinc-400">
            토큰 평가액 — 온체인 잔액과 DexScreener 시세{asOf ? ` (${formatAsOf(asOf)} 기준)` : ""}. 취득원가는 오늘 환율로 USD 환산. NFT·디파이는 아직 조회하지 않습니다.
            {unpriced > 0 ? ` 시세 없는 자산 ${unpriced}개는 총액에서 뺐습니다.` : ""}
          </p>
        )}
        {freshness === "refreshing" ? (
          <p data-surface="wallet-freshness" aria-live="polite" className="mt-1 text-xs text-zinc-500">보유 자산을 다시 확인하는 중입니다.</p>
        ) : freshness === "stale" ? (
          <p data-surface="wallet-freshness" aria-live="polite" className="mt-1 text-xs text-amber-700">최근 조회에 실패해 이전 결과를 보여주고 있습니다.</p>
        ) : null}
        {coverageNotes.length > 0 ? (
          <ul data-surface="wallet-coverage" className="mt-2 space-y-0.5 text-xs text-amber-700">
            {coverageNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
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

        {tab !== "token" && !nftDefiSupported ? (
          // 실지갑에서는 아직 NFT·디파이를 조회하지 않는다. "없다"고 하면 거짓이므로 "아직 안 본다"고 말한다.
          <p data-surface="wallet-portfolio-unsupported" className="mt-6 text-center text-sm text-zinc-500">
            {tab === "nft" ? "NFT 보유 조회는 준비 중입니다." : "디파이 포지션 조회는 준비 중입니다."}
          </p>
        ) : shownCount === 0 ? (
          <p data-surface="wallet-portfolio-filter-empty" className="mt-6 text-center text-sm text-zinc-500">
            {tab === "nft"
              ? "보유한 NFT가 없습니다."
              : tab === "defi"
                ? "디파이 포지션이 없습니다."
                : tokens.length === 0
                  ? "이 지갑에서 잔액이 있는 토큰을 찾지 못했습니다."
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
          <>
            <TokenHoldingsSummary holdings={shownTokens} />
            <ul className="mt-1 divide-y divide-zinc-100">
              {shownGroups.map((group) => (
                <GroupRow key={group.key} group={group} />
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
