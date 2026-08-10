import { redirect } from "next/navigation";
import { getSessionCookieHeaderForEventReader, requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { warmUpBeEventSync } from "@/lib/adapters/http/event-repository.server";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export default async function DashboardPage() {
  const session = await requireCompletedOnboarding();
  if (session) {
    // BE의 list와 summary가 둘 다 listOrSync를 타므로, 클라이언트 훅이 병렬로 나가기 전에 한 번 채워
    // 첫 동기화 경합과 비멱등 앵커 재제출을 줄인다. 게이트가 아니므로 실패해도 렌더는 계속한다.
    const warmUp = await warmUpBeEventSync(await getSessionCookieHeaderForEventReader());
    if (warmUp.status === "failed") console.warn("BE 이벤트 warm-up이 실패했다.", warmUp);
    // 거주국은 DID 클레임에서 이미 확정됐다. 화면이 다시 묻지 않도록 서버에서 내려준다.
    return <DashboardView countryCode={session.countryCode} />;
  }
  redirect(await requireDidSession() ? "/connect-wallet" : "/login");
}
