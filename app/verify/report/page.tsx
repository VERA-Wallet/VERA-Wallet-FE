import type { Metadata } from "next";

import { ReportVerifyView } from "@/components/report-vc/report-verify-view";

export const metadata: Metadata = {
  title: "리포트 증명서 검증 · VeraWallet",
  description: "제출된 추정 세금 리포트 증명서를 검증합니다.",
};

/**
 * 제3자 검증 페이지. 서비스 로그인 없이 연다.
 *
 * 세션 가드(`lib/dal.ts`)를 부르지 않는다. 검증 시도의 접근 통제는 BE가 발급하는 브라우저 바인딩 쿠키
 * (`vw_vc_verify_attempt`)가 맡고, 프록시는 `/api/report-vc/verifications/*`만 그 쿠키와 함께 BE로 넘긴다.
 * 이 페이지에서 로그인 세션을 만들거나 바꾸지 않는다.
 */
export default function VerifyReportPage() {
  return <ReportVerifyView />;
}
