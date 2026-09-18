import { expect, test, type APIRequestContext } from "@playwright/test";
import { isMockApiMode } from "../../lib/api-mode";
import { mkdir, writeFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";

declare global {
  interface Window {
    __g002ForbiddenCalls?: string[];
    __g002SignMessage?: (message: string) => Promise<string>;
  }
}

type CaseResult = {
  id: string;
  scenario: string;
  expected: unknown;
  actual: unknown;
  verdict: "passed" | "failed";
};

type Nonce = {
  nonce: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: string;
  expiresAtMs: number;
};

const artifactDirectory = "/tmp/g002-qa";
const privateKey = "0x59c6995e998f97a5a004497e5daef5a40b90f1a9d1bb0f6285295225249f2f1a" as const;
const account = privateKeyToAccount(privateKey);

function record(cases: CaseResult[], id: string, scenario: string, expected: unknown, actual: unknown, passed: boolean) {
  cases.push({ id, scenario, expected, actual, verdict: passed ? "passed" : "failed" });
}

function siweMessage(nonce: Nonce, overrides: Partial<{ domain: string; uri: string; address: string }> = {}) {
  return new SiweMessage({
    address: (overrides.address ?? account.address) as `0x${string}`,
    version: "1",
    chainId: nonce.chainId,
    domain: overrides.domain ?? nonce.domain,
    uri: overrides.uri ?? nonce.uri,
    nonce: nonce.nonce,
    issuedAt: nonce.issuedAt,
    expirationTime: new Date(nonce.expiresAtMs).toISOString(),
  }).prepareMessage();
}

async function issueNonce(request: APIRequestContext) {
  const response = await request.post("/api/auth/nonce", { data: { chainId: 1 } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { data: Nonce }).data;
}

// 이 스펙은 FE mock의 SIWE 계약(409 재사용/400 불일치 — BE와 status 정렬 완료, DID 없는 nonce 401, DID 재제시 시 지갑 클레임 보존)을 고정한다.
// nonce는 FE mock도 BE처럼 DID 세션을 요구하며, DID 재제시는 양쪽 모두 바인딩을 유지한다.
// ON 모드의 raw BE 계약은 tests/integration/be-siwe-contract.test.ts가 담당한다.
// URL이 있어도 mock 강제가 켜질 수 있으므로 원시 환경변수 대신 실제 모드로 suite를 분류한다.
const offModeOnly = isMockApiMode() ? test.describe.serial : test.describe.skip;

offModeOnly("G002 synthetic wallet SIWE red team", () => {
  test("DID claim, synthetic EIP-1193 wallet SIWE, and authentication API defenses", async ({ page, request, browser }) => {
    await mkdir(artifactDirectory, { recursive: true });
    const cases: CaseResult[] = [];
    const actions: Array<{ type: string; timestamp: string; url?: string; selector?: string; target?: string }> = [];
    const assertions: Array<{ timestamp: string; status: "passed" | "failed"; selector?: string; description: string }> = [];
    const act = (entry: { type: string; url?: string; selector?: string; target?: string }) => actions.push({ ...entry, timestamp: new Date().toISOString() });
    const assertion = (description: string, passed: boolean, selector?: string) => assertions.push({ description, status: passed ? "passed" : "failed", timestamp: new Date().toISOString(), ...(selector ? { selector } : {}) });
    const didScreenshot = `${artifactDirectory}/did-claim.jpg`;
    const walletScreenshot = `${artifactDirectory}/wallet-connected.jpg`;
    const reportPath = `${artifactDirectory}/api-test-report.json`;
    const anonymousContext = await browser.newContext();
    const anonymousPage = await anonymousContext.newPage();
    act({ type: "goto", url: "/dashboard" });
    await anonymousPage.goto("/dashboard");
    const anonymousDashboardPath = new URL(anonymousPage.url()).pathname;
    assertion("Anonymous dashboard visit redirects to login", anonymousDashboardPath === "/login");
    record(cases, "anonymous-dashboard-page-guard", "A fresh anonymous browser context cannot open the dashboard", "/login", anonymousDashboardPath, anonymousDashboardPath === "/login");
    await anonymousContext.close();

    const walletOnlyContext = await browser.newContext();
    const walletOnlyRequest = walletOnlyContext.request;
    const walletOnlyNonce = await walletOnlyRequest.post("/api/auth/nonce", { data: { chainId: 1 } });
    const walletOnlyPage = await walletOnlyContext.newPage();
    act({ type: "goto", url: "/dashboard" });
    await walletOnlyPage.goto("/dashboard");
    const walletOnlyDashboardPath = new URL(walletOnlyPage.url()).pathname;
    const walletOnlyEvents = await walletOnlyRequest.get("/api/events");
    const walletOnlyRedirected = ["/connect-wallet", "/login"].includes(walletOnlyDashboardPath);
    assertion("Wallet-only SIWE attempt is blocked at nonce and events remain denied", walletOnlyNonce.status() === 401 && walletOnlyRedirected && walletOnlyEvents.status() === 401);
    record(cases, "wallet-only-dashboard-page-guard", "SIWE without DID is blocked at nonce and cannot open the dashboard or events API", { nonce: 401, dashboard: ["/connect-wallet", "/login"], events: 401 }, { nonce: walletOnlyNonce.status(), dashboard: walletOnlyDashboardPath, events: walletOnlyEvents.status() }, walletOnlyNonce.status() === 401 && walletOnlyRedirected && walletOnlyEvents.status() === 401);
    // 역순 우회 차단은 nonce의 DID 가드가 담당한다. wallet-only 세션 자체가 불가능하고,
    // 이후 DID를 제시하면 DID-only가 되어 대시보드는 껍데기(데이터 없음)만 보이고 events는 404다.
    const reverseDid = await walletOnlyRequest.post("/api/auth/did/present", { data: { country: "KR" } });
    act({ type: "goto", url: "/dashboard" });
    await walletOnlyPage.goto("/dashboard");
    const reversePath = new URL(walletOnlyPage.url()).pathname;
    const reverseEvents = await walletOnlyRequest.get("/api/events");
    const reverseEventsBody = (await reverseEvents.json()) as { error?: { message?: string } };
    const reverseBlocked = walletOnlyNonce.status() === 401 && reverseDid.status() === 201 && reversePath === "/dashboard" && reverseEvents.status() === 404 && reverseEventsBody.error?.message?.includes("bound wallet") === true;
    assertion("Wallet-then-DID order cannot produce a completed session", reverseBlocked, "body");
    record(cases, "reverse-order-bypass-blocked", "SIWE→DID reverse order is stopped at nonce and stays DID-only (dashboard shows empty shell)", { nonce: 401, did: 201, dashboard: "/dashboard", events: 404 }, { nonce: walletOnlyNonce.status(), did: reverseDid.status(), dashboard: reversePath, events: reverseEvents.status() }, reverseBlocked);
    await walletOnlyContext.close();

    // personal_sign의 params[0]은 hex 인코딩 메시지 — raw 바이트로 EIP-191 서명해야 서버 복원 주소가 일치한다.
    await page.exposeFunction("__g002SignMessage", async (message: string) =>
      account.signMessage({ message: message.startsWith("0x") ? { raw: message as `0x${string}` } : message }),
    );
    await page.addInitScript((address: string) => {
      const forbidden = new Set(["eth_sendTransaction", "eth_signTransaction", "eth_sendRawTransaction", "wallet_sendCalls"]);
      const ethereum = {
        isMetaMask: true,
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          if (forbidden.has(method)) {
            (window as Window & { __g002ForbiddenCalls?: string[] }).__g002ForbiddenCalls?.push(method);
            throw new Error(`Forbidden wallet method: ${method}`);
          }
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
          if (method === "eth_chainId") return "0x1";
          if (method === "personal_sign") return (window as Window & { __g002SignMessage(message: string): Promise<string> }).__g002SignMessage(String(params[0]));
          throw new Error(`Unsupported wallet method: ${method}`);
        },
        on: () => ethereum,
        removeListener: () => ethereum,
      };
      (window as Window & { ethereum?: unknown; __g002ForbiddenCalls?: string[] }).ethereum = ethereum;
      window.__g002ForbiddenCalls = [];
    }, account.address);

    act({ type: "goto", url: "/login" });
    await page.goto("/login");
    // 거주국 버튼은 인증 모드와 무관하게 늘 주 버튼 아래 접힌 <details> 안에 있다(거주 국가는 사용자가 신고하는 값) — 먼저 펼쳐야 US를 고를 수 있다.
    act({ type: "click", selector: "details > summary" });
    await page.locator("details > summary").click();
    act({ type: "click", selector: "role=button[name='US']" });
    await page.getByRole("button", { name: "US", exact: true }).click();
    act({ type: "click", selector: "role=button[name='QR/딥링크 제시']" });
    await page.getByRole("button", { name: "QR/딥링크 제시" }).click();
    act({ type: "click", selector: "role=button[name='제시 완료']" });
    await page.getByRole("button", { name: "제시 완료" }).click();
    // "DID"·"클레임" 문구는 화면에서 빠졌다. 확인 상태와 거주 국가 표시로 US 선택이 반영됐음을 검증한다.
    // (옛 "US FIFO" 원가법 배지는 이 화면에서 더는 렌더되지 않는다 — 구현 쪽 발견 사항으로 별도 보고.)
    await expect(page.getByRole("status")).toContainText("본인 확인이 끝났어요");
    await expect(page.getByRole("status")).toContainText("거주 국가 미국 기준으로 계산할게요");
    assertion("US DID claim confirmed with the selected country reflected in the status text", true, "role=status");
    act({ type: "screenshot", selector: "body", target: didScreenshot });
    await page.screenshot({ path: didScreenshot, fullPage: true, type: "jpeg", quality: 85 });
    record(cases, "wallet-connect-synthetic-provider", "US country selection is confirmed after DID presentation", "role=status shows 본인 확인이 끝났어요 and 거주 국가 미국 기준으로 계산할게요", { status: await page.getByRole("status").innerText() }, true);

    // 지갑 없는 세션은 로그인 직후 클릭 없이 /connect-wallet로 자동 진행한다(빈 요약을 거치지 않는다).
    act({ type: "navigate", target: "/connect-wallet", selector: "auto-advance" });
    await page.waitForURL(/\/connect-wallet$/);
    // 기본 경로는 주소 입력이다. 이 스펙은 SIWE 계약을 검증하므로 브라우저 지갑 행을 고른다.
    act({ type: "click", selector: "role=button[name='브라우저 지갑으로 연결']" });
    await page.getByRole("button", { name: /브라우저 지갑으로 연결/ }).click();
    act({ type: "click", selector: "role=button[name='지갑 연결하기']" });
    await page.getByRole("button", { name: "지갑 연결하기" }).click();
    await page.waitForTimeout(750);
    const connected = await page.getByText(account.address).isVisible().catch(() => false);
    const onDashboard = /\/dashboard$/.test(new URL(page.url()).pathname);
    if (connected) {
      act({ type: "click", selector: "role=button[name='서명하고 추가']" });
      await page.getByRole("button", { name: "서명하고 추가" }).click();
      await page.waitForURL(/\/(?:dashboard|login)$/);
    }
    const completedWalletFlow = /\/dashboard$/.test(new URL(page.url()).pathname);
    assertion("Synthetic wallet SIWE journey reached dashboard", completedWalletFlow, "role=button[name='서명하고 추가']");
    act({ type: "screenshot", selector: "body", target: walletScreenshot });
    await page.screenshot({ path: walletScreenshot, fullPage: true, type: "jpeg", quality: 85 });
    record(cases, "wallet-connect-and-siwe", "Synthetic provider connects, signs SIWE, and reaches dashboard", "/dashboard", { connected, onDashboard, finalUrl: page.url() }, completedWalletFlow);
    const forbiddenCalls = await page.evaluate(() => window.__g002ForbiddenCalls ?? []).catch(() => []);
    record(cases, "wallet-port-forbidden-methods", "Wallet connection and SIWE do not invoke transaction/signing methods outside personal_sign", [], forbiddenCalls, forbiddenCalls.length === 0);

    const anonymousEvents = await request.get("/api/events");
    const anonymousRulesets = await request.get("/api/rulesets");
    record(cases, "anonymous-guards", "Anonymous events and rulesets requests are denied", { events: 401, rulesets: 401 }, { events: anonymousEvents.status(), rulesets: anonymousRulesets.status() }, anonymousEvents.status() === 401 && anonymousRulesets.status() === 401);

    const repeatedDid = await request.post("/api/auth/did/present", { data: { country: "US" } });
    const preservedSession = await request.get("/api/auth/session");
    const preservedSessionBody = (await preservedSession.json()) as { data?: { walletAddress?: string | null } };
    const preservedEvents = await request.get("/api/events");
    const walletPreserved = repeatedDid.status() === 201
      && preservedSession.status() === 200
      && preservedSessionBody.data?.walletAddress?.toLowerCase() === account.address.toLowerCase()
      && preservedEvents.status() === 200;
    record(cases, "did-representation-preserves-wallet", "DID re-presentation preserves the existing wallet claim", { did: 201, walletAddress: account.address, events: 200 }, { did: repeatedDid.status(), walletAddress: preservedSessionBody.data?.walletAddress, events: preservedEvents.status() }, walletPreserved);

    const didOnlyContext = await browser.newContext();
    const didOnlyRequest = didOnlyContext.request;
    const didOnly = await didOnlyRequest.post("/api/auth/did/present", { data: { country: "US" } });
    const didOnlyEvents = await didOnlyRequest.get("/api/events");
    const didOnlyEventsBody = (await didOnlyEvents.json()) as { error?: { message?: string } };
    const didOnlyGuarded = didOnly.status() === 201 && didOnlyEvents.status() === 404 && didOnlyEventsBody.error?.message?.includes("bound wallet") === true;
    record(cases, "did-only-events-guard", "DID-only session cannot access events", { did: 201, events: 404, error: "bound wallet" }, { did: didOnly.status(), events: didOnlyEvents.status(), message: didOnlyEventsBody.error?.message }, didOnlyGuarded);
    await didOnlyContext.close();

    const foreignNonce = await request.post("/api/auth/nonce", { data: { chainId: 1, domain: "attacker.example", uri: "https://attacker.example/login", address: "0x000000000000000000000000000000000000dEaD" } });
    const foreignNonceData = ((await foreignNonce.json()) as { data: Nonce }).data;
    const expectedDomain = "localhost:3100";
    record(cases, "nonce-trusted-origin", "Nonce ignores client-supplied domain, uri, and address", { status: 201, domain: expectedDomain, uriNot: "https://attacker.example/login" }, { status: foreignNonce.status(), domain: foreignNonceData.domain, uri: foreignNonceData.uri }, foreignNonce.status() === 201 && foreignNonceData.domain === expectedDomain && foreignNonceData.uri !== "https://attacker.example/login" && foreignNonceData.uri.startsWith(`http://${expectedDomain}/`));

    const validNonce = await issueNonce(request);
    const validMessage = siweMessage(validNonce);
    const validSignature = await account.signMessage({ message: validMessage });
    const verify = await request.post("/api/auth/verify", { data: { message: validMessage, signature: validSignature } });
    const replay = await request.post("/api/auth/verify", { data: { message: validMessage, signature: validSignature } });
    const replayBody = (await replay.json()) as { error?: { code?: string } };
    record(cases, "verify-and-replay", "Valid SIWE verifies once; replay is already-consumed", { verify: 201, replay: 409, replayCode: "already-consumed" }, { verify: verify.status(), replay: replay.status(), replayBody }, verify.status() === 201 && replay.status() === 409 && replayBody.error?.code === "already-consumed");

    const mismatchNonce = await issueNonce(request);
    const mismatchMessage = siweMessage(mismatchNonce, { domain: "attacker.example", uri: "https://attacker.example/login" });
    const mismatch = await request.post("/api/auth/verify", { data: { message: mismatchMessage, signature: await account.signMessage({ message: mismatchMessage }) } });
    const mismatchBody = (await mismatch.json()) as { error?: { code?: string } };
    record(cases, "foreign-domain-message", "Foreign-domain signed message is rejected before verification", { status: 400, code: "challenge_mismatch" }, { status: mismatch.status(), code: mismatchBody.error?.code }, mismatch.status() === 400 && mismatchBody.error?.code === "challenge_mismatch");

    const invalidNonce = await issueNonce(request);
    const invalidMessage = siweMessage(invalidNonce);
    const invalidSignature = `0x${"00".repeat(65)}`;
    const invalidVerify = await request.post("/api/auth/verify", { data: { message: invalidMessage, signature: invalidSignature } });
    const consumedAfterInvalid = await request.post("/api/auth/verify", { data: { message: invalidMessage, signature: await account.signMessage({ message: invalidMessage }) } });
    const invalidBody = (await invalidVerify.json()) as { error?: { code?: string } };
    const consumedBody = (await consumedAfterInvalid.json()) as { error?: { code?: string } };
    record(cases, "invalid-signature-consumes-nonce", "Invalid signature is rejected and consumes its nonce", { invalid: 401, retry: 409, retryCode: "already-consumed" }, { invalid: invalidVerify.status(), invalidCode: invalidBody.error?.code, retry: consumedAfterInvalid.status(), retryCode: consumedBody.error?.code }, invalidVerify.status() === 401 && consumedAfterInvalid.status() === 409 && consumedBody.error?.code === "already-consumed");

    const session = await request.get("/api/auth/session");
    const sessionBody = (await session.json()) as { data?: { countryCode?: string; walletAddress?: string; chainId?: number } };
    // 세션 계약에서 chainId가 제거됐다 — 존재하면 계약 위반이다.
    record(cases, "completed-session", "Verified session preserves DID country and wallet without a chain claim", { countryCode: "US", walletAddress: account.address, chainId: undefined }, { status: session.status(), session: sessionBody.data }, session.status() === 200 && sessionBody.data?.countryCode === "US" && sessionBody.data?.walletAddress?.toLowerCase() === account.address.toLowerCase() && sessionBody.data?.chainId === undefined);

    const redTeamStatus = cases.every((result) => result.verdict === "passed") ? "passed" : "failed";
    const blockers = cases.filter((result) => result.verdict === "failed" && result.id === "wallet-connect-and-siwe").map(() => "Initial wallet connection triggers the account-change logout subscription before SIWE can be signed.");
    const transcriptPath = `${artifactDirectory}/e2e-transcript.json`;
    // 스키마는 actions→assertions 연결 스트림의 단조 시각을 요구하므로 클램프 정규화한다(상대 순서 보존).
    let clampFloor = actions.at(-1)?.timestamp ?? new Date(0).toISOString();
    const clampedAssertions = assertions.map((entry) => {
      clampFloor = entry.timestamp >= clampFloor ? entry.timestamp : clampFloor;
      return { ...entry, timestamp: clampFloor };
    });
    await writeFile(transcriptPath, `${JSON.stringify({ schemaVersion: 1, surface: "web", tool: "playwright-chromium", spec: "tests/e2e/g002-wallet-siwe.spec.ts", actions, assertions: clampedAssertions }, null, 2)}\n`);
    await writeFile(reportPath, `${JSON.stringify({ e2eStatus: redTeamStatus, redTeamStatus, cases, artifacts: [didScreenshot, walletScreenshot, reportPath, transcriptPath], blockers }, null, 2)}\n`);
    expect(cases.filter((result) => result.verdict === "failed")).toEqual([]);
  });
});
