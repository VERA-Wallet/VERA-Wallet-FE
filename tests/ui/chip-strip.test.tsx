import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChipStrip } from "@/components/ui/chip-strip";

/**
 * 칩 스트립의 넘침 신호.
 * jsdom은 레이아웃을 하지 않으므로 넘침은 치수를 직접 꽂고, 스크롤은 scroll 이벤트로 흉내 낸다.
 */
function setOverflow(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
}

function edge(container: HTMLElement, which: "start" | "end") {
  return container.querySelector(`[data-edge="${which}"]`)?.getAttribute("data-visible");
}

describe("ChipStrip", () => {
  it("접근성 이름이 붙은 요소가 칩 버튼들을 직접 감싼다", () => {
    render(
      <ChipStrip label="연도 필터">
        <button type="button">전체 연도</button>
        <button type="button">2025년</button>
      </ChipStrip>,
    );
    const strip = screen.getByLabelText("연도 필터");
    expect(strip.querySelectorAll(":scope > button")).toHaveLength(2);
  });

  it("넘치지 않으면 양끝 페이드를 켜지 않는다", () => {
    const { container } = render(
      <ChipStrip label="연도 필터">
        <button type="button">전체 연도</button>
      </ChipStrip>,
    );
    expect(edge(container, "start")).toBe("false");
    expect(edge(container, "end")).toBe("false");
  });

  it("넘친 쪽 가장자리에만 페이드를 켠다", () => {
    const { container } = render(
      <ChipStrip label="연도 필터">
        <button type="button">전체 연도</button>
      </ChipStrip>,
    );
    const strip = screen.getByLabelText("연도 필터");
    setOverflow(strip, 600, 300);

    fireEvent.scroll(strip, { target: { scrollLeft: 0 } });
    expect(edge(container, "start")).toBe("false");
    expect(edge(container, "end")).toBe("true");

    fireEvent.scroll(strip, { target: { scrollLeft: 150 } });
    expect(edge(container, "start")).toBe("true");
    expect(edge(container, "end")).toBe("true");

    fireEvent.scroll(strip, { target: { scrollLeft: 300 } });
    expect(edge(container, "start")).toBe("true");
    expect(edge(container, "end")).toBe("false");
  });
});
