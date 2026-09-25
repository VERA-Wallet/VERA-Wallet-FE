import type { ReactNode } from "react";
import { Card } from "./card";

type SummaryCardProps = {
  label: string;
  /** 문자열이 보통이지만, 값을 아직 모르는 동안에는 스켈레톤 막대를 그대로 끼워 넣는다. */
  value: ReactNode;
  supportingText?: string;
  /**
   * 지금 이 순간에만 해당하는 한 줄(예: 불러오는 중이라 아직 반영 전). `supportingText`와 나누는 이유:
   * 보조 문구는 이 숫자가 **무엇인지** 말하는 상설 설명이고, 이 줄은 숫자가 곧 바뀐다는 **일시적 사정**이다.
   * 하나로 합치면 불러오기가 끝난 뒤에도 설명이 틀린 말을 남긴다.
   */
  note?: string;
};

export function SummaryCard({
  label,
  value,
  supportingText,
  note,
}: SummaryCardProps) {
  return (
    <Card>
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p data-layout-value="" className="mt-2 min-w-0 max-w-full wrap-anywhere text-3xl font-bold tracking-tight text-zinc-900">{value}</p>
      {supportingText ? (
        <p className="mt-2 text-sm text-zinc-500">{supportingText}</p>
      ) : null}
      {note ? <p className="mt-1 text-xs text-zinc-400">{note}</p> : null}
    </Card>
  );
}
