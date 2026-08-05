import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomSheet } from "@/components/ui/bottom-sheet";

describe("BottomSheet", () => {
  it("renders an open modal dialog and closes from the backdrop", () => {
    const onClose = vi.fn();

    render(
      <BottomSheet open onClose={onClose} title="거래 상세">
        <p>바텀시트 내용</p>
      </BottomSheet>,
    );

    expect(screen.getByRole("dialog", { name: "거래 상세" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByText("바텀시트 내용")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "바텀시트 닫기" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not render while closed", () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()}>
        <p>바텀시트 내용</p>
      </BottomSheet>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
