import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

/**
 * DID CA's user_init flow requires a WebView completion callback before PIN
 * authorization. Development holders/claims are provisioned by the operator;
 * never expose the upstream demo's unauthenticated save-user-info endpoint.
 * This page only resumes the native flow. The issuer still verifies the holder
 * signature and registered claims before issuing a credential.
 */
export function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  if (query.get("vcSchemaId") !== "verawallet-dev" ||
      !/^did:omn:[A-Za-z0-9]{1,128}$/.test(query.get("did") ?? "")) {
    return new Response("지원하지 않는 증명서 발급 요청입니다. 앱에서 다시 시작해 주세요.", {
      status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const nonce = randomBytes(18).toString("base64");
  // Deliberately do not render DID, userName or any other query value in HTML.
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>개발용 증명서 발급</title><style nonce="${nonce}">
body{font-family:system-ui,sans-serif;margin:0;padding:32px 24px;background:#fafafa;color:#222;line-height:1.7}
main{max-width:440px;margin:auto}h1{font-size:24px}button{width:100%;padding:16px;border:0;border-radius:12px;background:#ed8200;color:white;font-size:18px;font-weight:600}button:disabled{opacity:.6}#status{min-height:2em}
</style></head><body><main><h1>개발용 증명서 발급</h1>
<p>운영자가 사전 등록한 정보로 VeraWallet Development Credential 발급을 진행합니다.</p>
<p>아래 버튼을 누른 뒤 앱에서 PIN 또는 생체인증으로 승인해 주세요. 이 증명서는 테스트용이며 정부 발급 신분증이 아닙니다.</p>
<button id="continue" type="button">인증하고 발급 계속하기</button><p id="status" role="status"></p>
<p>등록된 발급 정보가 없다는 오류가 나오면 테스트 운영자에게 초기 증명서 등록을 요청해 주세요.</p>
</main><script nonce="${nonce}">
const button = document.getElementById('continue');
button.addEventListener('click', () => {
  const status = document.getElementById('status');
  if (!window.android || typeof window.android.onCompletedAddVcUpload !== 'function') {
    status.textContent = 'DID CA 앱의 ADD VC에서 열어 주세요.';
    return;
  }
  button.disabled = true;
  try {
    window.android.onCompletedAddVcUpload();
    status.textContent = '앱에서 인증을 진행해 주세요.';
  } catch {
    button.disabled = false;
    status.textContent = '앱으로 돌아가지 못했습니다. 다시 시도해 주세요.';
  }
});
</script></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  } });
}
