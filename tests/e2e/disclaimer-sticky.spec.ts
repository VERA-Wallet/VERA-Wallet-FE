import { expect, test } from "@playwright/test";

// 승인 계획 §9 / AC6: 면책 문구는 5개 route 전부에서 모바일 뷰포트 기준 스크롤 전·후 모두 하단에 고정된다.
const MOBILE = { width: 375, height: 667 };

test.describe.serial("AC6 disclaimer sticky", () => {
  test("keeps the disclaimer pinned on every route at the mobile viewport", async ({ page }) => {
    const request = page.context().request;
    await page.setViewportSize(MOBILE);

    const assertPinned = async (path: string) => {
      await page.goto(path);
      const footer = page.getByTestId("disclaimer-footer");
      await expect(footer).toBeVisible();
      expect(await footer.evaluate((node) => getComputedStyle(node).position)).toBe("sticky");
      await expect(footer).toContainText("세무 대리 또는 세무 상담을 제공하지 않습니다");

      // 스크롤 가능한 길이를 확보해 sticky 동작을 실제로 통과시킨다.
      await page.evaluate(() => {
        const filler = document.createElement("div");
        filler.id = "ac6-scroll-filler";
        filler.style.height = "2400px";
        document.querySelector("main")?.appendChild(filler);
      });

      for (const offset of [0, 1200, 99_999]) {
        await page.evaluate((value) => window.scrollTo(0, value), offset);
        await page.waitForTimeout(60);
        const box = await footer.boundingBox();
        expect(box, `${path} @${offset}`).not.toBeNull();
        expect(box!.y, `${path} @${offset} top`).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height, `${path} @${offset} bottom`).toBeLessThanOrEqual(MOBILE.height);
      }
      await page.evaluate(() => document.querySelector("#ac6-scroll-filler")?.remove());
    };

    await assertPinned("/login");

    await request.post("/api/auth/did/present", { data: { country: "KR" } });
    await assertPinned("/connect-wallet");

    await request.post("/api/auth/test-login");
    await assertPinned("/dashboard");
    await assertPinned("/export");
    await assertPinned("/");
  });
});
