import { redirect } from "next/navigation";
import { requireDidSession } from "@/lib/dal";
import { DidLoginFlow } from "@/components/did/did-login-flow";
import { OnboardingSteps } from "@/components/ui/onboarding-steps";

export default async function LoginPage() {
  // 이미 인증된 세션이면 로그인 단계를 건너뛴다 — 새로고침·재방문마다 다시 로그인하지 않도록.
  // 세션 판정이 인프라 오류로 실패하면 로그인 화면을 그대로 보여준다(로그인 진입을 막지 않는다).
  let authenticated = false;
  try {
    authenticated = Boolean(await requireDidSession());
  } catch {
    authenticated = false;
  }
  if (authenticated) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh flex-col justify-between px-5 py-8">
      <div className="pt-10">
        <p className="text-sm font-semibold text-primary-500">VeraWallet</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900">DID로 안전하게 로그인하세요</h1>
        <p className="mt-4 text-base leading-6 text-zinc-600">거주국 인증 후 지갑을 연결합니다.</p>
        <div className="mt-6">
          <OnboardingSteps current={1} />
        </div>
      </div>
      <DidLoginFlow />
    </main>
  );
}
