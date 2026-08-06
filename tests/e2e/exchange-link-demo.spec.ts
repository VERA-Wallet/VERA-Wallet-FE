import { expect, test } from "@playwright/test";

/**
 * 거래소 연동은 화면 시연이다. 브라우저 저장소에만 남기 때문에 단위 테스트(주입한 저장소)로는
 * 확인할 수 없는 두 가지를 여기서 본다: 실제 localStorage 왕복과, 온보딩을 넘어간 뒤에도
 * 대시보드가 같은 연동을 말하는지.
 */
test.describe.serial("exchange link demo", () => {
  test("links an exchange on the onboarding screen and carries it to the dashboard", async ({ page }) => {
    const request = page.context().request;
    await request.post("/api/auth/did/present", { data: { country: "KR" } });
    await page.goto("/connect-wallet");

    await page.getByRole("button", { name: "업비트 연동하기" }).click();
    await page.getByLabel("API 키").fill("UPBIT-KEY-1234567890");
    await page.getByLabel("시크릿 키").fill("secret-value");
    await page.getByRole("button", { name: "연동하기", exact: true }).click();

    await expect(page.getByRole("button", { name: "업비트 연동 해제" })).toBeVisible();
    await expect(page.getByText("UPBI••••7890")).toBeVisible();
    // 원문 키가 화면 어디에도 남으면 안 된다.
    expect(await page.locator("body").innerText()).not.toContain("UPBIT-KEY-1234567890");

    await request.post("/api/auth/test-login");
    await page.goto("/dashboard");
    await expect(page.getByRole("region", { name: "연동된 거래소" })).toBeVisible();
    await expect(page.getByText("거래소 연동 1곳")).toBeVisible();
    // 연동 배지만 띄우고 목록이 그대로면 화면이 "가져왔다"고 거짓말한다.
    await expect(page.getByText(/거래소 거래가 아직 들어오지 않습니다/)).toBeVisible();
  });
});
