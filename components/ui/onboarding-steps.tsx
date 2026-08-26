import { Check } from "lucide-react";

const STEPS = ["거주국 인증", "지갑 연결"] as const;

export function OnboardingSteps({ current }: { current: 1 | 2 }) {
  return (
    <ol aria-label="온보딩 진행 단계" className="flex items-center gap-2 text-xs font-semibold">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={active ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                active ? "bg-primary-500 text-white" : done ? "bg-primary-100 text-primary-700" : "bg-zinc-100 text-zinc-400"
              }`}
            >
              {done ? <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={3} /> : null}
              {/* 번호는 순서 의무를 암시하는데 지갑 연결은 선택 단계다 */}
              {label === "지갑 연결" && !active && !done ? `${label} — 나중에 가능` : label}
            </span>
            {step < STEPS.length ? <span aria-hidden="true" className="h-px w-3 bg-zinc-300" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
