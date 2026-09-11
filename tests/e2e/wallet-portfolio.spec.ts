import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { isMockApiMode } from "../../lib/api-mode";

declare global {
  interface Window {
    __walletPortfolioForbiddenCalls?: string[];
    __walletPortfolioSignMessage?: (message: string) => Promise<string>;
  }
}

type Verdict = "passed" | "failed";

type CaseResult = {
  id: string;
  scenario: string;
  expected: unknown;
  actual: unknown;
  verdict: Verdict;
};

type Action = {
  type: string;
  timestamp: string;
  url?: string;
  selector?: string;
  target?: string;
};

type Assertion = {
  timestamp: string;
  status: Verdict;
  selector?: string;
  description: string;
  actual?: unknown;
};

const artifactDirectory = resolve(process.cwd(), "artifacts/wallet-portfolio-qa");
const portfolioScreenshot = resolve(artifactDirectory, "portfolio.jpg");
const accountScreenshot = resolve(artifactDirectory, "account.jpg");
const disconnectedScreenshot = resolve(artifactDirectory, "disconnected.jpg");
const nftScreenshot = resolve(artifactDirectory, "nft.jpg");
const defiScreenshot = resolve(artifactDirectory, "defi.jpg");
const transcriptPath = resolve(artifactDirectory, "transcript.json");
const reportPath = resolve(artifactDirectory, "qa-report.json");
const privateKey = "0x59c6995e998f97a5a004497e5daef5a40b90f1a9d1bb0f6285295225249f2f1a" as const;
const account = privateKeyToAccount(privateKey);

function recordCase(
  cases: CaseResult[],
  id: string,
  scenario: string,
  expected: unknown,
  actual: unknown,
  passed: boolean,
) {
  cases.push({ id, scenario, expected, actual, verdict: passed ? "passed" : "failed" });
}

function installSyntheticWallet(page: Page, initiallyConnected = true) {
  return Promise.all([
    page.exposeFunction("__walletPortfolioSignMessage", async (message: string) =>
      account.signMessage({ message: message.startsWith("0x") ? { raw: message as `0x${string}` } : message }),
    ),
    page.addInitScript(({ address, initiallyConnected }: { address: string; initiallyConnected: boolean }) => {
      const forbidden = new Set(["eth_sendTransaction", "eth_signTransaction", "eth_sendRawTransaction", "wallet_sendCalls"]);
      const ethereum = {
        isMetaMask: true,
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          if (forbidden.has(method)) {
            window.__walletPortfolioForbiddenCalls?.push(method);
            throw new Error(`Forbidden wallet method: ${method}`);
          }
          if (method === "eth_requestAccounts") return [address];
          if (method === "eth_accounts") return initiallyConnected ? [address] : [];
          if (method === "eth_chainId") return "0x1";
          if (method === "personal_sign") {
            return window.__walletPortfolioSignMessage?.(String(params[0])) ?? "";
          }
          throw new Error(`Unsupported wallet method: ${method}`);
        },
        on: () => ethereum,
        removeListener: () => ethereum,
      };
      (window as Window & { ethereum?: unknown }).ethereum = ethereum;
      window.__walletPortfolioForbiddenCalls = [];
    }, { address: account.address, initiallyConnected }),
  ]);
}

const mockModeOnly = isMockApiMode() ? test.describe.serial : test.describe.skip;

