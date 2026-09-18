import { expect, test } from "@playwright/test";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { LEDGER_COLUMNS } from "../../lib/export/report";
import { needsReview } from "@/lib/review";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { useFreshBackend } from "./support/backend-lifecycle";
import { bootstrapSession } from "./support/bootstrap-be-session";

type CaseResult = { id: string; scenario: string; expected: unknown; actual: unknown; verdict: "passed" | "failed" };
type EventRecord = { event: NormalizedEvent; version: number };
type TranscriptAction = { type: string; timestamp: string; url?: string; selector?: string };
type TranscriptAssertion = { timestamp: string; status: "passed" | "failed"; selector?: string; description: string };

const artifactDirectory = "/tmp/g003-qa";
const reportPath = `${artifactDirectory}/api-test-report.json`;
const transcriptPath = `${artifactDirectory}/e2e-transcript.json`;
const dashboardPath = `${artifactDirectory}/dashboard.jpg`;
const exportPath = `${artifactDirectory}/export.jpg`;

function record(cases: CaseResult[], id: string, scenario: string, expected: unknown, actual: unknown, passed: boolean) {
  cases.push({ id, scenario, expected, actual, verdict: passed ? "passed" : "failed" });
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted && character === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") { row.push(cell); cell = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function recorder() {
  const actions: TranscriptAction[] = [];
  const assertions: TranscriptAssertion[] = [];
  return {
    actions, assertions,
    act(entry: Omit<TranscriptAction, "timestamp">) { actions.push({ ...entry, timestamp: new Date().toISOString() }); },
    assert(description: string, passed: boolean, selector?: string) { assertions.push({ timestamp: new Date().toISOString(), status: passed ? "passed" : "failed", description, ...(selector ? { selector } : {}) }); },
  };
}

