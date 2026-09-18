import type { RuleSetSummary } from "@/lib/tax/types";

/**
 * "다른 나라였다면" — 룰셋 비교.
 *
 * 거주국 리포트가 답이고, 나라를 바꾸는 것은 비교다. 그래서 첫 화면(메인)에는 두지 않고
 * 이 화면으로 따로 뺐다 — 페이지가 곧 그 주제이므로 여기서는 접지 않는다.
 * 고른 나라가 거주국이 아니면 메인 금액 옆에 "비교 중"이라는 사실이 계속 붙고, 내려받기는 막힌다.
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
    <section className="mt-6 rounded-card border border-zinc-200 bg-white p-4 shadow-card" aria-label="다른 나라 비교">
      <p className="text-sm leading-6 text-zinc-500">
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
    </section>
  );
}
