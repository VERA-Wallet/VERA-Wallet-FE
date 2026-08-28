/**
 * OmniOne CX 표준인증창 클라이언트 로더 (2026 블록체인 & AI 해커톤 가이드북 p.19-25).
 *
 * 표준인증창은 라온시큐어가 호스팅하는 모달 UI다. FE는 CX 호스트에서 `oacx-vendor.js`,
 * `oacx-ux.js`, `oacx-ux.css`를 로드하고 `#oacxDiv` 마운트 지점을 제공한 뒤
 * `OACX.LOAD_MODULE(<config.mid.json>, { contentInfo: { signType: "ENT_MID" }, compareCI: false, isBirth: true }, cb)`를
 * 호출한다. 인증창이 QR(데스크톱)/딥링크(모바일)를 표시하고, 사용자가 모바일신분증 앱으로
 * 제출을 마치면 성공 콜백에 일회용 `token`이 온다. 이 토큰은 BE로만 전달하며(백엔드가
 * server-to-server로 신원을 교환·해시), FE는 신원 클레임을 절대 다루지 않는다.
 *
 * ── CSS 격리 ──────────────────────────────────────────────────────────────────
 * `oacx-ux.css`는 스코프 없는 전역 규칙 `html{font-size:62.5%}`(1rem=10px 트릭)를 포함하고,
 * 모달 본문은 그 위에서 rem(1.3~1.6rem)으로 짜여 있다. 이 CSS를 호스트 <head>에 넣으면
 * rem 기반 Tailwind 전체가 62.5%로 줄어 "줌아웃"되고, 반대로 호스트 루트를 100%로 되돌리면
 * 모달 rem이 1.6배로 부풀어 고정 px 박스(`#oacxEmbededContents.pc{height:610px}`) 안에서
 * "줌인"된다. `rem`은 문서 루트(<html>) 하나에만 묶이므로 호스트(16px)와 SDK(10px)는
 * 같은 루트를 공유하는 한 양립할 수 없다 — shadow DOM도 rem을 재스코프하지 못한다.
 * 따라서 SDK를 자체 <html> 루트를 갖는 **iframe**에 격리한다. `62.5%`는 iframe 안에만 적용되고
 * 호스트는 16px 그대로다. iframe은 전면 `position:fixed` 오버레이라 SDK의 fixed 모달이
 * 호스트 뷰포트 전체를 덮는 기존 표시 방식이 그대로 유지된다.
 *
 * `NEXT_PUBLIC_OMNIONE_CX_AUTH_URL`이 비어 있으면 비활성 — 기존 mock QR 프레젠테이션이 유지된다.
 */

export type OacxResult = {
  token?: string;
  oacxCode?: string;
  resultCode?: string | number;
  clientMessage?: string;
};

export type OacxModule = {
  /**
   * 배포 모듈(v1.5.10.9)의 실제 콜백 규약:
   * - 성공: `JSON.stringify(응답)` — 객체가 아닌 **JSON 문자열**로 전달된다.
   * - 실패/만료(QR 흐름): **인자 없이** 호출된다.
   * (매뉴얼 샘플의 객체 형태도 방어적으로 함께 지원한다.)
   */
  LOAD_MODULE: (configUrl: string, options: Record<string, unknown>, onResult: (result?: OacxResult | string) => void) => void;
};

function parseOacxResult(raw: unknown): OacxResult | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? (parsed as OacxResult) : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as OacxResult;
  return null;
}

/** CX 에러 메시지는 `<br/>` 등 HTML 조각을 포함할 수 있다 — 화면 표시용으로 제거한다. */
const stripHtml = (value: string) => value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim();

declare global {
  interface Window {
    OACX?: OacxModule;
  }
}

// SDK(oacx-ux.js)는 `el:"#oacxDiv"`로 Vue 앱을 마운트한다 — iframe 문서에 이 id의 요소가 있어야 한다.
const OACX_MOUNT_ID = "oacxDiv";
// SDK 자산을 격리해 로드할 전면 오버레이 iframe.
const OVERLAY_FRAME_ID = "oacx-overlay-frame";

const SCRIPT_LOAD_TIMEOUT_MS = 15_000;

