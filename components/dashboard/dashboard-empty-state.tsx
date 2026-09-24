import { SettingsLink } from "@/components/ui/settings-link";
import Link from "next/link";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import type { Provenance } from "@/lib/http/envelope";
import { SummaryCard } from "@/components/ui/summary-card";
import { getRuleSet } from "@/lib/tax/rulesets";

/**
 * 지갑 미연결(DID-only) 대시보드의 껍데기 상태.
 *
 * 온보딩에서 지갑 연결을 더 이상 강제하지 않으므로, 로그인 직후 사용자는 데이터가 없는 대시보드를 먼저 본다.
 * 빈 화면 대신 실제 대시보드와 같은 chrome(헤더·요약 카드 레이아웃)을 유지해 "무엇이 채워질 자리"인지 보이고,
 * 데이터를 불러오는 단 하나의 행동(지갑 연결)으로 유도한다. 데이터 훅은 호출하지 않는다 —
 * 지갑이 없으면 /api/events가 bound-wallet 404를 주므로, 껍데기는 네트워크를 건드리지 않는다.
 */
export function DashboardEmptyState({ countryCode, provenance = "mock" }: { countryCode?: string; provenance?: Provenance }) {
  return (
    <main className="min-h-dvh px-5 py-8">
      <header data-surface="dashboard-summary" className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">요약</h1>
          {/* "클레임"은 내부 인증 용어다. 사용자에게는 자신이 고른 거주 국가만 말하면 된다 —
              증명 방식(DID·클레임)을 설명할 자리가 아니다. 코드가 룰셋에 없으면(알 수 없는 국가)
              지어낸 이름 대신 코드를 그대로 보인다. */}
          <p className="mt-1 text-sm text-zinc-500">
            {countryCode ? `거주 국가: ${getRuleSet(countryCode)?.label ?? countryCode}` : "거주 국가를 확인하지 못했습니다."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ProvenanceChip provenance={provenance} />
          <SettingsLink />
        </div>
      </header>

      {/* 데이터를 불러오는 단일 행동. 지갑 연결 페이지로 이동한다. */}
      <section
        data-surface="dashboard-empty-cta"
        className="mt-6 rounded-card bg-primary-50 p-6 text-center shadow-card ring-1 ring-primary-100"
      >
        <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary-600">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-bold text-zinc-900">아직 불러온 거래가 없습니다</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          지갑을 연결하면 거래 내역을 불러와 요약·판정·리포트를 사용할 수 있습니다.
        </p>
        <Link
          href="/connect-wallet"
          className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-primary-500 py-3.5 font-semibold text-white"
        >
          지갑 연결하기
        </Link>
        {/* 보조 CTA — 주 CTA(채움)보다 시각적 우선순위가 낮은 외곽선 스타일. */}
        <Link
          href="/export"
          className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-primary-500 py-3.5 font-semibold text-primary-600"
        >
          데모 데이터로 둘러보기
        </Link>
        <p className="mt-2 text-xs text-zinc-400">리포트의 데모 계산은 지갑 없이도 쓸 수 있습니다.</p>
      </section>

      {/* 채워질 자리를 보여주는 플레이스홀더. 값은 대시보드 빈 상태와 같은 "-".
          `grid-cols-1`을 명시한다 — 암묵 열이 가장 넓은 행의 min-content로 늘어나면
          448px 껍데기를 밀어낸다(거래 탭 목록과 같은 이유, transactions-view.tsx 주석 참고). */}
      <section className="mt-6 grid grid-cols-1 gap-3" aria-hidden="true">
        <SummaryCard label="예상 손익" value="-" supportingText="지갑을 연결하면 계산됩니다." />
        <SummaryCard label="계산 대상 이벤트" value="-" supportingText="지갑을 연결하면 채워집니다." />
      </section>

      <section className="mt-8">
        <div className="rounded-card border border-dashed border-zinc-200 px-4 py-10 text-center">
          <p className="text-sm text-zinc-400">지갑을 연결하면 거래가 여기에 표시됩니다.</p>
        </div>
      </section>
    </main>
  );
}
