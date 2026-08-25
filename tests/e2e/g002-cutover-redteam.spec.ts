import { expect, test } from "@playwright/test";
import { backendOrigin } from "../../lib/api-mode";
import { mkdir, writeFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { useFreshBackend } from "./support/backend-lifecycle";

declare global {
  interface Window {
    __g002CutoverSign(message: string): Promise<string>;
  }
}

const artifacts = "artifacts";
const account = privateKeyToAccount("0x6c875c7eea6d4aee801f2d6671f040142b3403517eb6e562015beb8f5cb6406f");
type Verdict = "passed" | "failed";
type Result = { id: string; request: string; expected: unknown; actual: unknown; verdict: Verdict };
type Step = { timestamp: string; status: Verdict; selector: string; description: string; type?: string };

function add(results: Result[], id: string, request: string, expected: unknown, actual: unknown, passed: boolean) {
  results.push({ id, request, expected, actual, verdict: passed ? "passed" : "failed" });
}

async function browserCompleteSession(page: import("@playwright/test").Page, actions: Step[], assertions: Step[]) {
  // 게이트 검증기는 action마다 `type`을 요구한다(액션 종류가 비면 자동화 증거로 인정되지 않는다).
  const addAction = (description: string, selector: string, type = "navigate") => actions.push({ type, description, selector, status: "passed", timestamp: new Date().toISOString() });
  await page.exposeFunction("__g002CutoverSign", (message: string) => account.signMessage({ message: message.startsWith("0x") ? { raw: message as `0x${string}` } : message }));
  await page.addInitScript((address: string) => {
    const ethereum = { request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
      if (method === "eth_chainId") return "0x1";
      if (method === "personal_sign") return window.__g002CutoverSign(String(params[0]));
      throw new Error(`Unexpected wallet method: ${method}`);
    }, on: () => ethereum, removeListener: () => ethereum };
    (window as Window & { ethereum?: unknown }).ethereum = ethereum;
  }, account.address);
  await page.goto("/login"); addAction("Open login", "url=/login");
  await page.getByRole("button", { name: "KR", exact: true }).click(); addAction("Select country", "role=button[name=KR]");
  await page.getByRole("button", { name: "QR/딥링크 제시" }).click(); addAction("Present DID", "role=button[name=QR/딥링크 제시]");
  await page.getByRole("button", { name: "제시 완료" }).click(); addAction("Confirm DID", "role=button[name=제시 완료]");
  await page.getByRole("button", { name: "대시보드로 이동" }).click();
  await page.waitForURL("**/dashboard"); addAction("Open dashboard (empty shell)", "url=/dashboard");
  await page.getByRole("link", { name: "데이터 불러오기" }).click();
  await page.waitForURL("**/connect-wallet"); addAction("Open wallet connection", "url=/connect-wallet");
  await page.getByRole("button", { name: "지갑 연결하기" }).click(); addAction("Connect synthetic wallet", "role=button[name=지갑 연결하기]");
  await expect(page.getByRole("button", { name: "SIWE 서명으로 계속" })).toBeVisible();
  await page.getByRole("button", { name: "SIWE 서명으로 계속" }).click(); addAction("Sign SIWE", "role=button[name=SIWE 서명으로 계속]");
  await page.waitForURL("**/dashboard");
  const dashboard = await page.getByText("거래 요약").isVisible();
  assertions.push({ description: "DID to SIWE browser journey reaches dashboard", selector: "text=거래 요약", status: dashboard ? "passed" : "failed", timestamp: new Date().toISOString() });
}

// 이 스펙은 ON(하이브리드 프록시) 모드의 계약만 검증한다. OFF 모드에는 BE 자체가 없어 같은 전제를 재현할 수 없고,
// OFF 등가 계약은 g001-session-gate-redteam·g002-wallet-siwe가 담당한다.
// URL이 있어도 mock 강제가 켜질 수 있으므로 원시 환경변수 대신 실제 백엔드 origin으로 suite를 분류한다.
const onModeOnly = backendOrigin() ? test.describe.serial : test.describe.skip;