function authBase(): string {
  return (process.env.NEXT_PUBLIC_OMNIONE_CX_AUTH_URL ?? "").replace(/\/+$/, "");
}

/**
 * "했다 치고" 스위치. 켜면 실제 표준인증창(raonsecure 모달)을 열지 않고 즉시 가짜 토큰을 돌려준다.
 * mock 데모/로컬에서 모바일신분증 앱·네트워크 없이 CX 버튼 흐름을 태우려는 용도다.
 * (서버 `VERAWALLET_MOCK_MODE`는 NEXT_PUBLIC_이 아니라 클라가 못 보므로 별도 클라 노출 플래그로 둔다.)
 */
function cxMockEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OMNIONE_CX_MOCK === "true";
}

/** mock 흐름이 present 라우트로 넘기는 고정 CX 토큰. FE mock present는 cxToken을 검증하지 않는다(country만 확인). */
const MOCK_CX_TOKEN = "mock-cx-token";

export function cxLoginEnabled(): boolean {
  return cxMockEnabled() || authBase().length > 0;
}

let overlayFrame: HTMLIFrameElement | null = null;

/** 전면 고정 오버레이 iframe을 만든다. SDK의 position:fixed 모달이 이 iframe 뷰포트를 기준으로 배치된다. */
function buildOverlayFrame(): HTMLIFrameElement {
  teardownOverlay(); // 이전 시도의 잔여 프레임을 먼저 정리한다.
  const frame = document.createElement("iframe");
  frame.id = OVERLAY_FRAME_ID;
  frame.title = "OmniOne CX 표준인증창";
  frame.setAttribute("aria-label", "OmniOne CX 표준인증창");
  // 자체 <html> 루트를 갖도록 srcless(about:blank) iframe으로 만든다 — 부모 origin을 상속하므로 스크립트 주입이 가능하다.
  // 자산 로딩 동안엔 pointer-events:none으로 두어 투명 오버레이가 호스트의 취소 버튼 클릭을 삼키지 않게 한다(모달 렌더 직전에 auto로 전환).
  frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;background:transparent;pointer-events:none;z-index:2147483647;";
  document.body.appendChild(frame);
  overlayFrame = frame;
  return frame;
}

/** iframe 문서에 마운트 지점과 투명 배경을 세팅한다. oacx-ux.css의 `html{font-size:62.5%}`는 이 문서 루트에만 적용된다. */
function writeFrameDocument(doc: Document): void {
  // SDK 자산은 문서 상대경로다(config의 로고 "./esign/img/logo.gif", 번들 publicPath "./esign/").
  // about:blank iframe은 부모 페이지 URL을 base로 상속해 로고가 우리 호스트로 해석돼 404가 나므로,
  // authBase(".../ent/esign")의 상위 디렉터리(".../ent/")를 <base>로 명시한다. 주입 CSS/JS/config와
  // config 내 API·템플릿 경로는 전부 절대 URL이라 <base>의 영향은 SDK 상대경로 자산에만 미친다.
  const assetBase = new URL(".", authBase()).href;
  doc.open();
  doc.write(
    '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
      `<base href="${assetBase}">` +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<style>html,body{margin:0;padding:0;height:100%;background:transparent}</style>" +
      `</head><body><div id="${OACX_MOUNT_ID}"></div></body></html>`,
  );
  doc.close();
}

function loadStylesheetInto(doc: Document, href: string): void {
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  doc.head.appendChild(link);
}

/** iframe 문서에 외부 스크립트를 주입하고 실행 완료(load)를 기다린다. 순차 await로 로드 순서를 보장한다. */
function loadScriptInto(doc: Document, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const view = doc.defaultView;
    const script = doc.createElement("script");
    const timer = view?.setTimeout(() => reject(new Error("OmniOne CX 스크립트 로드가 시간 초과되었습니다.")), SCRIPT_LOAD_TIMEOUT_MS);
    script.addEventListener("load", () => {
      if (timer !== undefined) view?.clearTimeout(timer);
      resolve();
    });
    script.addEventListener("error", () => {
      if (timer !== undefined) view?.clearTimeout(timer);
      reject(new Error("OmniOne CX 스크립트를 불러오지 못했습니다."));
    });
    script.src = src;
    doc.head.appendChild(script);
  });
}

