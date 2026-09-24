import Link from "next/link";
import { redirect } from "next/navigation";
import { summaryProvider } from "@/lib/composition-root.server";
import { getSessionCookieHeaderForEventReader, requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { warmUpBeEventSync } from "@/lib/adapters/http/event-repository.server";
import { isGroundedPeriod } from "@/lib/period";
import { taxYearFor } from "@/lib/tax/engine";
import { apiProvenance, isMockApiMode, reportAnchorGateEnabled } from "@/lib/api-mode";
import { ReportInputsProvider } from "@/components/report/report-context";

/**
 * 마지막 거래가 속한 과세연도.
 * 화면을 늘 "올해"로 열면 올해 거래가 없는 지갑은 진입하자마자 "계산할 거래 없음"만 본다.
 * 요약 기간이 신뢰할 수 없으면 지어내지 않고 `undefined`를 준다(화면은 올해로 연다).
 */
async function latestActivityTaxYear(countryCode: string): Promise<number | undefined> {
  // ON 모드에서는 대시보드와 같은 BE 이벤트를 봐야 한다. FE mock 요약을 쓰면 리포트만 다른 연도를 연다.
  if (!isMockApiMode()) {
    const { readBeWalletEvents } = await import("@/lib/adapters/http/event-repository.server");
    const { SessionInfrastructureError } = await import("@/lib/ports/session-reader");
    let events;
    try {
      events = await readBeWalletEvents(await getSessionCookieHeaderForEventReader());
    } catch (cause) {
      // 진입 연도는 편의값이다. BE 이벤트 조회가 타임아웃·네트워크로 실패했다고 화면 전체를 500으로 죽이지 않는다 —
      // 연도를 비우면 화면은 올해로 열리고, 계산 자체는 클라이언트가 다시 시도한다.
      if (cause instanceof SessionInfrastructureError) return undefined;
      throw cause;
    }
    // 문자열 비교는 offset이 섞인 RFC3339에서 순서를 틀린다. 시각으로 비교한다.
    const latest = events.reduce<string | null>((max, event) => (max === null || Date.parse(event.block_timestamp) > Date.parse(max) ? event.block_timestamp : max), null);
    // 인증은 됐는데 이벤트가 0건인 것은 정상 상태다(빈 지갑). 그때만 연도를 비운다.
    return latest === null ? undefined : taxYearFor(countryCode, latest);
  }

  const summary = await summaryProvider.getSummary();
  // period.to는 마지막 이벤트의 시각이다. 과세기간은 나라마다 다르므로 역년으로 자르지 않는다.
  return isGroundedPeriod(summary.period) ? taxYearFor(countryCode, summary.period.to) : undefined;
}

/**
 * 리포트 한 벌(`/export`, `/export/basis|issues|settings|compare`)의 공통 껍데기.
 *
 * **세션 가드가 여기 하나로 모인다.** 하위 경로로 바로 들어와도(북마크·주소 직접 입력) 그 요청의
 * 서버 렌더는 반드시 이 layout을 통과하므로, 페이지마다 가드를 복사하지 않아도 뚫리지 않는다.
 * 규칙은 옮기기 전(`app/export/page.tsx`)과 같다 — 익명은 `/login`, DID-only는 지갑 연결 안내를 보여 준다.
 *
 * **계산은 여기서 한 번만 만든다.** Next 문서가 "On navigation, layouts preserve state, remain
 * interactive, and do not rerender"(01-getting-started/03-layouts-and-pages.md)이고 "Layouts are
 * cached in the client during navigation"(03-api-reference/03-file-conventions/layout.md)이라고
 * 명시하므로, 다섯 화면을 오가도 `ReportInputsProvider`의 입력 상태와 estimate가 유지된다.
 * 설정 화면에서 넣은 연말 시가가 메인의 예상 부담에 그대로 반영되는 근거가 이것이다.
 */
export default async function ExportLayout({ children }: { children: React.ReactNode }) {
  const completed = await requireCompletedOnboarding();
  if (completed) {
    // BE의 list와 summary가 둘 다 listOrSync를 타므로, 클라이언트 훅이 병렬로 나가기 전에 한 번 채워
    // 첫 동기화 경합과 비멱등 앵커 재제출을 줄인다. 게이트가 아니므로 실패해도 렌더는 계속한다.
    const warmUp = await warmUpBeEventSync(await getSessionCookieHeaderForEventReader());
    if (warmUp.status === "failed") console.warn("BE 이벤트 warm-up이 실패했다.", warmUp);
    // 거주국은 DID 클레임에서 확정됐다 — 리포트가 귀속연도·룰셋을 서버에서 받아 estimate를 채운다.
    // 연도도 서버에서 내려준다. 클라이언트가 따로 시계를 읽으면
    // 연말 자정 경계에서 서버 HTML과 hydration 결과가 갈린다.
    return (
      <ReportInputsProvider
        countryCode={completed.countryCode}
        currentYear={new Date().getFullYear()}
        latestActivityYear={await latestActivityTaxYear(completed.countryCode)}
        provenance={await apiProvenance()}
        gateEnabled={reportAnchorGateEnabled()}
      >
        {children}
      </ReportInputsProvider>
    );
  }

  const didSession = await requireDidSession();
  if (didSession) {
    // No wallet means no report input. Never substitute a synthetic tax scenario.
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold">리포트</h1>
        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold">지갑을 연결해 주세요</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            연결된 암호화폐 지갑이 없어 예상 부담을 계산할 수 없습니다. 지갑을 연결하면 거래 내역으로 리포트를 만들 수 있습니다.
          </p>
          <Link href="/connect-wallet" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary-500 px-5 py-3 font-semibold text-white">
            지갑 연결하기
          </Link>
        </section>
      </main>
    );
  }
  redirect("/login");
}
