import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExchangeLinkSummary } from "@/components/dashboard/exchange-link-summary";
import { EXCHANGE_LINKS_STORAGE_KEY } from "@/lib/exchange/mock-links";
import { memoryStorage } from "@/tests/fixtures/memory-storage";

function storageWith(ids: string[]): Storage {
  return memoryStorage({
    [EXCHANGE_LINKS_STORAGE_KEY]: JSON.stringify(
      ids.map((exchangeId) => ({
        exchangeId,
        credentialLabel: "ABCD••••1234",
        connectedAt: "2026-08-01T00:00:00.000Z",
        scope: "read-only",
      })),
    ),
  });
}

describe("dashboard exchange link summary", () => {
  it("renders nothing when no exchange is linked", () => {
    const { container } = render(<ExchangeLinkSummary storage={memoryStorage()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists linked exchanges as read-only and says the list below is unchanged", () => {
    render(<ExchangeLinkSummary storage={storageWith(["upbit", "coinbase"])} />);
    expect(screen.getByText("거래소 연동 2곳")).toBeVisible();
    expect(screen.getByRole("region", { name: "연동된 거래소" })).toBeVisible();
    expect(screen.getAllByText("조회 전용")).toHaveLength(2);
    // 배지만 띄우고 목록이 그대로면 화면이 "가져왔다"고 거짓말한다.
    expect(screen.getByText(/거래소 거래가 아직 들어오지 않습니다/)).toBeVisible();
  });

  it("ignores links whose exchange the catalog dropped", () => {
    render(<ExchangeLinkSummary storage={storageWith(["upbit", "retired-exchange"])} />);
    expect(screen.getByText("거래소 연동 1곳")).toBeVisible();
  });
});
