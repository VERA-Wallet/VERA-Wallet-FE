import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummaryCard } from "@/components/ui/summary-card";

describe("SummaryCard", () => {
  it("renders its label, value, and supporting text", () => {
    render(
      <SummaryCard
        label="예상 손익"
        supportingText="최근 30일 기준"
        value="₩1,250,000"
      />,
    );

    expect(screen.getByText("예상 손익")).toBeInTheDocument();
    expect(screen.getByText("₩1,250,000")).toBeInTheDocument();
    expect(screen.getByText("최근 30일 기준")).toBeInTheDocument();
  });
});
