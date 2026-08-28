import { Card } from "@/components/ui/card";
import { ChainIcon } from "@/components/ui/chain-icon";
import { WalletMark } from "@/components/wallet/wallet-mark";
import { shortHash } from "@/lib/format";
import type { SessionWalletVerification } from "@/lib/ports/session-snapshot";
import type { WalletChain } from "@/lib/wallet/holdings";

/**
 * "계정" 화면. 포트폴리오 상단 주소를 누르면 열린다.
 *
 * 지금 보고 있는 지갑을 활성 계정으로 보여주고, 지갑을 하나 더 등록하는 통로를 둔다.
 *
 * 신원은 DID 세션이 쥐고 지갑은 그 아래 등록되는 별도 바인딩이다. 그래서 지갑 추가는
 * 로그인을 건드리지 않는다 — 세션은 그대로 살아 있고 이미 등록한 지갑도 지워지지 않는다.
 * 다만 세션 계약이 아직 최신 지갑 하나만 내려주므로, 여기서 여러 개를 나열하는 척하지 않는다.
 *
 * 배지는 등록 방법을 그대로 옮긴다. 주소만 받은 지갑에 소유가 확인된 것처럼 도장을 찍으면
 * 사용자는 증빙이 되는 줄 알고 그 자료를 쓰게 된다.
 */
export function AccountView({
  address,
  chains,
  onBack,
  onAddWallet,
  walletVerification = null,
}: {
  address: string;
  /** 자산이 실제로 놓여 있는 체인들. 세션의 사실이 아니라 보유 자산에서 파생한다 — EVM 주소는 체인 불문 동일하다. */
  chains: WalletChain[];
  onBack: () => void;
  onAddWallet: () => void;
  walletVerification?: SessionWalletVerification;
}): React.JSX.Element {
  // 모를 때는 "연결됨"에 머문다 — 등록 방법을 세션이 알려주지 않았다는 이유로 증명된 척하지 않는다.
  const badge = walletVerification === "watch_only"
    ? { label: "미검증", className: "bg-amber-100 text-amber-700" }
    : walletVerification === "siwe"
      ? { label: "소유 증명됨", className: "bg-emerald-100 text-emerald-700" }
      : { label: "연결됨", className: "bg-emerald-100 text-emerald-700" };
  return (
    <main data-surface="account-view" className="min-h-dvh px-5 py-8">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="뒤로"
          className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-200"
        >
          <svg aria-hidden="true" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-zinc-900">계정</h1>
      </div>

      <section className="mt-6">
        <Card data-surface="account-active" className="flex items-center gap-3">
          <WalletMark />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {/* 주소만 받은 지갑은 브라우저에 꽂혀 있지 않다 — 출처를 그대로 말한다. */}
              <p className="font-semibold text-zinc-900">{walletVerification === "watch_only" ? "등록한 주소" : "브라우저 지갑"}</p>
              <span data-surface="account-verification" className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
                {/* 체크 표시는 확인됐다는 뜻이다. 미검증에 붙이면 아이콘이 문구를 뒤집는다. */}
                {walletVerification === "watch_only" ? null : (
                  <svg aria-hidden="true" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {badge.label}
              </span>
            </div>
            <p className="mt-1 break-all font-mono text-xs text-zinc-600">{shortHash(address)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-zinc-500">
              {/* 하나의 "지갑 체인"이 아니라 자산이 있는 체인 전부를 말한다. */}
              {chains.map((chain) => (
                <span key={chain.chainId} className="inline-flex items-center gap-1">
                  <ChainIcon chainId={chain.chainId} size={14} />
                  {chain.chainName}
                </span>
              ))}
            </p>
          </div>
        </Card>
      </section>

      <section data-surface="account-connect" className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-500">지갑 추가</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          지갑을 하나 더 등록합니다. 로그인은 유지되고 이미 등록한 지갑도 그대로 남으며, 등록한 지갑들의 거래는 함께 합산됩니다.
        </p>
        <button
          type="button"
          onClick={onAddWallet}
          className="mt-4 w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white"
        >
          지갑 추가하기
        </button>
      </section>
    </main>
  );
}
