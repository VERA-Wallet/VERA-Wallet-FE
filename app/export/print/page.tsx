import { redirect } from "next/navigation";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { PrintReport } from "@/components/export/print-report";

/**
 * 인쇄용 신고근거 보고서. `/export`의 버튼이 새 창으로 연다.
 *
 * 귀속연도·시행가정을 쿼리로 받는 이유: 과세연도 선택은 메모리 컨텍스트(TaxYearProvider)라
 * 새 창이 물려받지 못한다. 주소에 실어야 "화면에서 보던 그 해"가 인쇄된다.
 * 값이 없거나 이상하면 올해로 물러난다 — 보고서 머리글에 그 해가 찍히므로 조용히 틀릴 일은 없다.
 */
export default async function ExportPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const completed = await requireCompletedOnboarding();
  if (!completed) {
    // 지갑을 연결하지 않았으면 인쇄할 근거가 없다. 빈 보고서를 그리는 대신 내보내기 화면으로 돌린다.
    if (await requireDidSession()) redirect("/export");
    redirect("/login");
  }

  const params = await searchParams;
  const rawYear = Array.isArray(params.year) ? params.year[0] : params.year;
  const parsedYear = Number(rawYear);
  const taxYear = Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : new Date().getFullYear();
  const assume = Array.isArray(params.assume) ? params.assume[0] : params.assume;

  return <PrintReport countryCode={completed.countryCode} taxYear={taxYear} assumeEffective={assume === "1"} />;
}
