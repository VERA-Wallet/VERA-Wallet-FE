import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { apiProvenance, reportAnchorGateEnabled } from "@/lib/api-mode";
import { ReportInputsProvider } from "@/components/report/report-context";

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
    // The browser reuses the shared ledger cache to choose the activity year.
    // Do not block navigation on a second server-side copy of the entire ledger.
    return (
      <ReportInputsProvider
        countryCode={completed.countryCode}
        currentYear={new Date().getFullYear()}
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
