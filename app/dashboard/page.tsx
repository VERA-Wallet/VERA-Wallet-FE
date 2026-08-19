import { redirect } from "next/navigation";
import { getSessionCookieHeaderForEventReader, requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { warmUpBeEventSync } from "@/lib/adapters/http/event-repository.server";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";

export default async function DashboardPage() {
  // 지갑 연결은 더 이상 온보딩 강제 단계가 아니다. DID 세션만 있으면 대시보드에 진입한다.
  const session = await requireDidSession();
  if (!session) redirect("/login");

  const completed = await requireCompletedOnboarding();
  if (completed) {
    // BE의 list와 summary가 둘 다 listOrSync를 타므로, 클라이언트 훅이 병렬로 나가기 전에 한 번 채워
    // 첫 동기화 경합과 비멱등 앵커 재제출을 줄인다. 게이트가 아니므로 실패해도 렌더는 계속한다.
    const warmUp = await warmUpBeEventSync(await getSessionCookieHeaderForEventReader());
    if (warmUp.status === "failed") console.warn("BE 이벤트 warm-up이 실패했다.", warmUp);
    // 거주국은 DID 클레임에서 이미 확정됐다. 화면이 다시 묻지 않도록 서버에서 내려준다.
    return <DashboardView countryCode={completed.countryCode} />;
  }

  // 지갑 미연결(DID-only): 데이터 훅을 붙이지 않는 껍데기 상태 + "데이터 불러오기" CTA.
  // 여기서 이벤트를 조회하면 bound-wallet 404가 나므로, 껍데기는 네트워크를 건드리지 않는다.
  return <DashboardEmptyState countryCode={session.countryCode} />;
}
