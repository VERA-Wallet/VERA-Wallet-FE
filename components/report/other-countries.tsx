import type { RuleSetSummary } from "@/lib/tax/types";

/**
 * "다른 나라였다면" — 룰셋 비교.
 *
 * 거주국 리포트가 답이고, 나라를 바꾸는 것은 비교다. 그래서 칩을 첫 화면에서 접어 둔다.
 * 고른 나라가 거주국이 아니면 위 금액 옆에 "비교 중"이라는 사실이 계속 붙고, 내려받기는 막힌다.
 */
export function OtherCountries({
  rulesets,
  country,
  onSelect,
  loading,
}: {
  rulesets: RuleSetSummary[];
  country: RuleSetSummary["code"];
  onSelect: (code: RuleSetSummary["code"]) => void;
  loading: boolean;
}) {
  return (
    <details className="mt-4 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="다른 나라 비교">
      <summary className="cursor-pointer font-bold text-zinc-900 marker:text-zinc-400">다른 나라였다면</summary>
      <p className="mt-2 text-sm leading-6 text-zinc-500">
        같은 원장에 다른 나라 룰셋을 적용해 봅니다. 신고 근거자료는 거주국 기준으로만 만듭니다.
      </p>
      <section className="mt-3" aria-label="국가 선택">
        {/* 12개 룰셋을 세로로 쌓으면 첫 화면이 칩으로 다 찬다 — 가로 스크롤 스트립으로 접는다. */}
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {rulesets.map((ruleset) => (
            <button
              key={ruleset.code}
              type="button"
              aria-pressed={ruleset.code === country}
              className={`shrink-0 snap-start whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${ruleset.code === country ? "border-primary-500 bg-primary-500 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}
              onClick={() => onSelect(ruleset.code)}
            >
              {ruleset.label}
              {ruleset.demoPriority ? <span className="ml-1 text-xs opacity-80">{ruleset.demoPriority}순위</span> : null}
            </button>
          ))}
        </div>
        {loading ? <p className="text-sm text-zinc-500">룰셋을 불러오는 중입니다</p> : null}
      </section>
    </details>
  );
}
