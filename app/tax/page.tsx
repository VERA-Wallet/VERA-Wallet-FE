import { redirect } from "next/navigation";
import { summaryProvider } from "@/lib/composition-root.server";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { isGroundedPeriod } from "@/lib/period";
import { taxYearFor } from "@/lib/tax/engine";
import { TaxSimulator } from "@/components/tax/tax-simulator";

/**
 * 마지막 거래가 속한 과세연도.
 * 화면을 늘 "올해"로 열면 올해 거래가 없는 지갑은 진입하자마자 12개 룰셋이 전부
 * "계산할 거래 없음"을 말한다 — 룰셋 비교가 성립하지 않는다.
 * 요약 기간이 신뢰할 수 없거나 조회에 실패하면 지어내지 않고 `undefined`를 준다(화면은 올해로 연다).
 */
async function latestActivityTaxYear(countryCode: string): Promise<number | undefined> {
  try {
    const summary = await summaryProvider.getSummary();
    // period.to는 마지막 이벤트의 시각이다. 과세기간은 나라마다 다르므로 역년으로 자르지 않는다.
    return isGroundedPeriod(summary.period) ? taxYearFor(countryCode, summary.period.to) : undefined;
  } catch {
    return undefined;
  }
}

export default async function TaxPage() {
  const session = await requireCompletedOnboarding();
  // 거주국은 DID 클레임에서 확정됐다. 화면이 "어느 나라?"부터 묻지 않도록 서버에서 내려준다.
  // 연도도 서버에서 내려준다. 클라이언트가 따로 시계를 읽으면
  // 연말 자정 경계에서 서버 HTML과 hydration 결과가 갈린다.
  if (session) {
    return (
      <TaxSimulator
        countryCode={session.countryCode}
        currentYear={new Date().getFullYear()}
        latestActivityYear={await latestActivityTaxYear(session.countryCode)}
      />
    );
  }
  redirect(await requireDidSession() ? "/connect-wallet" : "/login");
}
