import { ReportMain } from "@/components/report/report-main";

/**
 * 리포트 메인 — 세금 보고서와 내보내기.
 *
 * 세션 가드와 진입 귀속연도 파생은 `app/export/layout.tsx`로 올라갔다. 하위 화면
 * (`/export/basis` 등)도 같은 가드를 통과해야 하는데, 페이지마다 복사하면 규칙이 갈린다.
 */
export default function ExportPage() {
  return <ReportMain />;
}
