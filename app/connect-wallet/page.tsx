import { redirect } from "next/navigation";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { ConnectWalletFlow } from "@/components/wallet/connect-wallet-flow";
import { ExchangeConnectPanel } from "@/components/wallet/exchange-connect-panel";
import { OnboardingSteps } from "@/components/ui/onboarding-steps";

export default async function ConnectWalletPage() {
  if (await requireCompletedOnboarding()) redirect("/dashboard");
  const session = await requireDidSession();
  if (!session) redirect("/login");
  return (
    <main className="min-h-dvh px-5 py-8">
      <p className="text-sm font-semibold text-primary-500">지갑 연결</p>
      {/* 온보딩을 통과시키는 것은 여전히 지갑 서명이다. 제목이 거래소를 앞세우면
          "거래소만 연동해도 되는" 화면으로 읽힌다 — 거래소 연동은 아래에서 선택으로 말한다. */}
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900">지갑을 연결하세요</h1>
      <p className="mt-3 text-base leading-6 text-zinc-600">
        거래 내역을 불러오기 위해 지갑을 연결합니다. 거래소 계정 연동은 선택입니다. {session.countryCode ? `거주국 ${session.countryCode} 클레임이 확인된 상태입니다.` : ""}
      </p>
      <div className="mt-6">
        <OnboardingSteps current={2} />
      </div>
      <ConnectWalletFlow />
      <ExchangeConnectPanel />
    </main>
  );
}
