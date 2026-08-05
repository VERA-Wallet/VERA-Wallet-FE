import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExportView } from "@/components/export/export-view";
import { vi } from "vitest";

const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn() }));
vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
}));

describe("빈 지갑 내보내기", () => {
  it("기간이 없으면 빈 범위를 그대로 보이지 않는다", async () => {
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getProof.mockResolvedValue(null);
    ports.getSummary.mockResolvedValue({
      periodPnl: "0", computableEventCount: 0, taxableEventCount: 0, pendingReviewCount: 0,
      currency: "KRW", period: { from: "", to: "" },
    });
    render(<ExportView />);
    expect(await screen.findByText(/기간 미정/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/^\s*~\s/m);

    // 파일명에도 빈 기간을 그대로 쓰면 `verawallet-명세-_.csv`가 된다.
    const clicked: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    URL.createObjectURL = () => "blob:stub";
    URL.revokeObjectURL = () => {};
    try {
      fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
      await waitFor(() => expect(clicked.length).toBeGreaterThan(0));
      expect(clicked[0]).toContain("기간미정");
      expect(clicked[0]).not.toMatch(/-_\./);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });
});
