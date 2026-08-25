import { Card } from "@/components/ui/card";
import { ChainIcon } from "@/components/ui/chain-icon";
import { WalletMark } from "@/components/wallet/wallet-mark";
import { chainLabel, shortHash } from "@/lib/format";

/**
 * "계정" 화면. 포트폴리오 상단 주소를 누르면 열린다.
 *
 * 지금 연결된 지갑을 활성 계정으로 보여주고, 다른 지갑을 연결하는 통로를 둔다.
 *
 * 세션에는 지갑 하나만 바인딩되고, WalletSessionWatcher는 연결 뒤 계정·체인이 바뀌면
 * 보안상 세션을 종료한다. 따라서 "다른 지갑 연결"은 현재 세션을 명시적으로 종료하고
 * 로그인부터 다시 인증하는 정직한 핸드오프다 — 가짜 다중 계정 목록을 만들거나 워처를 우회하지 않는다.
 */
export function AccountView({
  address,
  chainId,
  onBack,
  onConnectOther,
  switching = false,
  error = null,
}: {
  address: string;
  chainId: number;
  onBack: () => void;
  onConnectOther: () => void;
  switching?: boolean;
  error?: string | null;
}): React.JSX.Element {
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
              <p className="font-semibold text-zinc-900">브라우저 지갑</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                <svg aria-hidden="true" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                연결됨
              </span>
            </div>
            <p className="mt-1 break-all font-mono text-xs text-zinc-600">{shortHash(address)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
              <ChainIcon chainId={chainId} size={14} />
              {chainLabel(chainId)}
            </p>
          </div>
        </Card>
      </section>

      <section data-surface="account-connect" className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-500">다른 지갑 연결</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          다른 지갑을 연결하려면 현재 세션을 종료하고 다시 인증합니다 — 보안을 위해 한 세션에는 지갑 하나만 연결됩니다.
        </p>
        <button
          type="button"
          onClick={onConnectOther}
          disabled={switching}
          className="mt-4 w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white disabled:opacity-50"
        >
          {switching ? "세션 종료 중…" : "다른 지갑 연결하기"}
        </button>
        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
