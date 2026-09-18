import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChipScroller } from "@/components/ui/chip-scroller";

/**
 * 칩 스트립의 넘침 신호(화살표).
 * jsdom은 레이아웃을 하지 않으므로 넘침은 치수를 직접 꽂고, 스크롤은 scroll 이벤트로 흉내 낸다.
 * 페이드는 mask-image 인라인 스타일이라 jsdom이 보존하지 않을 수 있어 화살표로만 본다.
 */
function setOverflow(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
}

function arrows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>('button[aria-hidden="true"]')].map((b) => (b.className.includes("left-0") ? "left" : "right"));
}

function renderStrip() {
  const utils = render(
    <ChipScroller aria-label="연도 필터">
      <button type="button">전체 연도</button>
      <button type="button">2025년</button>
    </ChipScroller>,
  );
  return { ...utils, strip: screen.getByLabelText("연도 필터") };
}

describe("ChipScroller", () => {
  it("접근성 이름이 붙은 요소가 칩 버튼들을 직접 감싼다", () => {
    const { strip } = renderStrip();
    expect(strip.querySelectorAll(":scope > button")).toHaveLength(2);
  });

  it("넘치지 않으면 화살표를 띄우지 않는다", () => {
    const { container } = renderStrip();
    expect(arrows(container)).toEqual([]);
  });

  it("넘친 쪽에만 화살표를 띄운다", () => {
    const { container, strip } = renderStrip();
    setOverflow(strip, 600, 300);

    fireEvent.scroll(strip, { target: { scrollLeft: 0 } });
    expect(arrows(container)).toEqual(["right"]);

    fireEvent.scroll(strip, { target: { scrollLeft: 150 } });
    expect(arrows(container)).toEqual(["left", "right"]);

    fireEvent.scroll(strip, { target: { scrollLeft: 300 } });
    expect(arrows(container)).toEqual(["left"]);
  });

  it("화살표는 탭 순서에 들어가지 않고, 누르면 보이는 폭의 일부만큼 민다", () => {
    const { container, strip } = renderStrip();
    setOverflow(strip, 600, 300);
    const scrollBy = vi.fn();
    Object.defineProperty(strip, "scrollBy", { configurable: true, value: scrollBy });
    fireEvent.scroll(strip, { target: { scrollLeft: 0 } });

    const right = container.querySelector<HTMLButtonElement>('button[aria-hidden="true"]')!;
    expect(right.tabIndex).toBe(-1);
    fireEvent.click(right);
    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: "smooth" });
  });
});
