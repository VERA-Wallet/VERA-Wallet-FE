import { redirect } from "next/navigation";
import { getSessionCookieHeaderForEventReader, requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { warmUpBeEventSync } from "@/lib/adapters/http/event-repository.server";
import { ReportView } from "@/components/export/report-view";

/**
 * 신고 근거자료 보고서의 앱 화면. 내보내기 탭의 "보고서 보기"가 여기로 온다.
 *
 * 종이(PDF)는 이 화면 안의 "PDF로 저장"이 브라우저 인쇄로 만든다 — 앱 컬럼 밖으로 나가는 새 탭이 첫 답이 아니다.
 * 링크는 귀속연도(`year`)와 시행 가정(`assume=1`)을 실어 온다. 화면이 전역 선택을 잃었을 때(새로고침·직접 진입)의 기본값이다.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  const completed = await requireCompletedOnboarding();
  if (completed) {
    const params = (await searchParams) ?? {};
    const yearRaw = Array.isArray(params.year) ? params.year[0] : params.year;
    const taxYear = yearRaw !== undefined && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined;
    const assumeEffective = params.assume === "1";
    // 내보내기 화면과 같은 이유로 한 번 채운다 — 게이트가 아니므로 실패해도 렌더는 계속한다.
    const warmUp = await warmUpBeEventSync(await getSessionCookieHeaderForEventReader());
    if (warmUp.status === "failed") console.warn("BE 이벤트 warm-up이 실패했다.", warmUp);
    return <ReportView countryCode={completed.countryCode} taxYear={taxYear} assumeEffective={assumeEffective} />;
  }

  // 지갑 미연결(DID-only)에는 보고서로 만들 거래가 없다. 내보내기 빈 상태가 지갑 연결로 안내한다.
  const didSession = await requireDidSession();
  if (didSession) redirect("/export");
  redirect("/login");
}
