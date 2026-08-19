import { expect, test } from "@playwright/test";
import { useFreshBackend } from "./support/backend-lifecycle";

/**
 * 거래소 연동은 MVP에서 "곧 지원"이다. 실제 연동 파이프라인(조회 전용 키/OAuth 정규화)은 아직 없으므로,
 * 지갑 연결 화면이 지원 예정 거래소를 안내만 하고 되는 척하는 입력/버튼을 두지 않는지 확인한다.
 * 데이터를 실제로 불러오는 경로는 지금은 지갑(EOA) 연결뿐이다.
 */
test.describe.serial("exchange coming soon", () => {
  useFreshBackend();
  test("shows the coming-soon exchange panel without any linking inputs", async ({ page }) => {
    const request = page.context().request;
    await request.post("/api/auth/did/present", { data: { country: "KR" } });
    await page.goto("/connect-wallet");

    const panel = page.locator('[data-surface="exchange-coming-soon"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText("거래소 계정 연동")).toBeVisible();
    await expect(panel.getByText("곧 지원")).toBeVisible();
    // 지원 예정 거래소는 이름만 흐리게 보인다.
    await expect(panel.getByText("업비트")).toBeVisible();
    // 되는 척하는 연동 버튼·입력은 없어야 한다.
    await expect(page.getByRole("button", { name: "업비트 연동하기" })).toHaveCount(0);
    await expect(page.getByLabel("API 키")).toHaveCount(0);
  });
});
