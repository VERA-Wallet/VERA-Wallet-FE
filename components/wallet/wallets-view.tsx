import Link from "next/link";
import type { SessionWalletVerification } from "@/lib/ports/session-snapshot";
import { Card } from "@/components/ui/card";
import { ExchangeComingSoon } from "@/components/wallet/exchange-coming-soon";
import { WalletsList } from "@/components/wallet/wallets-list";

/**
 * 지갑 탭.
 *
 * - 지갑이 연결돼 있으면 등록한 지갑 목록(`WalletsList`)을 보여준다. 행을 누르면 `/wallets/[address]` 포트폴리오다:
 *   상단에 지갑 주소, 아래에 거래 내역에서 파생한 보유 자산 목록. 주소를 누르면 "계정" 화면이 열린다.
 * - 미연결(DID-only)이면 연결된 지갑이 없다는 사실과 기존 지갑 연결 안내를 그대로 유지한다.
 *   지갑 바인딩은 세션이 단일 진실이므로 주소는 서버(세션)에서 내려준 값을 쓴다.
 *   체인은 세션의 사실이 아니다 — EVM 주소는 체인 불문 동일하므로 보유 자산에서 파생한다.
 */
export function WalletsView({
  walletAddress,
}: {
  walletAddress: string | null;
  /** 이제 목록이 등록 방식을 직접 읽는다. 호출부 호환을 위해 남겨 둔다. */
  walletVerification?: SessionWalletVerification;
}) {
  // 세션이 지갑을 하나라도 알면 목록을 그린다. 지갑이 하나뿐이어도 목록을 거친다 — 상세는 /wallets/[address]다.
  if (walletAddress) return <WalletsList />;

  return (
    <main className="min-h-dvh px-5 py-8">
      <header data-surface="wallets-summary">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">지갑·거래소 연결</h1>
        <p className="mt-1 text-sm text-zinc-500">여기 있는 소스의 거래만 목록과 계산에 들어갑니다.</p>
      </header>

      <section className="mt-6">
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
      </section>

      <section className="mt-6">
        <ExchangeComingSoon />
      </section>
    </main>
  );
}
