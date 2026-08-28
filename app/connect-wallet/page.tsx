import { redirect } from "next/navigation";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { ConnectWalletFlow } from "@/components/wallet/connect-wallet-flow";
import { ExchangeComingSoon } from "@/components/wallet/exchange-coming-soon";
import { OnboardingSteps } from "@/components/ui/onboarding-steps";

/**
 * 지갑 등록 화면. 두 진입이 같은 화면을 쓴다.
 *
 * - 온보딩(지갑 미등록): 첫 지갑을 붙이는 단계라 진행 표시를 두고, 끝나면 대시보드에서 불러오기를 보여준다.
 * - 지갑 추가(이미 등록됨): 로그인과 무관한 추가 등록이다. 두 등록 경로 모두 세션을 유지한 채 바인딩을
 *   하나 더 만들고 이미 등록한 지갑은 그대로 남는다. 그래서 완료 세션을 대시보드로 튕기지 않는다 —
 *   튕기면 지갑을 두 개 이상 등록할 길 자체가 사라진다.
 */
export default async function ConnectWalletPage() {
  const session = await requireDidSession();
  if (!session) redirect("/login");
  const completed = await requireCompletedOnboarding();
  const adding = completed !== null;
  return (
    <main className="min-h-dvh px-5 py-8">
      <p className="text-sm font-semibold text-primary-500">데이터 불러오기</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900">{adding ? "지갑을 추가하세요" : "지갑을 연결하세요"}</h1>
      <p className="mt-3 text-base leading-6 text-zinc-600">
        {adding
          ? "지갑을 하나 더 등록하면 그 거래도 함께 불러옵니다. 로그인은 유지되고 이미 등록한 지갑도 그대로 남습니다."
          : "지갑을 등록하면 온체인 거래 내역을 불러옵니다. 거래소 연동은 곧 지원됩니다."}{" "}
        {session.countryCode ? `거주국 ${session.countryCode} 클레임이 확인된 상태입니다.` : ""}
      </p>
      {adding ? null : (
        <div className="mt-6">
          <OnboardingSteps current={2} />
        </div>
      )}
      {/* 이미 등록된 주소를 넘겨 같은 지갑을 다시 등록하려는 시도를 화면에서 끊는다 — 서버는 upsert라 조용히 통과한다. */}
      <ConnectWalletFlow redirectTo={adding ? "/wallets?importing=1" : "/dashboard?importing=1"} boundAddress={completed?.walletAddress ?? null} />
      <ExchangeComingSoon />
    </main>
  );
}
