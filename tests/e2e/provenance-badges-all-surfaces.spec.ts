import { expect, test } from "@playwright/test";

// 승인 계획 §8 / AC6: mock provenance 배지는 DID·SIWE·대시보드·증명 카드에 각각 노출되며,
// 룰셋 시뮬레이션 표면도 같은 규칙을 따른다.
// 각 assertion을 해당 표면 컨테이너로 한정해 전역 배지 하나로 통과하는 은폐를 막는다.
test.describe.serial("AC6 provenance badges", () => {
  test("shows the mock provenance badge on every mock-backed surface", async ({ page }) => {
    const request = page.context().request;
    const badgeIn = (surface: string) =>
      page.locator(`[data-surface="${surface}"]`).getByTestId("mock-provenance");

    await page.goto("/login");
    await expect(badgeIn("did-login")).toBeVisible();

    await request.post("/api/auth/did/present", { data: { country: "KR" } });
    await page.goto("/connect-wallet");
    await expect(badgeIn("wallet-connect")).toBeVisible();

    await request.post("/api/auth/test-login");
    await page.goto("/dashboard");
    await expect(badgeIn("dashboard-summary")).toBeVisible();

    await page.goto("/export");
    await expect(page.getByText("앵커링 증명")).toBeVisible();
    await expect(badgeIn("anchor-proof")).toBeVisible();

    await page.goto("/tax");
    await expect(badgeIn("tax-simulator")).toBeVisible();
    // 룰셋 결과가 실제로 도착해야 배지 통과가 의미를 갖는다.
    await expect(page.getByText("항목별 확정 상태")).toBeVisible();
  });
});
