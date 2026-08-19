import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExchangeMark } from "@/components/ui/exchange-mark";
import { EXCHANGES, exchangeById } from "@/lib/exchange/mock-links";

function markOf(exchangeId: string) {
  const exchange = exchangeById(exchangeId)!;
  const { container } = render(<ExchangeMark exchange={exchange} />);
  return container.querySelector(`[data-exchange-mark="${exchangeId}"]`)!;
}

describe("거래소 표식", () => {
  it("카탈로그의 모든 거래소가 빈 배지로 남지 않는다", () => {
    // 색 사각형만 남으면 목록에서 어느 줄이 어느 거래소인지 배지가 전혀 거들지 못한다.
    for (const exchange of EXCHANGES) {
      const mark = markOf(exchange.id);
      const hasGlyph = mark.querySelectorAll("path").length > 0;
      const hasInitials = (mark.querySelector("text")?.textContent ?? "") !== "";
      expect(hasGlyph || hasInitials, exchange.id).toBe(true);
    }
  });

  it("공식 마크를 그린 거래소는 이니셜을 겹쳐 쓰지 않는다", () => {
    // 로고 위에 글자가 겹치면 둘 다 못 읽는다. 이니셜은 마크가 없을 때만 나서는 대역이다.
    for (const exchange of EXCHANGES) {
      const mark = markOf(exchange.id);
      if (mark.querySelectorAll("path").length === 0) continue;
      expect(mark.querySelector("text"), exchange.id).toBeNull();
    }
  });

  it("마크를 모르는 거래소는 브랜드를 지어내지 않고 이니셜로 물러선다", () => {
    // 코인원은 공식 마크 벡터를 아직 들여오지 않았다. 로고를 넣는 순간 이 테스트가 먼저 깨져야 한다.
    const coinone = markOf("coinone");
    expect(coinone.querySelectorAll("path")).toHaveLength(0);
    expect(coinone.querySelector("text")?.textContent).toBe("CO");
  });

  it("스크린리더에서 숨긴다 — 거래소 이름은 옆의 글자가 말한다", () => {
    // 마크가 이름을 대신하면 색맹·저해상도·마크 없는 거래소에서 정보가 사라진다.
    expect(markOf("upbit").getAttribute("aria-hidden")).toBe("true");
  });
});
