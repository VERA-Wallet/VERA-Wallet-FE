import { Card } from "./card";

type SummaryCardProps = {
  label: string;
  value: string;
  supportingText?: string;
};

export function SummaryCard({
  label,
  value,
  supportingText,
}: SummaryCardProps) {
  return (
    <Card>
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">{value}</p>
      {supportingText ? (
        <p className="mt-2 text-sm text-zinc-500">{supportingText}</p>
      ) : null}
    </Card>
  );
}