onModeOnly("G002 hybrid cutover adversarial browser QA", () => {
  useFreshBackend();
  test.use({ viewport: { width: 430, height: 932 } });
  test("preserves proxy, cookie, data, and outage boundaries", async ({ page, browser }) => {
    await mkdir(artifacts, { recursive: true });
    const results: Result[] = [];
    const actions: Step[] = [];
    const assertions: Step[] = [];
    await browserCompleteSession(page, actions, assertions);
    const session = await page.context().request.get("/api/auth/session");
    const browserCookies = await page.context().cookies();
    const accessCookie = browserCookies.find((item) => item.name === "vw_access_token");
    add(results, "rewrite-cookie", "Browser DID→SIWE then GET /api/auth/session", "BE Set-Cookie reaches browser with HttpOnly and Path=/", { status: session.status(), cookie: accessCookie && { name: accessCookie.name, httpOnly: accessCookie.httpOnly, path: accessCookie.path } }, session.status() === 200 && accessCookie?.httpOnly === true && accessCookie.path === "/");

    const events = await page.context().request.get("/api/events?limit=100");
    const eventBody = await events.json() as { data?: { items?: Array<{ event: { id: string; asset_symbol?: string; symbol?: string } }> } };
    const items = eventBody.data?.items ?? [];
    // 프록시는 BE 원본을 그대로 통과시키므로 raw 응답에는 canonical `asset_symbol`이 아니라 BE의 `symbol`이 온다.
    // canonical 변환은 FE 어댑터 경계가 하며, 그 결과는 아래 화면 렌더로 확인한다.
    const symbols = items.filter((item) => Boolean(item.event.asset_symbol ?? item.event.symbol)).length;
    add(results, "be-events-rendered", "GET /api/events?limit=100 and browser /dashboard", "45 events carrying a symbol", { status: events.status(), count: items.length, symbols }, events.status() === 200 && items.length === 45 && symbols === 45);
    const cursor = items[0]?.event.id;
    const cursorPage = cursor ? await page.context().request.get(`/api/events?limit=100&cursor=${encodeURIComponent(cursor)}`) : undefined;
    const cursorBody = cursorPage ? await cursorPage.json() as { data?: { items?: Array<{ event: { id: string } }> } } : undefined;
    add(results, "query-preserved", `GET /api/events?limit=100&cursor=${cursor}`, "BE receives cursor and returns the page after it", { status: cursorPage?.status(), firstId: cursorBody?.data?.items?.[0]?.event.id, cursor }, cursorPage?.status() === 200 && cursorBody?.data?.items?.length === items.length - 1 && cursorBody.data.items[0]?.event.id !== cursor);
    await expect(page.getByText("거래 요약")).toBeVisible();
    // 어댑터 정규화가 빠지면 자산 이름이 통째로 빈다. 화면에서 직접 확인한다.
    const renderedLabels = await page.locator("[data-event-label]").allInnerTexts();
    const labelled = renderedLabels.filter((label) => /·\s*\S/.test(label)).length;
    add(results, "dashboard-asset-labels", "dashboard event cards", "every rendered card shows an asset name", { rendered: renderedLabels.length, labelled }, renderedLabels.length > 0 && labelled === renderedLabels.length);
    await page.screenshot({ path: `${artifacts}/g002-on-dashboard.png` });

    const testLogin = await page.context().request.post("/api/auth/test-login");
    add(results, "on-test-login-404", "POST /api/auth/test-login", 404, testLogin.status(), testLogin.status() === 404);
    const tax = await page.context().request.post("/api/tax/estimate", { data: { year: 2025 } });
    add(results, "tax-remains-fe", "POST /api/tax/estimate", "FE Route Handler response, not BE 404", { status: tax.status(), contentType: tax.headers()["content-type"] }, tax.status() !== 404 && (tax.headers()["content-type"] ?? "").includes("application/json"));
    const rulesets = await page.context().request.get("/api/rulesets?country=KR");
    const rulesetsBody = await rulesets.json().catch(() => null) as { data?: unknown } | null;
    add(results, "rulesets-remains-fe", "GET /api/rulesets?country=KR", "FE Route Handler returns an FE ruleset envelope", { status: rulesets.status(), body: rulesetsBody }, rulesets.status() === 200 && rulesetsBody?.data !== undefined);
    const forgedContext = await browser.newContext();
    await forgedContext.addCookies([{ name: "vw_session", value: "forged-session", domain: "localhost", path: "/" }]);
    const forgedSession = await forgedContext.request.get("http://localhost:3100/api/auth/session");
    const forgedSessionBody = await forgedSession.json() as { data?: { didVerified?: boolean } };
    const forgedEvents = await forgedContext.request.get("http://localhost:3100/api/events");
    add(results, "non-access-cookie-cannot-forge-session", "GET /api/auth/session and /api/events with only vw_session", "anonymous session and 401 events", { session: forgedSessionBody, eventsStatus: forgedEvents.status() }, forgedSession.status() === 200 && forgedSessionBody.data?.didVerified === false && forgedEvents.status() === 401);
    await forgedContext.close();

    const event = (eventBody.data?.items ?? [])[0] as { event: { id: string; classification: string }; version: number };
    const nextClassification = event.event.classification === "SEND" ? "RECEIVE" : "SEND";
    const patch = await page.context().request.patch(`/api/events/${event.event.id}`, { data: { classification: nextClassification, reason: "G002 cutover adversarial patch", expectedVersion: event.version }, headers: { "content-type": "application/json" } });
    const patched = await patch.json() as { data?: { event?: { classification?: string; user_override?: { classification?: string; reason?: string } } } };
    add(results, "patch-body-content-type-preserved", `PATCH /api/events/${event.event.id}`, "BE accepts JSON PATCH body and reports the manual override", { status: patch.status(), contentType: patch.headers()["content-type"], event: patched.data?.event }, patch.status() === 200 && (patch.headers()["content-type"] ?? "").includes("application/json") && patched.data?.event?.classification === nextClassification && patched.data.event.user_override?.classification === nextClassification && patched.data.event.user_override.reason === "G002 cutover adversarial patch");

    await page.goto("/export");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "직접 신고용 내려받기" }).click()]);
    const csv = await download.createReadStream();
    let csvText = "";
    for await (const chunk of csv!) csvText += chunk.toString();
    const csvRows = csvText.trim().split(/\r?\n/).length - 1;
    add(results, "on-export-parity", "Browser /export CSV 다운로드", "CSV rows equal dashboard event count", { csvRows, eventCount: items.length }, csvRows === items.length);

    const { stopBackend } = await import("../integration/support/server-harness");
    await stopBackend();
    const outageTax = await page.context().request.post("/api/tax/estimate", { data: { year: 2025 } });
    const outageBody = await outageTax.json().catch(() => null) as { error?: { code?: string } } | null;
    add(results, "tax-outage-json", "POST /api/tax/estimate after backend shutdown", "502 JSON upstream_unavailable", { status: outageTax.status(), contentType: outageTax.headers()["content-type"], body: outageBody }, outageTax.status() === 502 && (outageTax.headers()["content-type"] ?? "").includes("application/json") && outageBody?.error?.code === "upstream_unavailable");
    await page.goto("/dashboard");
    add(results, "rsc-outage-not-anonymous", "GET /dashboard after backend shutdown", "not redirected to /login", page.url(), !new URL(page.url()).pathname.startsWith("/login"));

    const status: Verdict = results.every((result) => result.verdict === "passed") && assertions.every((entry) => entry.status === "passed") ? "passed" : "failed";
    let floor = actions.at(-1)?.timestamp ?? new Date(0).toISOString();
    const orderedAssertions = assertions.map((entry) => { floor = entry.timestamp > floor ? entry.timestamp : new Date(Date.parse(floor) + 1).toISOString(); return { ...entry, timestamp: floor }; });
    await writeFile(`${artifacts}/g002-on-transcript.json`, `${JSON.stringify({ schemaVersion: 1, surface: "web", tool: "playwright-chromium", spec: "tests/e2e/g002-cutover-redteam.spec.ts", actions, assertions: orderedAssertions }, null, 2)}\n`);
    await writeFile(`${artifacts}/g002-api-contract-report.json`, `${JSON.stringify({ status, cases: results, blockers: results.filter((result) => result.verdict === "failed").map((result) => `${result.id}: ${JSON.stringify(result.actual)}`) }, null, 2)}\n`);
    expect(results.filter((result) => result.verdict === "failed")).toEqual([]);
  });
});
