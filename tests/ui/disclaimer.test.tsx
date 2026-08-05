import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisclaimerFooter } from "@/components/ui/disclaimer-footer";

describe("disclaimer footer", () => {
  it("renders the approved disclaimer copy", () => {
    render(<DisclaimerFooter />);
    const footer = screen.getByTestId("disclaimer-footer");
    expect(footer).toHaveTextContent("세무 대리 또는 세무 상담을 제공하지 않습니다");
    expect(footer).toHaveTextContent("실제 신고는 세무 전문가의 검토를 거치시기 바랍니다");
  });

  it("stays pinned to the bottom of the viewport", () => {
    render(<DisclaimerFooter />);
    const footer = screen.getByTestId("disclaimer-footer");
    // 계획 §9: 스크롤과 무관하게 하단 고정 — sticky + bottom-0 유틸리티가 유지되어야 한다.
    expect(footer.className).toContain("sticky");
    expect(footer.className).toContain("bottom-0");
  });
});
