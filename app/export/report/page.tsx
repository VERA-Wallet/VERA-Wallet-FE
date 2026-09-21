import { ReportView } from "@/components/report/report-view";

/**
 * 신고 근거자료 보고서의 앱 화면. 리포트 메인의 "보고서 보기"가 여기로 온다.
 *
 * 종이(PDF)는 이 화면 안의 "PDF로 저장"이 브라우저 인쇄로 만든다. 앱 컬럼 밖으로 나가는 새 탭이 첫 답이 아니다.
 * 세션 가드와 estimate는 상위 `app/export/layout.tsx`가 한다. 리포트 메인에서 고른 귀속연도·시행 가정이
 * 그 프로바이더에 살아 있으므로, 링크에 값을 실어 나를 필요가 없다(Next: layouts do not rerender).
 */
export default function ExportReportPage() {
  return <ReportView />;
}
