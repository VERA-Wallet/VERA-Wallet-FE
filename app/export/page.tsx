import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCookieHeaderForEventReader, requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { warmUpBeEventSync } from "@/lib/adapters/http/event-repository.server";
import { ExportView } from "@/components/export/export-view";
import { apiProvenance } from "@/lib/api-mode";

export default async function ExportPage() {
  const completed = await requireCompletedOnboarding();
  if (completed) {
    // BE의 list와 summary가 둘 다 listOrSync를 타므로, 클라이언트 훅이 병렬로 나가기 전에 한 번 채워
    // 첫 동기화 경합과 비멱등 앵커 재제출을 줄인다. 게이트가 아니므로 실패해도 렌더는 계속한다.
    const warmUp = await warmUpBeEventSync(await getSessionCookieHeaderForEventReader());
    if (warmUp.status === "failed") console.warn("BE 이벤트 warm-up이 실패했다.", warmUp);
    // 거주국은 DID 클레임에서 확정됐다 — 리포트가 귀속연도·룰셋을 서버에서 받아 estimate를 채운다.
    return <ExportView countryCode={completed.countryCode} provenance={await apiProvenance()} />;
  }

  const didSession = await requireDidSession();
  if (didSession) {
    // 지갑 미연결(DID-only)에는 내보낼 거래가 없다. ExportView는 데이터 훅이 bound-wallet 404를
    // 내므로 렌더하지 않고, 지갑 연결로 보내는 빈 상태만 보인다.
    return (
      <main className="min-h-dvh px-5 py-8">
        <p className="text-sm font-semibold text-primary-500">내보내기</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900">내보낼 거래가 아직 없습니다</h1>
        <p className="mt-3 text-base leading-6 text-zinc-600">지갑을 연결하면 거래 명세 파일을 만들 수 있습니다.</p>
        <Link
          href="/connect-wallet"
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-primary-500 py-3.5 font-semibold text-white"
        >
          지갑 연결하기
        </Link>
      </main>
    );
  }
  redirect("/login");
}
