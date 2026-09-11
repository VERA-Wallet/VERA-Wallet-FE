import { redirect } from "next/navigation";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { ConnectWalletFlow } from "@/components/wallet/connect-wallet-flow";

/**
 * 지갑 등록 화면. 두 진입이 같은 화면을 쓴다.
 *
 * - 온보딩(지갑 미등록): 첫 지갑을 붙이는 단계라 끝나면 대시보드에서 불러오기를 보여준다.
 * - 지갑 추가(이미 등록됨): 로그인과 무관한 추가 등록이다. 두 등록 경로 모두 세션을 유지한 채 바인딩을
 *   하나 더 만들고 이미 등록한 지갑은 그대로 남는다. 그래서 완료 세션을 대시보드로 튕기지 않는다 —
 *   튕기면 지갑을 두 개 이상 등록할 길 자체가 사라진다.
 *
 * 헤더·진행 표시·거래소 안내는 단계마다 달라지므로 화면 전체를 `ConnectWalletFlow`가 그린다.
 */
export default async function ConnectWalletPage({ searchParams }: { searchParams?: Promise<{ [key: string]: string | string[] | undefined }> } = {}) {
  const session = await requireDidSession();
  if (!session) redirect("/login");
  const completed = await requireCompletedOnboarding();
  const adding = completed !== null;
  // 지갑 탭의 "지갑 불러오기" 시트가 방법을 미리 고르고 들어온다. 모르는 값이면 방법 선택 단계다.
  const method = (await searchParams)?.method;
  const initialStep = method === "browser" ? "siwe" : method === "address" ? "address" : "method";
  return (
    <ConnectWalletFlow
      mode={adding ? "add" : "onboarding"}
      initialStep={initialStep}
      // 닫기는 왔던 곳으로. 온보딩은 빈 대시보드(거기서 다시 "데이터 불러오기"로 돌아올 수 있다), 추가 등록은 지갑 탭.
      exitTo={adding ? "/wallets" : "/dashboard"}
      redirectTo={adding ? "/wallets?importing=1" : "/dashboard?importing=1"}
      // 이미 등록된 주소를 넘겨 같은 지갑을 다시 등록하려는 시도를 화면에서 끊는다 — 서버는 upsert라 조용히 통과한다.
      boundAddress={completed?.walletAddress ?? null}
      countryCode={session.countryCode ?? null}
    />
  );
}
