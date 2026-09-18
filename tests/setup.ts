import "@testing-library/jest-dom/vitest";

// jsdom에 없는 브라우저 API를 채운다. 프로덕션 코드에서 `typeof x === "undefined"` 가드로 우회하면
// 실제 브라우저에는 없는 분기가 코드에 남고, 그 분기는 테스트에서만 밟힌다 — 없는 쪽은 환경이므로 환경에서 메운다.

// ResizeObserver: 칩 스트립(ChipScroller)이 창 폭 변화로 넘침 여부를 다시 재는 데 쓴다.
// jsdom은 레이아웃을 계산하지 않으므로 콜백을 부를 일도 없다 — 인터페이스만 만족시키면 된다.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// matchMedia: prefers-reduced-motion 질의에 쓴다. jsdom 기본값은 "선호 없음"이 맞다.
if (typeof window !== "undefined" && typeof window.matchMedia === "undefined") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
