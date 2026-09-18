import { redirect } from "next/navigation";
import { getSessionCookieHeaderForEventReader, requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { warmUpBeEventSync } from "@/lib/adapters/http/event-repository.server";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";

// searchParams를 optional로 두는 이유: Next는 항상 넘기지만, 가드 테스트는 이 함수를 인자 없이 부른다.
// required로 선언하면 라우팅 규칙만 보려는 테스트가 쿼리 스텁을 떠안는다(app/dashboard/page.tsx와 같은 규칙).
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  // 가드는 요약 화면과 같다 — 거래 목록도 DID 세션만 있으면 들어온다.
  const session = await requireDidSession();
  if (!session) redirect("/login");

  const completed = await requireCompletedOnboarding();
  if (completed) {
    // `?tab=review`는 **서버에서** 읽는다. 클라이언트가 `useSearchParams`로 URL을 읽으면
    // 그에 필요한 Suspense 경계가 따라오는데, 여기서 필요한 건 첫 탭 하나뿐이다
    // (대시보드의 `importing` 처리와 같은 이유).
    const query = await searchParams;
    const initialTab = query?.tab === "review" ? "review" : "all";
    // `?spam=1`은 설정의 "스팸 거래 보기"가 타고 온다 — 라벨이 말한 목록에 바로 도착해야 한다.
    const initialSpam = query?.spam === "1";
    // BE의 list와 summary가 둘 다 listOrSync를 타므로, 클라이언트 훅이 병렬로 나가기 전에 한 번 채워
    // 첫 동기화 경합과 비멱등 앵커 재제출을 줄인다. 게이트가 아니므로 실패해도 렌더는 계속한다.
    const warmUp = await warmUpBeEventSync(await getSessionCookieHeaderForEventReader());
    if (warmUp.status === "failed") console.warn("BE 이벤트 warm-up이 실패했다.", warmUp);
    // 거주국은 DID 클레임에서 이미 확정됐다. 화면이 다시 묻지 않도록 서버에서 내려준다.
    return <TransactionsView countryCode={completed.countryCode} initialTab={initialTab} initialSpam={initialSpam} />;
  }

  // 지갑 미연결(DID-only): 데이터 훅을 붙이지 않는 껍데기 상태 + "데이터 불러오기" CTA.
  // 여기서 이벤트를 조회하면 bound-wallet 404가 나므로, 껍데기는 네트워크를 건드리지 않는다.
  return <DashboardEmptyState countryCode={session.countryCode} />;
}