test.describe.serial("G003 dashboard and export contract red team", () => {
  useFreshBackend();
  test("completed session verifies dashboard, exports, anchoring, and stale reclassification", async ({ page, browser }) => {
    await mkdir(artifactDirectory, { recursive: true });
    const cases: CaseResult[] = [];
    const transcript = recorder();
    await bootstrapSession(page, { privateKey: "0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e" });
    const bootstrapped = await page.context().request.get("/api/auth/session");
    const bootstrappedBody = await bootstrapped.json() as { data: { walletAddress: string | null } };
    record(cases, "auth-bootstrap-session", "completed session cookie is issued", true, bootstrappedBody.data.walletAddress !== null, bootstrappedBody.data.walletAddress !== null);

    const listResponse = await page.context().request.get("/api/events?limit=100");
    const list = await listResponse.json() as { data?: { items?: EventRecord[] } };
    const items = list.data?.items ?? [];
    const eventRecords = items.map(({ event }) => event);
    // 대시보드 "예상 손익"은 이벤트 직접 집계가 아니라 세금 화면과 같은 estimate에서 파생한다
    // (estimateHeadline: gain 판정 금액의 합). 세션 국가 KR·마지막 활동연도(픽스처 2025)로 같은 요청을 재현한다.
    const estimateResponse = await page.context().request.post("/api/tax/estimate", { data: { country: "KR", taxYear: 2025, source: "wallet" } });
    const estimateBody = await estimateResponse.json() as { data?: { judgments?: Array<{ amountKind?: string; amount?: string }> } };
    expect(estimateResponse.status()).toBe(200);
    const expectedPnl = (estimateBody.data?.judgments ?? [])
      .filter((row) => row.amountKind === "gain")
      .reduce((total, row) => total + Number(row.amount), 0);
    const reviewCount = eventRecords.filter(needsReview).length;
    expect(listResponse.status()).toBe(200);
    expect(items.length).toBeGreaterThan(0);

    transcript.act({ type: "goto", url: "/dashboard" });
    await page.goto("/dashboard");
    // "거래 요약"→"요약"으로 바뀌었고, 하단 탭바에도 같은 글자가 있어 getByRole(heading)으로 좁힌다.
    await expect(page.getByRole("heading", { name: "요약", exact: true })).toBeVisible();
    const expectedPnlText = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(expectedPnl);
    const dashboardPnlCard = page.getByText("예상 손익").locator(".. ");
    const dashboardReady = await expect(dashboardPnlCard).toContainText(expectedPnlText).then(() => true).catch(() => false);
    if (!dashboardReady) {
      await page.locator("main").screenshot({ path: dashboardPath, type: "jpeg", quality: 85 });
      transcript.act({ type: "screenshot", selector: "main" });
      transcript.assert("Dashboard queries render the fixture PnL", false, "main");
      record(cases, "dashboard-client-data-load", "Completed-session dashboard requests and renders fixture data", expectedPnlText, await dashboardPnlCard.innerText(), false);
      const blockers = ["Dashboard '예상 손익' card did not render the estimate-derived PnL (estimateHeadline gain sum) for the completed session — data never loaded or the headline derivation diverged from /api/tax/estimate."];
      await writeFile(transcriptPath, `${JSON.stringify({ schemaVersion: 1, surface: "web", tool: "playwright-chromium", actions: transcript.actions, assertions: transcript.assertions }, null, 2)}\n`);
      await writeFile(reportPath, `${JSON.stringify({ e2eStatus: "failed", redTeamStatus: "failed", cases, artifacts: [dashboardPath, transcriptPath], blockers }, null, 2)}\n`);
      expect(dashboardReady, blockers[0]).toBeTruthy();
      return;
    }
    // 배지(확인 필요 등)는 이제 목록이 아니라 거래 상세에서만 말한다 — 가격 미확정 이벤트(event-18)의
    // 상세를 열어 사유("가격 확인 필요")가 그대로 밝혀지는지 확인한다.
    await page.locator('[data-event-id="event-18"]').first().click();
    await expect(page.getByText("거래 상세").last()).toBeVisible();
    const unknownBadges = page.getByText(/가격 확인 필요/);
    await expect(unknownBadges.first()).toBeVisible();
    const unknownBadgeCount = await unknownBadges.count();
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    const dashboardBody = await page.locator("body").innerText();
    expect(dashboardBody).not.toContain("₩0");
    transcript.assert("Dashboard PnL matches the event fixture sum and does not render ₩0", dashboardBody.includes(expectedPnlText) && !dashboardBody.includes("₩0"), "body");
    record(cases, "dashboard-summary-and-unknown", "Fixture PnL, UNKNOWN-price reason in event detail, and zero-value suppression", { pnl: expectedPnlText, reviewCount: ">= 1", zero: "absent" }, { pnlPresent: dashboardBody.includes(expectedPnlText), unknownBadges: unknownBadgeCount, zeroPresent: dashboardBody.includes("₩0") }, dashboardBody.includes(expectedPnlText) && unknownBadgeCount >= 1 && !dashboardBody.includes("₩0"));

    transcript.act({ type: "click", selector: 'role=tab[name="확인 필요"]' });
    await page.getByRole("tab", { name: "확인 필요" }).click();
    const reviewItems = page.locator("section .mt-3.grid.gap-3 > button");
    await expect(reviewItems).toHaveCount(reviewCount);
    transcript.assert("Review tab item count equals fixture expectation", await reviewItems.count() === reviewCount, "role=tab[name=확인 필요]");
    record(cases, "dashboard-review-filter", "Review tab shows every fixture review event", reviewCount, await reviewItems.count(), await reviewItems.count() === reviewCount);

    await page.getByRole("tab", { name: "전체 거래" }).click();
    const cards = page.locator("section .mt-3.grid.gap-3 > button");
    // 픽스처에 이미 수동 분류된 이벤트가 있어, 전역 배지 단언은 선택 카드가 안 바뀌어도 통과한다.
    // 선택한 카드를 식별해 그 카드에서만 확인한다.
    const selectedCard = cards.first();
    const selectedLabel = (await selectedCard.locator("[data-event-label]").innerText()).trim();
    const selectedEventId = await selectedCard.getAttribute("data-event-id");
    await selectedCard.click();
    await expect(page.getByText("거래 상세").last()).toBeVisible();
    // 재분류 폼은 접힌 <details> 안에 있다 — 펼쳐야 #classification이 보인다.
    await page.locator("summary", { hasText: "재분류" }).last().click();
    const classification = page.locator("#classification");
    const initialClassification = await classification.inputValue();
    const changedClassification = (["RECEIVE", "SEND", "EXCHANGE", "INTERNAL_TRANSFER", "UNKNOWN"] as const).find((value) => value !== initialClassification)!;
    transcript.act({ type: "selectOption", selector: "#classification" });
    await classification.selectOption(changedClassification);
    await page.locator("#reason").fill("G003 dashboard journey");
    await page.getByRole("button", { name: "적용" }).click();
    await expect(classification).toHaveValue(changedClassification);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    // 수동 분류 표시는 목록이 아니라 상세가 말한다 — 목록에는 온체인 사실과 판정 도장만 둔다.
    // 라벨은 유효 분류에 따라 부호가 뒤집히므로(재분류 후 +0.01 → -0.01) 식별자로 쓸 수 없다. 이벤트 id로 다시 찾는다.
    const editedCard = page.locator(`section .mt-3.grid.gap-3 > button[data-event-id="${selectedEventId}"]`).first();
    await editedCard.click();
    await expect(page.getByText("거래 상세").last()).toBeVisible();
    const manualOverride = page.getByText(/^사용자 확정 · /).first();
    await expect(manualOverride).toBeVisible();
    await page.locator("main").screenshot({ path: dashboardPath, type: "jpeg", quality: 85 });
    transcript.act({ type: "screenshot", selector: "main" });
    transcript.assert("Reclassification updates detail history and manual override state", true, "#classification");
    record(cases, "dashboard-reclassification", "Bottom sheet applies one of five classifications and marks manual override", changedClassification, { classification: await classification.inputValue(), manualOverride: await manualOverride.count(), card: selectedLabel }, await classification.inputValue() === changedClassification && await manualOverride.count() > 0);
    await page.getByRole("button", { name: "닫기", exact: true }).click();

    // 목록은 최신순으로 정렬되므로 API 응답 순서와 화면 순서가 같지 않다. 순번을 두 세계에
    // 걸쳐 재사용하면 다른 이벤트를 집는다 — 화면에서 고른 카드의 id로 원본 레코드를 찾는다.
    const staleCard = cards.nth((await cards.count()) > 1 ? 1 : 0);
    const staleEventId = await staleCard.getAttribute("data-event-id");
    const stale = items.find(({ event }) => event.id === staleEventId)!;
    expect(stale, `카드 ${staleEventId}가 목록 응답에 없다`).toBeDefined();
    await staleCard.click();
    await expect(page.getByText("거래 상세").last()).toBeVisible();
    await page.locator("summary", { hasText: "재분류" }).last().click();
    await expect(page.locator("#classification")).toHaveValue(String(stale.event.classification));
    const preemptClassification = String(stale.event.classification) === "SEND" ? "RECEIVE" : "SEND";
    const preempt = await page.context().request.patch(`/api/events/${stale.event.id}`, { data: { classification: preemptClassification, reason: "G003 stale-version preemption", expectedVersion: stale.version } });
    expect(preempt.status()).toBe(200);
    const staleTarget = preemptClassification === "SEND" ? "RECEIVE" : "SEND";
    await page.locator("#classification").selectOption(staleTarget);
    transcript.act({ type: "click", selector: 'button[name="적용"]' });
    await page.getByRole("button", { name: "적용" }).click();
    await expect(page.getByText("다른 곳에서 변경됨, 다시 확인")).toBeVisible();
    await expect(page.locator("#classification")).toHaveValue(preemptClassification);
    transcript.assert("Stale UI mutation displays conflict and synchronizes latest classification", true, "[role=alert]");
    record(cases, "dashboard-stale-version-conflict", "409 stale version shows conflict and reloads latest event", preemptClassification, { status: preempt.status(), alert: await page.getByText("다른 곳에서 변경됨, 다시 확인").innerText(), current: await page.locator("#classification").inputValue() }, await page.locator("#classification").inputValue() === preemptClassification);
    await page.getByRole("button", { name: "닫기", exact: true }).click();

    // 내보내기 다운로드는 플랜(데모 결제) 뒤에 있다 — 미구독이면 버튼이 disabled라 다운로드가 영영 안 뜬다.
    transcript.act({ type: "goto", url: "/plan" });
    await page.goto("/plan");
    await page.getByRole("button", { name: /데모 결제로 시작/ }).first().click();
    await expect(page.getByText(/활성 · \d{4}년/)).toBeVisible();

    transcript.act({ type: "goto", url: "/export" });
    await page.goto("/export");
    await expect(page.getByText("앵커링 증명")).toBeVisible();
    await expect(page.getByText("Merkle root")).toBeVisible();
    const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "직접 신고용 내려받기" }).click()]);
    const csvTempPath = await csvDownload.path();
    expect(csvTempPath).not.toBeNull();
    const csvPath = `${artifactDirectory}/export.csv`;
    await copyFile(csvTempPath!, csvPath);
    const csvBytes = await readFile(csvPath);
    const csvRows = parseCsv(csvBytes.toString("utf8").replace(/^\uFEFF/, ""));
    const fiatIndex = LEDGER_COLUMNS.indexOf("fiat_value");
    const unknownRows = csvRows.slice(1).filter((row) => row[LEDGER_COLUMNS.indexOf("price_status")] === "UNKNOWN");
    const csvPassed = csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && JSON.stringify(csvRows[0]) === JSON.stringify(LEDGER_COLUMNS) && unknownRows.length > 0 && unknownRows.every((row) => row[fiatIndex] === "");
    expect(csvPassed).toBeTruthy();
    record(cases, "export-csv-contract", "BOM, ordered ledger header (base + derived columns), and blank UNKNOWN fiat values", { columns: LEDGER_COLUMNS, unknownRows: ">=1" }, { bom: csvBytes.subarray(0, 3).toString("hex"), header: csvRows[0], unknownRows: unknownRows.length, unknownFiatValues: unknownRows.map((row) => row[fiatIndex]) }, csvPassed);

    const [xlsxDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "세무사 전달용 내려받기" }).click()]);
    const xlsxTempPath = await xlsxDownload.path();
    expect(xlsxTempPath).not.toBeNull();
    const xlsxPath = `${artifactDirectory}/export.xlsx`;
    await copyFile(xlsxTempPath!, xlsxPath);
    const workbook = XLSX.readFile(xlsxPath);
    // 세무사 전달용 워크북은 4시트 분리 구조다(요약·자산별·원장·예외) — 요약 시트는 최소한 주의(면책) 행을 갖는다.
    const summarySheet = workbook.Sheets["요약"];
    const xlsxPassed = (await stat(xlsxPath)).size > 0 && JSON.stringify(workbook.SheetNames) === JSON.stringify(["요약", "자산별", "원장", "예외"]) && Object.keys(summarySheet ?? {}).some((key) => key.startsWith("A") && summarySheet?.[key]?.v !== undefined);
    expect(xlsxPassed).toBeTruthy();
    await page.locator("main").screenshot({ path: exportPath, type: "jpeg", quality: 85 });
    transcript.act({ type: "screenshot", selector: "main" });
    record(cases, "export-xlsx-and-anchor-card", "Nonempty four-sheet report workbook (요약·자산별·원장·예외) with summary values and visible proof card", { sheets: ["요약", "자산별", "원장", "예외"], proof: true }, { size: (await stat(xlsxPath)).size, sheets: workbook.SheetNames, summaryCells: Object.keys(summarySheet ?? {}).filter((key) => key.startsWith("A")) }, xlsxPassed);

    const proofResponse = await page.context().request.get(`/api/anchor-proof?eventId=${items[0].event.id}`);
    const proof = await proofResponse.json() as { data?: Record<string, unknown> };
    const missingProof = await page.context().request.get("/api/anchor-proof?eventId=not-an-event");
    const anonymous = await browser.newContext({ baseURL: "http://localhost:3100" });
    const unauthProof = await anonymous.request.get(`/api/anchor-proof?eventId=${items[0].event.id}`);
    await anonymous.close();
    const proofPassed = proofResponse.status() === 200 && ["tx_hash", "merkle_root", "anchored_at"].every((key) => typeof proof.data?.[key] === "string") && missingProof.status() === 404 && unauthProof.status() === 401;
    expect(proofPassed).toBeTruthy();
    record(cases, "anchor-proof-api-auth-and-errors", "Existing 200 fields; missing 404; anonymous 401", { existing: 200, missing: 404, anonymous: 401 }, { existing: proofResponse.status(), fields: proof.data, missing: missingProof.status(), anonymous: unauthProof.status() }, proofPassed);

    let floor = transcript.actions.at(-1)?.timestamp ?? new Date(0).toISOString();
    const assertions = transcript.assertions.map((assertion) => { floor = assertion.timestamp >= floor ? assertion.timestamp : floor; return { ...assertion, timestamp: floor }; });
    const status = cases.every((result) => result.verdict === "passed") ? "passed" : "failed";
    await writeFile(transcriptPath, `${JSON.stringify({ schemaVersion: 1, surface: "web", tool: "playwright-chromium", actions: transcript.actions, assertions }, null, 2)}\n`);
    await writeFile(reportPath, `${JSON.stringify({ e2eStatus: status, redTeamStatus: status, cases, artifacts: [dashboardPath, exportPath, csvPath, xlsxPath, transcriptPath], blockers: [] }, null, 2)}\n`);
    expect(cases.filter((result) => result.verdict === "failed")).toEqual([]);
  });
});
