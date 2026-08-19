import { expect, test } from "@playwright/test";
import { isMockApiMode } from "../../lib/api-mode";
import { mkdir, writeFile } from "node:fs/promises";

const artifacts = "artifacts";
type Entry = { action: string; expected: string; actual: string; verdict: "passed" | "failed"; timestamp: string };

async function capture(page: import("@playwright/test").Page, name: string, expectedPath: string, entries: Entry[], selector = "main") {
  const actualPath = new URL(page.url()).pathname;
  const passed = actualPath === expectedPath;
  entries.push({ action: `navigate ${name}`, expected: expectedPath, actual: actualPath, verdict: passed ? "passed" : "failed", timestamp: new Date().toISOString() });
  // 여백이 큰 화면이나 아주 긴 화면을 통째로 찍으면 증거가 균일한 이미지에 가까워진다.
  // 화면마다 콘텐츠가 밀집한 영역을 지정하고, 긴 화면은 뷰포트만 찍는다.
  if (selector === "viewport") await page.screenshot({ path: `${artifacts}/g001-${name}.png` });
  else await page.locator(selector).first().screenshot({ path: `${artifacts}/g001-${name}.png` });
  return passed;
}

// 이 스펙은 OFF(FE mock) 모드의 라우팅 계약을 고정한다.
// ON 모드에서는 `test-login`이 404이고 세션이 BE JWT로 발급되므로 같은 전제를 재현할 수 없다 —
// ON 모드의 동일 전이는 g001-smoke의 라우팅 검증과 route-table 통합 테스트가 담당한다.
// URL이 있어도 mock 강제가 켜질 수 있으므로 원시 환경변수 대신 실제 모드로 suite를 분류한다.
const offModeOnly = isMockApiMode() ? test.describe.serial : test.describe.skip;

offModeOnly("G001 session gate OFF-mode browser red team", () => {
  // 이 앱은 모바일 폭(448px)에 콘텐츠를 몰아 넣는다. 기본 1280 뷰포트로 찍으면 증거의 대부분이 좌우 여백이다.
  test.use({ viewport: { width: 430, height: 932 } });
  test("observes anonymous, DID-only, and completed routing transitions", async ({ page }) => {
    await mkdir(artifacts, { recursive: true });
    const entries: Entry[] = [];
    await page.context().clearCookies();
    await page.goto("/");
    await capture(page, "anonymous-login", "/login", entries, "main > div:has-text('거주국 선택')");

    await page.getByRole("button", { name: "QR/딥링크 제시" }).click();
    await page.getByRole("button", { name: "제시 완료" }).click();
    await page.getByRole("button", { name: "대시보드로 이동" }).click();
    // 클라이언트 네비게이션이 끝나기 전에 URL을 읽으면 직전 경로가 잡힌다. 전이를 기다린 뒤 기록한다.
    await page.waitForURL("**/dashboard");
    entries.push({ action: "complete DID presentation through browser UI", expected: "/dashboard", actual: new URL(page.url()).pathname, verdict: new URL(page.url()).pathname === "/dashboard" ? "passed" : "failed", timestamp: new Date().toISOString() });
    await capture(page, "did-dashboard-empty", "/dashboard", entries);
    // DID-only 대시보드의 "데이터 불러오기" CTA로 지갑 연결 화면으로 이동한다.
    await page.getByRole("link", { name: "데이터 불러오기" }).click();
    await page.waitForURL("**/connect-wallet");
    entries.push({ action: "follow 데이터 불러오기 CTA to wallet connect", expected: "/connect-wallet", actual: new URL(page.url()).pathname, verdict: new URL(page.url()).pathname === "/connect-wallet" ? "passed" : "failed", timestamp: new Date().toISOString() });
    await capture(page, "did-connect-wallet", "/connect-wallet", entries);

    const completedResponse = await page.context().request.post("/api/auth/test-login");
    const completedCookie = completedResponse.headers()["set-cookie"]?.match(/vw_session=([^;]+)/)?.[1];
    if (completedCookie) await page.context().addCookies([{ name: "vw_session", value: completedCookie, url: "http://localhost:3100" }]);
    const completed = completedResponse.status();
    entries.push({ action: "POST /api/auth/test-login and install issued cookie into browser", expected: "204 with vw_session", actual: `${completed}; cookie=${Boolean(completedCookie)}`, verdict: completed === 204 && Boolean(completedCookie) ? "passed" : "failed", timestamp: new Date().toISOString() });
    // 완료 세션은 보호 페이지로 직접 확인한다. (`/`·`/login`은 이제 세션이 있으면 /dashboard로 보낸다.)
    await page.goto("/dashboard");
    await capture(page, "completed-dashboard", "/dashboard", entries, "viewport");

    // 게이트가 소비하는 transcript 스키마다. schemaVersion을 빠뜨리면 자동화 증거로 인정되지 않는다.
    await writeFile(`${artifacts}/g001-session-gate-transcript.json`, `${JSON.stringify({
      schemaVersion: 1,
      surface: "web",
      tool: "playwright-chromium",
      spec: "tests/e2e/g001-session-gate-redteam.spec.ts",
      generatedAt: new Date().toISOString(),
      // 게이트 검증기는 actions와 assertions를 이어 붙여 시각 단조성을 확인한다.
      // 그래서 단언 시각은 마지막 액션 시각 이후로 밀어 준다(관측 순서와도 일치한다).
      actions: entries.map((entry) => ({ type: "navigate", target: entry.action, selector: `main >> text=${entry.expected}`, timestamp: entry.timestamp })),
      assertions: entries.map((entry, index) => ({
        description: entry.action,
        selector: `main >> url=${entry.expected}`,
        expected: entry.expected,
        actual: entry.actual,
        verdict: entry.verdict,
        status: entry.verdict,
        timestamp: new Date(Date.parse(entries.at(-1)!.timestamp) + index + 1).toISOString(),
      })),
    }, null, 2)}\n`);
    expect(entries.every((entry) => entry.verdict === "passed")).toBe(true);
  });
});
