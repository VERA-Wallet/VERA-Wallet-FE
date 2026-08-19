import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ChainIcon } from "@/components/ui/chain-icon";
import { ExchangeComingSoon } from "@/components/wallet/exchange-coming-soon";
import { chainLabel, shortHash } from "@/lib/format";

/**
 * 브라우저 지갑 표식.
 *
 * `ChainIcon`·`ExchangeMark`와 같은 규칙이다 — 특정 지갑(메타마스크 등) 로고를 흉내 내지 않는다.
 * 이 화면은 어떤 지갑 앱으로 연결했는지 모르므로(주소만 안다) 중립 표식 하나로 "브라우저 지갑"이라는
 * 연결 방식만 나타낸다.
 */
function WalletMark() {
  return (
    <svg aria-hidden="true" className="shrink-0" width={32} height={32} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="10" fill="#3F3F46" />
      <path
        d="M9 12a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="20.5" cy="18" r="1.2" fill="#fff" />
    </svg>
  );
}

export function WalletsView({ walletAddress, chainId }: { walletAddress: string | null; chainId: number | null }) {
  return (
    <main className="min-h-dvh px-5 py-8">
      <header data-surface="wallets-summary">
        <p className="text-sm font-semibold text-primary-500">데이터 소스</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">연결된 지갑·거래소</h1>
        <p className="mt-1 text-sm text-zinc-500">여기 있는 소스의 거래만 목록과 계산에 들어갑니다.</p>
      </header>

      <section className="mt-6">
        {walletAddress && chainId !== null ? (
          <Card data-surface="wallet-connected">
            <div className="flex items-center gap-3">
              <WalletMark />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-zinc-900">브라우저 지갑</p>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">연결됨</span>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-zinc-600">{shortHash(walletAddress)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
                  <ChainIcon chainId={chainId} />
                  {chainLabel(chainId)}
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <Card data-surface="wallet-empty">
            <p className="font-semibold text-zinc-900">아직 연결된 지갑이 없습니다</p>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              지갑을 연결하면 온체인 거래 내역을 불러와 목록과 계산에 반영합니다.
            </p>
            <Link
              href="/connect-wallet"
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-primary-500 py-3.5 font-semibold text-white"
            >
              지갑 연결하기
            </Link>
          </Card>
        )}

        {/* 여러 지갑 합산은 아직 없다. 재동기화·해제처럼 동작 없는 버튼을 두지 않는 것과 같은 이유로,
            연결 폼도 두지 않고 "곧 지원"만 정직하게 말한다. */}
        <Card data-surface="wallet-add-more" className="mt-4 opacity-60">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-zinc-900">지갑 추가 연결</p>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-500">곧 지원</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            여러 지갑을 한 계산에 합치는 기능은 준비 중입니다 — 지금은 지갑 1개가 연결됩니다.
          </p>
        </Card>
      </section>

      <section className="mt-6">
        <ExchangeComingSoon />
      </section>
    </main>
  );
}
