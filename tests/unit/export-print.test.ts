import { afterEach, describe, expect, it, vi } from "vitest";
import { printReportHtml } from "@/lib/export/print";

const DOC = `<!doctype html><html><head><title>보고서</title></head><body><p>본문 한 줄</p></body></html>`;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** 새 탭 대역. 실제 iframe 창을 빌려 document.write·이벤트·타이머가 진짜로 도는 문서를 준다. */
function fakeTab(): Window {
  const host = document.createElement("iframe");
  document.body.append(host);
  return host.contentWindow as Window;
}

describe("보고서 인쇄 경로", () => {
  it("새 탭이 열리면 그 문서에 보고서를 싣는다 — 탭은 인쇄 전에 눈으로 확인할 수 있다", () => {
    const tab = fakeTab();
    vi.spyOn(window, "open").mockReturnValue(tab);

    expect(printReportHtml(DOC)).toBe("window");
    expect(tab.document.title).toBe("보고서");
    expect(tab.document.body.textContent).toContain("본문 한 줄");
  });

  it("팝업이 막히면 숨은 iframe으로 물러난다 — 내보내기 자체가 실패하면 안 된다", () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    expect(printReportHtml(DOC)).toBe("frame");
    const frame = document.querySelector("iframe");
    // display:none이면 렌더하지 않는 브라우저가 있어 화면 밖으로 밀어낸다(빈 종이 방지).
    expect(frame?.style.position).toBe("fixed");
    expect(frame?.style.display).not.toBe("none");
    expect(frame?.contentDocument?.body.textContent).toContain("본문 한 줄");
  });

  it("window.open이 던져도 물러날 뿐 예외를 올리지 않는다", () => {
    vi.spyOn(window, "open").mockImplementation(() => { throw new Error("blocked"); });
    expect(printReportHtml(DOC)).toBe("frame");
  });
});
