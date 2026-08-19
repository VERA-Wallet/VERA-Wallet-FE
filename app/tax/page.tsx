import { redirect } from "next/navigation";
import { summaryProvider } from "@/lib/composition-root.server";
import { getSessionCookieHeaderForEventReader, requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { isGroundedPeriod } from "@/lib/period";
import { taxYearFor } from "@/lib/tax/engine";
import { isMockApiMode } from "@/lib/api-mode";
import { TaxSimulator } from "@/components/tax/tax-simulator";

/**
 * 마지막 거래가 속한 과세연도.
 * 화면을 늘 "올해"로 열면 올해 거래가 없는 지갑은 진입하자마자 12개 룰셋이 전부
 * "계산할 거래 없음"을 말한다 — 룰셋 비교가 성립하지 않는다.
 * 요약 기간이 신뢰할 수 없으면 지어내지 않고 `undefined`를 준다(화면은 올해로 연다).
 */
async function latestActivityTaxYear(countryCode: string): Promise<number | undefined> {
  // ON 모드에서는 대시보드와 같은 BE 이벤트를 봐야 한다. FE mock 요약을 쓰면 세금 화면만 다른 연도를 연다.
  if (!isMockApiMode()) {
    const { readBeWalletEvents } = await import("@/lib/adapters/http/event-repository.server");
    const events = await readBeWalletEvents(await getSessionCookieHeaderForEventReader());
    // 문자열 비교는 offset이 섞인 RFC3339에서 순서를 틀린다. 시각으로 비교한다.
    const latest = events.reduce<string | null>((max, event) => (max === null || Date.parse(event.block_timestamp) > Date.parse(max) ? event.block_timestamp : max), null);
    // 인증은 됐는데 이벤트가 0건인 것은 정상 상태다(빈 지갑). 그때만 연도를 비운다.
    return latest === null ? undefined : taxYearFor(countryCode, latest);
  }

  const summary = await summaryProvider.getSummary();
  // period.to는 마지막 이벤트의 시각이다. 과세기간은 나라마다 다르므로 역년으로 자르지 않는다.
  return isGroundedPeriod(summary.period) ? taxYearFor(countryCode, summary.period.to) : undefined;
}

export default async function TaxPage() {
  const completed = await requireCompletedOnboarding();
  // 거주국은 DID 클레임에서 확정됐다. 화면이 "어느 나라?"부터 묻지 않도록 서버에서 내려준다.
  // 연도도 서버에서 내려준다. 클라이언트가 따로 시계를 읽으면
  // 연말 자정 경계에서 서버 HTML과 hydration 결과가 갈린다.
  if (completed) {
    return (
      <TaxSimulator
        countryCode={completed.countryCode}
        currentYear={new Date().getFullYear()}
        latestActivityYear={await latestActivityTaxYear(completed.countryCode)}
      />
    );
  }

  // 지갑 미연결(DID-only)도 이 화면을 데모로 쓸 수 있다 — 데모 시나리오는 지갑 없이 성립한다.
  // latestActivityTaxYear는 지갑 이벤트를 조회하므로 여기서는 부르지 않는다. ON 모드에서
  // bound-wallet 404가 나므로, 대시보드 빈 상태와 같은 원칙으로 네트워크 자체를 건드리지 않는다.
  const didSession = await requireDidSession();
  if (didSession) {
    return (
      <TaxSimulator
        countryCode={didSession.countryCode}
        currentYear={new Date().getFullYear()}
        walletConnected={false}
      />
    );
  }
  redirect("/login");
}
