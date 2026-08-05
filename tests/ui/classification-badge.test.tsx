import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ClassificationBadge,
  type Classification,
} from "@/components/ui/classification-badge";

const cases: Array<[Classification, string, string]> = [
  ["RECEIVE", "수신", "bg-green-100"],
  ["SEND", "송금", "bg-red-100"],
  ["EXCHANGE", "교환", "bg-orange-100"],
  ["INTERNAL_TRANSFER", "내부 이동", "bg-blue-100"],
  ["UNKNOWN", "미분류", "bg-zinc-100"],
];

describe("ClassificationBadge", () => {
  it.each(cases)("renders %s with its Korean label and color", (classification, label, colorClass) => {
    render(<ClassificationBadge classification={classification} />);

    expect(screen.getByText(label)).toHaveClass(colorClass);
  });
});
