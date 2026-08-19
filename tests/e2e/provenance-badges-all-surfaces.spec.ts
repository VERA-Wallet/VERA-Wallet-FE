import { expect, test } from "@playwright/test";
import { backendOrigin } from "../../lib/api-mode";
import { mkdir, writeFile } from "node:fs/promises";
import { useFreshBackend } from "./support/backend-lifecycle";
import { bootstrapSession } from "./support/bootstrap-be-session";

// 승인 계획 §8 / AC6: mock provenance 배지는 DID·SIWE·대시보드·증명 카드에 각각 노출되며,
// 룰셋 시뮬레이션 표면도 같은 규칙을 따른다.
// 각 assertion을 해당 표면 컨테이너로 한정해 전역 배지 하나로 통과하는 은폐를 막는다.
test.describe.serial("AC6 provenance badges", () => {
// backend URL이 있어도 mock 강제가 켜질 수 있으므로 실제 판정과 같은 helper로 artifact 라벨을 정한다.
const mode = backendOrigin() ? "on" : "off";
const artifactDirectory = "artifacts";
const transcriptPath = `${artifactDirectory}/g003-provenance-${mode}-transcript.json`;

type TranscriptEntry = {
  type: string;
  selector: string;
  status: "passed" | "failed";
  timestamp: string;
};

function recorder() {
  let last = 0;
  const timestamp = () => {
    last = Math.max(last + 1, Date.now());
    return new Date(last).toISOString();
  };
  const actions: TranscriptEntry[] = [];
  const assertions: TranscriptEntry[] = [];
  return {
    actions,
    assertions,
    action(type: string, selector: string) {
      // goto 액션은 검증기가 `url`을 요구한다(어디로 갔는지 없으면 재현할 수 없다).
      actions.push({ type, selector, ...(type === "goto" ? { url: selector } : {}), status: "passed", timestamp: timestamp() });
    },
    assertion(selector: string) {
      assertions.push({ type: "visible-with-mock-label", selector, status: "passed", timestamp: timestamp() });
    },
  };
}
  useFreshBackend();
  test("shows the mock provenance badge on every mock-backed surface", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await mkdir(artifactDirectory, { recursive: true });
    const transcript = recorder();
    const request = page.context().request;
    const badgeIn = (surface: string) =>
      page.locator(`[data-surface="${surface}"]`).getByTestId("mock-provenance");
    const verifyBadge = async (surface: string, screenshot: string) => {
      const badge = badgeIn(surface);
      await expect(badge).toHaveText("mock 데이터");
      transcript.assertion(`[data-surface="${surface}"] [data-testid="mock-provenance"]`);
      // 배지 요소만 잘라내면 24px 띠가 남아 증거로서 맥락이 없다. 배지가 실제로 놓인 화면을 찍는다.
      await page.screenshot({ path: `${artifactDirectory}/g003-provenance-${mode}-${screenshot}.png` });
      transcript.action("screenshot", `[data-surface="${surface}"]`);
    };

    transcript.action("goto", "/login");
    await page.goto("/login");
    await verifyBadge("did-login", "did-login");

    transcript.action("request", "POST /api/auth/did/present");
    await request.post("/api/auth/did/present", { data: { country: "KR" } });
    transcript.action("goto", "/connect-wallet");
    await page.goto("/connect-wallet");
    await verifyBadge("wallet-connect", "connect-wallet");

    await bootstrapSession(page, { privateKey: "0x3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c" });
    transcript.action("goto", "/dashboard");
    await page.goto("/dashboard");
    await verifyBadge("dashboard-summary", "dashboard-view");

    transcript.action("goto", "/export");
    await page.goto("/export");
    await expect(page.getByText("앵커링 증명")).toBeVisible();
    await verifyBadge("anchor-proof", "export-view");

    transcript.action("goto", "/tax");
    await page.goto("/tax");
    await verifyBadge("tax-simulator", "tax-simulator");
    await expect(page.getByText("항목별 확정 상태")).toBeVisible();

    await writeFile(
      transcriptPath,
      // 게이트 검증기는 surface·tool을 요구하고, actions와 assertions를 이어 붙여 시각 단조성을 본다.
      // 그래서 단언 시각은 마지막 액션 이후로 민다(관측 순서와도 일치한다).
      `${JSON.stringify({ schemaVersion: 1, surface: "web", tool: "playwright-chromium", viewport: { width: 430, height: 932 }, actions: transcript.actions, assertions: transcript.assertions.map((assertion, index) => ({ ...assertion, timestamp: new Date(Date.parse(transcript.actions.at(-1)!.timestamp) + index + 1).toISOString() })) }, null, 2)}\n`,
    );
  });
});