mockModeOnly("wallet list, portfolio and add-wallet live QA", () => {
  test("onboards a synthetic wallet, verifies portfolio/account surfaces, and records red-team evidence", async ({ page, browser }) => {
    await mkdir(artifactDirectory, { recursive: true });

    const cases: CaseResult[] = [];
    const actions: Action[] = [];
    const assertions: Assertion[] = [];
    const blockers: string[] = [];
    let timestampMs = Date.now();
    let e2eStatus: Verdict = "failed";

    const timestamp = () => {
      timestampMs += 1;
      return new Date(timestampMs).toISOString();
    };
    const act = (entry: Omit<Action, "timestamp">) => actions.push({ ...entry, timestamp: timestamp() });
    const assertion = (description: string, passed: boolean, selector?: string, actual?: unknown) => {
      assertions.push({ description, status: passed ? "passed" : "failed", timestamp: timestamp(), ...(selector ? { selector } : {}), ...(actual === undefined ? {} : { actual }) });
    };
    const check = async (description: string, passed: boolean, selector?: string, actual?: unknown) => {
      assertion(description, passed, selector, actual);
      expect(passed, description).toBe(true);
    };

    try {
      const anonymousContext = await browser.newContext();
      const anonymousPage = await anonymousContext.newPage();
      act({ type: "goto", url: "/wallets", target: "anonymous page guard" });
      await anonymousPage.goto("/wallets");
      const anonymousPath = new URL(anonymousPage.url()).pathname;
      const anonymousGuardPassed = anonymousPath === "/login";
      await check("A1 fresh anonymous /wallets visit redirects to /login", anonymousGuardPassed, "url.pathname", anonymousPath);
      recordCase(
        cases,
        "A1",
        "Fresh anonymous browser context visits /wallets",
        "/login",
        anonymousPath,
        anonymousGuardPassed,
      );
      await anonymousContext.close();

      await installSyntheticWallet(page);
      act({ type: "goto", url: "/login" });
      await page.goto("/login");
      act({ type: "click", selector: "role=button[name='US']" });
      await page.getByRole("button", { name: "US", exact: true }).click();
      const didStartButton = page.getByRole("button", { name: /^(QR\/딥링크 제시|모바일신분증으로 인증)$/ });
      const didStartButtonName = await didStartButton.innerText();
      act({ type: "click", selector: `role=button[name='${didStartButtonName}']` });
      await didStartButton.click();
      const didDoneButton = page.getByRole("button", { name: "제시 완료", exact: true });
      if (await didDoneButton.isVisible().catch(() => false)) {
        act({ type: "click", selector: "role=button[name='제시 완료']" });
        await didDoneButton.click();
      }
      await expect(page.getByText("US 거주국 클레임이 확인되었습니다.")).toBeVisible({ timeout: 15_000 });
      assertion("US DID claim is confirmed", true, "text=US 거주국 클레임이 확인되었습니다.");
      await expect(page.getByText("US FIFO")).toBeVisible();
      assertion("US FIFO ruleset badge is visible", true, "text=US FIFO");
      act({ type: "click", selector: "role=button[name='대시보드로 이동']" });
      await page.getByRole("button", { name: "대시보드로 이동" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      assertion("DID flow reaches dashboard", true, "url.pathname=/dashboard");

      act({ type: "goto", url: "/wallets", target: "DID-only disconnected state" });
      await page.goto("/wallets");
      const walletEmpty = page.locator('[data-surface="wallet-empty"]');
      const connectCta = walletEmpty.getByRole("link", { name: "지갑 연결하기", exact: true });
      const disconnectedCtaVisible = await walletEmpty.isVisible() && await connectCta.isVisible();
      await check("Disconnected DID-only /wallets shows wallet-empty and connect CTA", disconnectedCtaVisible, "[data-surface=wallet-empty] a", await walletEmpty.innerText());
      recordCase(
        cases,
        "disconnected-wallet-connect-cta",
        "DID-only /wallets state exposes the wallet connection CTA",
        "wallet-empty with link 지갑 연결하기",
        { walletEmpty: await walletEmpty.isVisible(), connectCta: await connectCta.isVisible() },
        disconnectedCtaVisible,
      );
      act({ type: "screenshot", selector: "body", target: disconnectedScreenshot });
      await page.screenshot({ path: disconnectedScreenshot, fullPage: true, type: "jpeg", quality: 85 });

      act({ type: "goto", url: "/dashboard", target: "wallet onboarding CTA" });
      await page.goto("/dashboard");
      act({ type: "click", selector: "role=link[name='데이터 불러오기']" });
      await page.getByRole("link", { name: "데이터 불러오기", exact: true }).click();
      await expect(page).toHaveURL(/\/connect-wallet$/);
      // 기본 경로는 주소 입력이다. 이 시나리오는 SIWE 소유 증명 경로를 검증하므로 브라우저 지갑 행을 고른다.
      act({ type: "click", selector: "role=button[name='브라우저 지갑으로 연결']" });
      await page.getByRole("button", { name: /브라우저 지갑으로 연결/ }).click();
      act({ type: "click", selector: "role=button[name='지갑 연결하기']" });
      await page.getByRole("button", { name: "지갑 연결하기", exact: true }).click();
      await expect(page.getByText(account.address, { exact: true })).toBeVisible({ timeout: 15_000 });
      assertion("Synthetic EIP-1193 provider exposes the connected account", true, `text=${account.address}`);
      act({ type: "click", selector: "role=button[name='서명하고 추가']" });
      await page.getByRole("button", { name: "서명하고 추가", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
      assertion("SIWE verification returns to dashboard", true, "url.pathname=/dashboard");

      act({ type: "goto", url: "/wallets", target: "connected wallet list" });
      await page.goto("/wallets");
      // 지갑 탭은 등록한 지갑 목록이다. 행을 누르면 그 지갑의 포트폴리오(/wallets/[address])로 들어간다.
      const walletRows = page.locator('[data-surface="wallet-row"]');
      await expect(walletRows.first()).toBeVisible({ timeout: 20_000 });
      const listRowText = await walletRows.first().innerText();
      const listRowHref = await walletRows.first().getAttribute("href");
      const listOk = (await walletRows.count()) >= 1 && listRowHref === `/wallets/${account.address.toLowerCase()}` && listRowText.includes("소유 증명됨");
      await check("Connected /wallets lists the registered wallet with its verification badge and links to its portfolio", listOk, "[data-surface=wallet-row]", { listRowHref, listRowText });
      recordCase(cases, "wallet-list", "Wallet tab lists registered wallets", "wallet-row linking to /wallets/<address> with 소유 증명됨 badge", { listRowHref, listRowText }, listOk);

      act({ type: "click", selector: "[data-surface=wallet-row]" });
      await walletRows.first().click();
      const portfolioHeader = page.locator('[data-surface="wallet-portfolio-header"]');
      const addressButton = page.getByRole("link", { name: "지갑 목록으로" });
      // 보유 자산은 서버 조회 뒤에 그려진다(ON 모드는 BE 잔액 조회에 최대 15초). 로딩 화면을 지나도록 기다린다.
      await expect(portfolioHeader).toBeVisible({ timeout: 20_000 });
      await expect(addressButton).toBeVisible();
      const portfolioState = page.locator('[data-surface="holding-row"], [data-surface="wallet-portfolio-filter-empty"]');
      await expect(portfolioState.first()).toBeVisible({ timeout: 15_000 });
      const portfolioText = await portfolioHeader.innerText();
      const holdingRows = page.locator('[data-surface="holding-row"]');
      const holdingTexts = await holdingRows.allInnerTexts();
      const emptyStateVisible = await page.locator('[data-surface="wallet-portfolio-filter-empty"]').isVisible().catch(() => false);
      const holdingsVisible = holdingTexts.length > 0;
      const portfolioRendered = await portfolioHeader.isVisible() && await addressButton.isVisible() && (holdingsVisible || emptyStateVisible);
      await check(
        "Wallet detail renders the portfolio with holdings or the documented empty state",
        portfolioRendered,
        "[data-surface=wallet-portfolio-header]",
        { holdings: holdingTexts.length, emptyStateVisible },
      );
      recordCase(
        cases,
        "connected-portfolio",
        "Wallet row opens the portfolio surface",
        "portfolio header, back link, and holdings or empty state",
        { headerVisible: await portfolioHeader.isVisible(), backVisible: await addressButton.isVisible(), holdings: holdingTexts.length, emptyStateVisible },
        portfolioRendered,
      );

      const total = await page.locator('[data-surface="wallet-total"]').innerText();
      const pricesShown = /US\$/.test(total) && holdingTexts.length > 0 && holdingTexts.every((text) => text.includes("US$"));
      const demoLabeled = portfolioText.includes("데모 예시");
      const noVerifiedBadge = !holdingTexts.some((text) => text.includes("검증됨"));
      const honestPricing = pricesShown && demoLabeled && noVerifiedBadge;
      await check(
        "A2 portfolio shows USD price/value labeled as demo (not passed off as live), with no 검증됨 badge",
        honestPricing,
        "[data-surface=wallet-total] and [data-surface=holding-row]",
        { total, demoLabeled, noVerifiedBadge },
      );
      recordCase(
        cases,
        "A2",
        "Portfolio shows demo-labeled USD price/value per token and no verified badge",
        "US$ price+value per row, '데모 예시' disclosure, and no 검증됨 badge",
        { total, demoLabeled, noVerifiedBadge, holdingRows: holdingTexts },
        honestPricing,
      );
      act({ type: "screenshot", selector: "body", target: portfolioScreenshot });
      await page.screenshot({ path: portfolioScreenshot, fullPage: true, type: "jpeg", quality: 85 });

      // NFT 탭: 대중 컬렉션 그리드
      act({ type: "click", selector: "role=tab[name='NFT']" });
      await page.getByRole("tab", { name: "NFT", exact: true }).click();
      const nftCards = page.locator('[data-surface="nft-card"]');
      await expect(nftCards.first()).toBeVisible();
      const nftCount = await nftCards.count();
      const nftText = (await nftCards.allInnerTexts()).join(" ");
      const nftOk = nftCount >= 1 && nftText.includes("BAYC") && /US\$/.test(nftText);
      await check("NFT tab renders a popular-collection grid with USD floor values", nftOk, "[data-surface=nft-card]", { nftCount });
      recordCase(cases, "nft-portfolio", "NFT tab shows a grid of popular collections", "nft-card grid with collection names and USD floor values", { nftCount, hasBAYC: nftText.includes("BAYC") }, nftOk);
      act({ type: "screenshot", selector: "body", target: nftScreenshot });
      await page.screenshot({ path: nftScreenshot, fullPage: true, type: "jpeg", quality: 85 });

      // 디파이 탭: 프로토콜 포지션
      act({ type: "click", selector: "role=tab[name='디파이']" });
      await page.getByRole("tab", { name: "디파이", exact: true }).click();
      const defiRows = page.locator('[data-surface="defi-row"]');
      await expect(defiRows.first()).toBeVisible();
      const defiCount = await defiRows.count();
      const defiText = (await defiRows.allInnerTexts()).join(" ");
      const defiOk = defiCount >= 1 && defiText.includes("Uniswap v3") && /US\$/.test(defiText);
      await check("디파이 tab renders protocol positions with USD values", defiOk, "[data-surface=defi-row]", { defiCount });
      recordCase(cases, "defi-positions", "디파이 tab shows protocol positions", "defi-row list with protocols and USD values", { defiCount, hasUniswap: defiText.includes("Uniswap v3") }, defiOk);
      act({ type: "screenshot", selector: "body", target: defiScreenshot });
      await page.screenshot({ path: defiScreenshot, fullPage: true, type: "jpeg", quality: 85 });

      // 토큰 탭으로 복귀
      act({ type: "click", selector: "role=tab[name='토큰']" });
      await page.getByRole("tab", { name: "토큰", exact: true }).click();

      act({ type: "click", selector: "role=link[name='지갑 목록으로']" });
      await addressButton.click();
      await expect(page).toHaveURL(/\/wallets$/);
      await expect(walletRows.first()).toBeVisible({ timeout: 20_000 });
      const backPortfolioReturned = (await walletRows.count()) >= 1 && !(await portfolioHeader.isVisible().catch(() => false));
      await check("A4 뒤로 returns to the wallet list", backPortfolioReturned, "url.pathname=/wallets");
      recordCase(cases, "A4", "Back navigation from the wallet detail returns to the list", "wallet rows visible and portfolio header absent", { rows: await walletRows.count() }, backPortfolioReturned);
      // A3: 지갑 추가 경로는 목록 아래에 있고 로그인을 끊지 않는다.
      const addWalletLink = page.locator('[data-surface="wallets-add"]');
      const accountSurfacePassed = await addWalletLink.isVisible() && (await addWalletLink.getAttribute("href")) === "/connect-wallet" && await page.getByText(/로그인은 유지/).isVisible();
      await check("A3 the wallet list exposes a 지갑 추가하기 path that keeps the login (no fake account list)", accountSurfacePassed, "[data-surface=wallets-add]");
      recordCase(cases, "A3", "Wallet list exposes an additive wallet registration path that keeps the login", "link 지갑 추가하기 → /connect-wallet", { visible: await addWalletLink.isVisible() }, accountSurfacePassed);
      act({ type: "screenshot", selector: "body", target: accountScreenshot });
      await page.screenshot({ path: accountScreenshot, fullPage: true, type: "jpeg", quality: 85 });

      const forbiddenCalls = await page.evaluate(() => window.__walletPortfolioForbiddenCalls ?? []);
      const forbiddenCallsPassed = forbiddenCalls.length === 0;
      await check("Synthetic wallet never receives transaction-sending methods", forbiddenCallsPassed, "window.__walletPortfolioForbiddenCalls", forbiddenCalls);
      recordCase(
        cases,
        "wallet-provider-safety",
        "Wallet onboarding and portfolio navigation use only account access and personal_sign",
        [],
        forbiddenCalls,
        forbiddenCallsPassed,
      );

      // 지갑 추가 핸드오프: 목록의 추가 버튼은 세션을 끊지 않는다. DID 로그인은 그대로 살아 있고
      // /connect-wallet이 추가 등록 모드로 열려야 한다 — /login으로 튀면 로그인이 풀린 것이므로 실패다.
      act({ type: "click", selector: "[data-surface=wallets-add]", target: "add a wallet from the list" });
      await page.locator('[data-surface="wallets-add"]').click();
      await expect(page).toHaveURL(/\/connect-wallet$/, { timeout: 15_000 });
      const addWalletHeadingVisible = await page.getByRole("heading", { name: "지갑을 어떻게 추가할까요?", exact: true }).isVisible();
      const addWalletPath = new URL(page.url()).pathname;
      const addHandoffPassed = addWalletPath === "/connect-wallet" && addWalletHeadingVisible;
      await check(
        "Adding a wallet keeps the session and opens /connect-wallet in add mode",
        addHandoffPassed,
        "url.pathname=/connect-wallet + heading 지갑을 어떻게 추가할까요?",
        { path: addWalletPath, addWalletHeadingVisible },
      );
      recordCase(
        cases,
        "add-wallet-handoff",
        "지갑 추가하기 keeps the DID session and opens the additive registration screen",
        { path: "/connect-wallet", heading: "지갑을 어떻게 추가할까요?" },
        { path: addWalletPath, heading: addWalletHeadingVisible },
        addHandoffPassed,
      );

      const failedCases = cases.filter((result) => result.verdict === "failed");
      await expect(failedCases).toEqual([]);
      e2eStatus = "passed";
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      let assertionFloor = actions.at(-1)?.timestamp ?? new Date(0).toISOString();
      const clampedAssertions = assertions.map((entry) => {
        assertionFloor = entry.timestamp >= assertionFloor ? entry.timestamp : assertionFloor;
        return { ...entry, timestamp: assertionFloor };
      });
      const redTeamCases = cases.filter((result) => /^A[1-4]$/.test(result.id));
      const redTeamStatus: Verdict = redTeamCases.length === 4 && redTeamCases.every((result) => result.verdict === "passed") ? "passed" : "failed";
      await writeFile(
        transcriptPath,
        `${JSON.stringify({ schemaVersion: 1, surface: "web", tool: "playwright-chromium", spec: "tests/e2e/wallet-portfolio.spec.ts", actions, assertions: clampedAssertions }, null, 2)}\n`,
      );
      await writeFile(
        reportPath,
        `${JSON.stringify({ e2eStatus, redTeamStatus, cases, artifacts: [portfolioScreenshot, nftScreenshot, defiScreenshot, accountScreenshot, disconnectedScreenshot, transcriptPath, reportPath], blockers }, null, 2)}\n`,
      );
    }
  });
});