/** 오버레이 iframe을 제거한다(멱등). 취소·언마운트·인증 종료 시 호출한다. */
function teardownOverlay(): void {
  overlayFrame?.remove();
  overlayFrame = null;
}

/** 진행 중인 CX 인증창을 닫고 오버레이를 제거한다. */
export function closeCxLogin(): void {
  teardownOverlay();
}

async function resolveOacx(base: string): Promise<OacxModule> {
  // 테스트/사전주입 seam: 호스트 window에 OACX가 이미 있으면 iframe 격리를 생략하고 그대로 쓴다.
  if (typeof window !== "undefined" && window.OACX) return window.OACX;
  const frame = buildOverlayFrame();
  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (!doc || !view) throw new Error("OmniOne CX 인증창 프레임을 생성하지 못했습니다.");
  writeFrameDocument(doc);
  loadStylesheetInto(doc, `${base}/oacx-ux.css`);
  // vendor 번들이 먼저 있어야 oacx-ux.js가 OACX 전역을 초기화한다 (가이드북 p.23 로드 순서).
  await loadScriptInto(doc, `${base}/oacx-vendor.js`);
  await loadScriptInto(doc, `${base}/oacx-ux.js`);
  const moduleRef = view.OACX;
  if (!moduleRef) throw new Error("OmniOne CX 모듈(OACX)을 초기화하지 못했습니다.");
  return moduleRef;
}

/**
 * 표준인증창 모달을 열고, 사용자가 모바일신분증 제출을 마치면 일회용 CX 토큰을 반환한다.
 * 취소/만료(OACX_CANCLED_SIGNED 등)는 reject로 떨어진다. 성공·실패 어느 경우든 오버레이를 정리한다.
 */
export async function openCxLogin(): Promise<string> {
  // mock: 실제 표준인증창을 열지 않고 "했다 치고" 일회용 가짜 토큰을 돌려준다. iframe/URL 모두 불필요.
  if (cxMockEnabled()) return MOCK_CX_TOKEN;
  const base = authBase();
  if (!base) throw new Error("OmniOne CX 표준인증창이 설정되지 않았습니다 (NEXT_PUBLIC_OMNIONE_CX_AUTH_URL).");
  let oacx: OacxModule;
  try {
    oacx = await resolveOacx(base);
  } catch (cause) {
    teardownOverlay(); // 자산 로드 중 실패한 프레임을 남기지 않는다.
    throw cause;
  }
  return new Promise<string>((resolve, reject) => {
    // 모달이 결과를 돌려주면 오버레이를 먼저 걷어내고 상태를 확정한다(테스트 seam에서는 no-op).
    const settle = (finish: () => void) => {
      teardownOverlay();
      finish();
    };
    // 모달이 그려지는 시점부터 오버레이가 포인터 이벤트를 받아야 SDK UI가 조작 가능하다.
    if (overlayFrame) overlayFrame.style.pointerEvents = "auto";
    oacx.LOAD_MODULE(
      `${base}/config/config.mid.json`,
      // 배포 모듈(v1.5.10.9)은 boolean isBirth를 요구하며, compareCI와 isBirth는 정확히 하나만 true여야 한다
      // (아니면 IS_NOT_CONFIG_ISBIRTH / INIT_LOAD_MODULE 팝업 에러). isBirth: true = 주민번호 대신 생년월일 8자리 입력.
      { contentInfo: { signType: "ENT_MID" }, compareCI: false, isBirth: true },
      (raw) => {
        const result = parseOacxResult(raw);
        if (result && typeof result.token === "string" && result.token.length > 0) {
          const token = result.token;
          settle(() => resolve(token));
          return;
        }
        if (!result) {
          // QR 흐름 실패/만료 시 배포 모듈은 콜백을 인자 없이 호출한다.
          settle(() => reject(new Error("모바일신분증 인증이 완료되지 않았습니다. 인증창을 닫았거나 시간이 초과된 경우이니 다시 시도해 주세요.")));
          return;
        }
        const detail = result.clientMessage ? stripHtml(result.clientMessage) : (result.oacxCode ?? "알 수 없는 오류");
        settle(() => reject(new Error(`모바일신분증 인증이 완료되지 않았습니다 (${detail}).`)));
      },
    );
  });
}
