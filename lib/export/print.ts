import "client-only";

/**
 * 보고서 HTML을 브라우저 인쇄로 넘긴다 — "PDF로 저장"이 곧 내보내기다.
 *
 * PDF를 직접 쓰지 않는 이유는 한글이다. 브라우저 밖에서 한글 PDF를 만들려면 글꼴을 통째로 내장해야 하고
 * (Noto Sans KR 하나가 수 MB), 그 대가로 표 조판·줄바꿈·쪽 나눔을 전부 손으로 짜야 한다.
 * 인쇄 경로는 시스템 한글 글꼴을 그대로 쓰고 조판을 CSS에 맡기므로 새 의존성이 0이다.
 *
 * 새 탭을 먼저 시도한다. 탭은 인쇄 전에 **보고서를 눈으로 확인**할 수 있고, 대화상자를 닫아도 다시 인쇄할 수
 * 있으며, iOS Safari에서도 동작한다(iframe 인쇄는 상위 문서를 인쇄해 버린다). 팝업이 막힌 경우에만
 * 숨은 iframe으로 물러난다 — 그때도 내보내기 자체는 실패하지 않아야 한다.
 */

/** 대화상자가 뜨기 전에 조판이 끝나도록 주는 여유. load 이벤트를 놓친 브라우저의 보험이기도 하다. */
const LAYOUT_SETTLE_MS = 400;
/** afterprint를 내지 않는 브라우저에서 숨은 iframe을 걷을 시각. */
const FRAME_REAP_MS = 60_000;

export type PrintOutcome = "window" | "frame" | "unavailable";

/** 같은 출처 문서에 HTML을 실어 보낸다. srcdoc/blob과 달리 `document.title`이 곧 저장 파일명이 된다. */
function write(target: Window, html: string): void {
  target.document.open();
  target.document.write(html);
  target.document.close();
}

/** 조판이 끝난 뒤 한 번만 인쇄한다. load를 이미 지나쳤을 수 있어 타이머와 함께 건다. */
function printOnce(target: Window, after: () => void): void {
  let fired = false;
  const run = () => {
    if (fired) return;
    fired = true;
    try {
      target.focus();
      target.print();
    } catch {
      // 인쇄를 띄우지 못해도 문서는 이미 열려 있다 — 사용자가 직접 인쇄할 수 있으므로 조용히 넘어간다.
    }
    after();
  };
  target.addEventListener("load", run, { once: true });
  target.setTimeout(run, LAYOUT_SETTLE_MS);
}

/** 팝업이 막혔을 때의 경로. 화면에 보이지 않는 iframe을 만들어 그 문서만 인쇄한다. */
function printInFrame(html: string): PrintOutcome {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.title = "신고 근거자료 인쇄";
  // display:none인 iframe은 일부 브라우저가 렌더하지 않아 빈 종이가 나온다. 화면 밖으로 밀어낸다.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;";
  document.body.append(frame);

  const view = frame.contentWindow;
  if (!view) {
    frame.remove();
    return "unavailable";
  }
  write(view, html);

  let reaped = false;
  const reap = () => {
    if (reaped) return;
    reaped = true;
    frame.remove();
  };
  view.addEventListener("afterprint", reap, { once: true });
  printOnce(view, () => window.setTimeout(reap, FRAME_REAP_MS));
  return "frame";
}

/**
 * 보고서를 열고 인쇄 대화상자를 띄운다. 반환값은 어느 경로를 탔는지이며,
 * `unavailable`이면 화면이 사용자에게 다른 내려받기를 권해야 한다.
 *
 * 클릭 핸들러에서 **동기로** 불러야 한다 — 팝업 허용은 사용자 제스처에 붙어 있어 await 뒤에서는 막힌다.
 */
export function printReportHtml(html: string): PrintOutcome {
  let view: Window | null = null;
  try {
    view = window.open("", "_blank");
  } catch {
    view = null;
  }
  // 팝업 차단기는 null을 주기도 하고, 닫힌 창을 주기도 한다.
  if (!view || view.closed) return printInFrame(html);

  write(view, html);
  printOnce(view, () => { /* 탭은 남겨 둔다 — 대화상자를 닫은 사용자가 다시 인쇄할 수 있어야 한다. */ });
  return "window";
}
