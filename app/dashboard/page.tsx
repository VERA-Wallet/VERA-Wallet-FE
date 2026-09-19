import { redirect } from "next/navigation";
import { getSessionCookieHeaderForEventReader, requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { warmUpBeEventSync } from "@/lib/adapters/http/event-repository.server";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { apiProvenance } from "@/lib/api-mode";
import { ImportProgressGate } from "@/components/dashboard/import-progress-gate";

// searchParams를 optional로 두는 이유: Next는 항상 넘기지만, 가드 테스트는 이 함수를 인자 없이 부른다.
// required로 선언하면 라우팅 규칙만 보려는 테스트가 쿼리 스텁을 떠안는다.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  // 지갑 연결은 더 이상 온보딩 강제 단계가 아니다. DID 세션만 있으면 대시보드에 진입한다.
  const session = await requireDidSession();
  if (!session) redirect("/login");

  const completed = await requireCompletedOnboarding();
  if (completed) {
    // 불러오기 모달은 지갑 연결 직후 진입(`?importing=1`)에서만 뜬다. 진입 판정을 서버에서 하면
    // 클라이언트가 `useSearchParams`로 URL을 읽지 않아도 되고, 그 경우 필요한 Suspense 경계도 없어진다.
    const importing = (await searchParams)?.importing === "1";
    // BE의 list와 summary가 둘 다 listOrSync를 타므로, 클라이언트 훅이 병렬로 나가기 전에 한 번 채워
    // 첫 동기화 경합과 비멱등 앵커 재제출을 줄인다. 게이트가 아니므로 실패해도 렌더는 계속한다.
    const warmUp = await warmUpBeEventSync(await getSessionCookieHeaderForEventReader());
    if (warmUp.status === "failed") console.warn("BE 이벤트 warm-up이 실패했다.", warmUp);
    // 거주국은 DID 클레임에서 이미 확정됐다. 화면이 다시 묻지 않도록 서버에서 내려준다.
    return (
      <>
        {/* 모달이 대시보드 위에 뜨는 동안에도 본문은 정상 렌더된다 — 백그라운드로 보내면 곧바로 쓸 수 있어야 한다. */}
        {importing ? <ImportProgressGate walletAddress={completed.walletAddress} /> : null}
        <DashboardView countryCode={completed.countryCode} provenance={apiProvenance()} />
      </>
    );
  }

  // 지갑 미연결(DID-only): 데이터 훅을 붙이지 않는 껍데기 상태 + "데이터 불러오기" CTA.
  // 여기서 이벤트를 조회하면 bound-wallet 404가 나므로, 껍데기는 네트워크를 건드리지 않는다.
  return <DashboardEmptyState countryCode={session.countryCode} provenance={apiProvenance()} />;
}
