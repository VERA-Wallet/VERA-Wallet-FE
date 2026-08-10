import { expect, test, type APIRequestContext } from "@playwright/test";
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
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: Nonce }).data;
}

// 이 스펙은 FE mock의 SIWE 계약(422 재사용/불일치, 익명 nonce 허용, DID 재제시 시 지갑 클레임 초기화)을 고정한다.
// BE는 같은 상황에서 409/400을 주고 nonce에 JWT를 요구하며 DID 재제시로 바인딩을 지우지 않는다 —
// 두 계약을 한 단언에 섞으면 어느 쪽 드리프트도 못 잡는다.
// ON 모드의 raw BE 계약은 tests/integration/be-siwe-contract.test.ts가 담당한다.
const offModeOnly = process.env.VERAWALLET_BACKEND_ORIGIN ? test.describe.skip : test.describe.serial;

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
    const walletOnlyNonce = await issueNonce(walletOnlyRequest);
    const walletOnlyMessage = siweMessage(walletOnlyNonce);
    const walletOnlyVerify = await walletOnlyRequest.post("/api/auth/verify", {
      data: { message: walletOnlyMessage, signature: await account.signMessage({ message: walletOnlyMessage }) },
    });
    const walletOnlyPage = await walletOnlyContext.newPage();
    act({ type: "goto", url: "/dashboard" });
    await walletOnlyPage.goto("/dashboard");
    const walletOnlyDashboardPath = new URL(walletOnlyPage.url()).pathname;
    const walletOnlyEvents = await walletOnlyRequest.get("/api/events");
    const walletOnlyRedirected = ["/connect-wallet", "/login"].includes(walletOnlyDashboardPath);
    assertion("Wallet-only dashboard visit is redirected and events remain denied", walletOnlyVerify.status() === 200 && walletOnlyRedirected && walletOnlyEvents.status() === 401);
    record(cases, "wallet-only-dashboard-page-guard", "SIWE without DID cannot open the dashboard or events API", { dashboard: ["/connect-wallet", "/login"], events: 401 }, { verify: walletOnlyVerify.status(), dashboard: walletOnlyDashboardPath, events: walletOnlyEvents.status() }, walletOnlyVerify.status() === 200 && walletOnlyRedirected && walletOnlyEvents.status() === 401);
    // 역순 우회 차단: wallet-only 세션에서 DID를 제시해도 지갑 클레임이 초기화되어 완료 세션이 되지 않는다.
    const reverseDid = await walletOnlyRequest.post("/api/auth/did/present", { data: { country: "KR" } });
    act({ type: "goto", url: "/dashboard" });
    await walletOnlyPage.goto("/dashboard");
    const reversePath = new URL(walletOnlyPage.url()).pathname;
    const reverseEvents = await walletOnlyRequest.get("/api/events");
    const reverseBlocked = reverseDid.status() === 200 && reversePath === "/connect-wallet" && reverseEvents.status() === 401;
    assertion("Wallet-then-DID order cannot produce a completed session", reverseBlocked, "body");
    record(cases, "reverse-order-bypass-blocked", "SIWE→DID reverse order clears wallet claims and stays incomplete", { dashboard: "/connect-wallet", events: 401 }, { did: reverseDid.status(), dashboard: reversePath, events: reverseEvents.status() }, reverseBlocked);
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
    act({ type: "click", selector: "role=button[name='US']" });
    await page.getByRole("button", { name: "US", exact: true }).click();
    act({ type: "click", selector: "role=button[name='QR/딥링크 제시']" });
    await page.getByRole("button", { name: "QR/딥링크 제시" }).click();
    act({ type: "click", selector: "role=button[name='제시 완료']" });
    await page.getByRole("button", { name: "제시 완료" }).click();
    await expect(page.getByText("US 거주국 클레임이 확인되었습니다.")).toBeVisible();
    await expect(page.getByText("US FIFO")).toBeVisible();
    assertion("US DID claim and ruleset badge visible", true, "text=US FIFO");
    act({ type: "screenshot", selector: "body", target: didScreenshot });
    await page.screenshot({ path: didScreenshot, fullPage: true, type: "jpeg", quality: 85 });
    record(cases, "wallet-connect-synthetic-provider", "US DID claim displays its ruleset badge", "US claim and US FIFO badge", { claim: await page.getByText("US 거주국 클레임이 확인되었습니다.").isVisible(), badge: await page.getByText("US FIFO").isVisible() }, true);

    act({ type: "click", selector: "role=button[name='지갑 연결로 계속']" });
    await page.getByRole("button", { name: "지갑 연결로 계속" }).click();
    await expect(page).toHaveURL(/\/connect-wallet$/);
    act({ type: "click", selector: "role=button[name='지갑 연결하기']" });
    await page.getByRole("button", { name: "지갑 연결하기" }).click();
    await page.waitForTimeout(750);
    const connected = await page.getByText(account.address).isVisible().catch(() => false);
    const onDashboard = /\/dashboard$/.test(new URL(page.url()).pathname);
    if (connected) {
      act({ type: "click", selector: "role=button[name='SIWE 서명으로 계속']" });
      await page.getByRole("button", { name: "SIWE 서명으로 계속" }).click();
      await page.waitForURL(/\/(?:dashboard|login)$/);
    }
    const completedWalletFlow = /\/dashboard$/.test(new URL(page.url()).pathname);
    assertion("Synthetic wallet SIWE journey reached dashboard", completedWalletFlow, "role=button[name='SIWE 서명으로 계속']");
    act({ type: "screenshot", selector: "body", target: walletScreenshot });
    await page.screenshot({ path: walletScreenshot, fullPage: true, type: "jpeg", quality: 85 });
    record(cases, "wallet-connect-and-siwe", "Synthetic provider connects, signs SIWE, and reaches dashboard", "/dashboard", { connected, onDashboard, finalUrl: page.url() }, completedWalletFlow);
    const forbiddenCalls = await page.evaluate(() => window.__g002ForbiddenCalls ?? []).catch(() => []);
    record(cases, "wallet-port-forbidden-methods", "Wallet connection and SIWE do not invoke transaction/signing methods outside personal_sign", [], forbiddenCalls, forbiddenCalls.length === 0);

    const anonymousEvents = await request.get("/api/events");
    const anonymousRulesets = await request.get("/api/rulesets");
    record(cases, "anonymous-guards", "Anonymous events and rulesets requests are denied", { events: 401, rulesets: 401 }, { events: anonymousEvents.status(), rulesets: anonymousRulesets.status() }, anonymousEvents.status() === 401 && anonymousRulesets.status() === 401);

    const didOnly = await request.post("/api/auth/did/present", { data: { country: "US" } });
    const didOnlyEvents = await request.get("/api/events");
    record(cases, "did-only-events-guard", "DID-only session cannot access events", 401, didOnlyEvents.status(), didOnly.status() === 200 && didOnlyEvents.status() === 401);

    const foreignNonce = await request.post("/api/auth/nonce", { data: { chainId: 1, domain: "attacker.example", uri: "https://attacker.example/login", address: "0x000000000000000000000000000000000000dEaD" } });
    const foreignNonceData = ((await foreignNonce.json()) as { data: Nonce }).data;
    const expectedDomain = "localhost:3100";
    record(cases, "nonce-trusted-origin", "Nonce ignores client-supplied domain, uri, and address", { domain: expectedDomain, uriNot: "https://attacker.example/login" }, { status: foreignNonce.status(), domain: foreignNonceData.domain, uri: foreignNonceData.uri }, foreignNonce.status() === 200 && foreignNonceData.domain === expectedDomain && foreignNonceData.uri !== "https://attacker.example/login" && foreignNonceData.uri.startsWith(`http://${expectedDomain}/`));

    const validNonce = await issueNonce(request);
    const validMessage = siweMessage(validNonce);
    const validSignature = await account.signMessage({ message: validMessage });
    const verify = await request.post("/api/auth/verify", { data: { message: validMessage, signature: validSignature } });
    const replay = await request.post("/api/auth/verify", { data: { message: validMessage, signature: validSignature } });
    const replayBody = (await replay.json()) as { error?: { code?: string } };
    record(cases, "verify-and-replay", "Valid SIWE verifies once; replay is already-consumed", { verify: 200, replay: 422, replayCode: "already-consumed" }, { verify: verify.status(), replay: replay.status(), replayBody }, verify.status() === 200 && replay.status() === 422 && replayBody.error?.code === "already-consumed");

    const mismatchNonce = await issueNonce(request);
    const mismatchMessage = siweMessage(mismatchNonce, { domain: "attacker.example", uri: "https://attacker.example/login" });
    const mismatch = await request.post("/api/auth/verify", { data: { message: mismatchMessage, signature: await account.signMessage({ message: mismatchMessage }) } });
    const mismatchBody = (await mismatch.json()) as { error?: { code?: string } };
    record(cases, "foreign-domain-message", "Foreign-domain signed message is rejected before verification", { status: 422, code: "challenge_mismatch" }, { status: mismatch.status(), code: mismatchBody.error?.code }, mismatch.status() === 422 && mismatchBody.error?.code === "challenge_mismatch");

    const invalidNonce = await issueNonce(request);
    const invalidMessage = siweMessage(invalidNonce);
    const invalidSignature = `0x${"00".repeat(65)}`;
    const invalidVerify = await request.post("/api/auth/verify", { data: { message: invalidMessage, signature: invalidSignature } });
    const consumedAfterInvalid = await request.post("/api/auth/verify", { data: { message: invalidMessage, signature: await account.signMessage({ message: invalidMessage }) } });
    const invalidBody = (await invalidVerify.json()) as { error?: { code?: string } };
    const consumedBody = (await consumedAfterInvalid.json()) as { error?: { code?: string } };
    record(cases, "invalid-signature-consumes-nonce", "Invalid signature is rejected and consumes its nonce", { invalid: 401, retry: 422, retryCode: "already-consumed" }, { invalid: invalidVerify.status(), invalidCode: invalidBody.error?.code, retry: consumedAfterInvalid.status(), retryCode: consumedBody.error?.code }, invalidVerify.status() === 401 && consumedAfterInvalid.status() === 422 && consumedBody.error?.code === "already-consumed");

    const session = await request.get("/api/auth/session");
    const sessionBody = (await session.json()) as { data?: { countryCode?: string; walletAddress?: string; chainId?: number } };
    record(cases, "completed-session", "Verified session preserves DID country and wallet", { countryCode: "US", walletAddress: account.address, chainId: 1 }, { status: session.status(), session: sessionBody.data }, session.status() === 200 && sessionBody.data?.countryCode === "US" && sessionBody.data?.walletAddress?.toLowerCase() === account.address.toLowerCase() && sessionBody.data?.chainId === 1);

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
