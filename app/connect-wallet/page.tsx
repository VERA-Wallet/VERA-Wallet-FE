import { redirect } from "next/navigation";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { ConnectWalletFlow } from "@/components/wallet/connect-wallet-flow";
import { OnboardingSteps } from "@/components/ui/onboarding-steps";

export default async function ConnectWalletPage() {
  if (await requireCompletedOnboarding()) redirect("/dashboard");
  const session = await requireDidSession();
  if (!session) redirect("/login");
  return (
    <main className="min-h-dvh px-5 py-8">
      <p className="text-sm font-semibold text-primary-500">지갑 연결</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900">지갑을 연결하세요</h1>
      <p className="mt-3 text-base leading-6 text-zinc-600">
        거래 내역을 불러오기 위해 연결할 지갑을 선택합니다. {session.countryCode ? `거주국 ${session.countryCode} 클레임이 확인된 상태입니다.` : ""}
      </p>
      <div className="mt-6">
        <OnboardingSteps current={2} />
      </div>
      <ConnectWalletFlow />
    </main>
  );
}
