import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { effectiveClassification } from "@/lib/review";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { useFreshBackend } from "./support/backend-lifecycle";
import { bootstrapSession } from "./support/bootstrap-be-session";

type CaseResult = {
  id: string;
  scenario: string;
  expected: unknown;
  actual: unknown;
  verdict: "passed" | "failed";
};

/**
 * BE `event.presenter.ts`가 목록 응답의 건마다 얹는 **읽기 시점 원가 필드**.
 *
 * 저장되지 않는 파생값이라 FE 수신 스키마(`lib/schema/normalized-event.ts`)에는 칸이 없다.
 * ON 모드에서 `/api/events`는 `proxy.ts`가 BE 응답을 그대로 흘려보내므로 이 계약 교차검증만
 * 원본 JSON에서 직접 읽는다 — 화면 코드가 이 칸에 의존해서는 안 된다는 뜻이기도 하다.
 */
type CostBasisReview = "disposal_exceeds_holdings" | "bridge_move_unmatched" | "gas_unpriced";
type LedgerEvent = NormalizedEvent & {
  /** 처분(OUT)의 이동평균 실현손익. 취득(IN)과 계산 제외 이벤트는 null이다. */
  pnl?: string | null;
  /** fold가 남긴 검토 사유(원가 미확인·브릿지 미매칭·가스 미평가). 없는 것이 정상이라 있을 때만 실린다. */
  pnl_review?: CostBasisReview;
};

type SummaryPayload = {
  periodPnl?: string;
  periodPnlBasis?: string;
  unresolvedProceeds?: string;
  computableEventCount?: number;
  taxableEventCount?: number;
  pendingReviewCount?: number;
};

// 십진 문자열 비교용 고정 스케일. BE는 Decimal로 접으므로 Number로 접으면 반올림이 갈릴 수 있다.
const DECIMAL_SCALE = 18;

function scaledDecimal(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  const digits = BigInt(`${whole === "" ? "0" : whole}${fraction.padEnd(DECIMAL_SCALE, "0").slice(0, DECIMAL_SCALE)}`);
  return negative ? -digits : digits;
}

/** 리포트에 사람이 읽을 기대값을 남기기 위한 역변환. 비교 자체는 스케일 정수로 한다. */
function unscaledDecimal(value: bigint): string {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(DECIMAL_SCALE + 1, "0");
  const fraction = digits.slice(-DECIMAL_SCALE).replace(/0+$/, "");
  return `${negative ? "-" : ""}${digits.slice(0, -DECIMAL_SCALE)}${fraction === "" ? "" : `.${fraction}`}`;
}

const artifactDirectory = "/tmp/g001-qa";
const reportPath = `${artifactDirectory}/api-test-report.json`;
const transcriptPath = `${artifactDirectory}/e2e-transcript.json`;
const dashboardPath = `${artifactDirectory}/dashboard.jpg`;
const forbiddenTerms = ["세액", "납부할 세금", "신고서"];

async function responseBody(response: { json(): Promise<unknown> }) {
  return response.json();
}

function record(cases: CaseResult[], id: string, scenario: string, expected: unknown, actual: unknown, passed: boolean) {
  cases.push({ id, scenario, expected, actual, verdict: passed ? "passed" : "failed" });
}

type TranscriptEntry = { type: string; timestamp: string; url?: string; selector?: string; target?: string };
type TranscriptAssertion = { timestamp: string; status: "passed" | "failed"; selector?: string; description: string };
function transcriptRecorder() {
  const actions: TranscriptEntry[] = [];
  const assertions: TranscriptAssertion[] = [];
  return {
    actions,
    assertions,
    act(entry: Omit<TranscriptEntry, "timestamp">) {
      actions.push({ ...entry, timestamp: new Date().toISOString() });
    },
    assert(description: string, passed: boolean, selector?: string) {
      assertions.push({ description, status: passed ? "passed" : "failed", timestamp: new Date().toISOString(), ...(selector ? { selector } : {}) });
    },
  };
}

test.describe.serial("G001 contract red team", () => {
  useFreshBackend();
  test("web routes and API mutation/error/summary contracts", async ({ page }) => {
    // 페이지 가드가 쿠키 세션을 읽으므로 API 호출도 브라우저 컨텍스트의 쿠키 자(jar)를 공유해야 한다.
    const request = page.context().request;
    await mkdir(artifactDirectory, { recursive: true });
    const cases: CaseResult[] = [];
    const transcript = transcriptRecorder();
    // 온보딩 가드가 라우팅을 강제하므로 각 페이지는 해당 단계의 세션 상태에서 검증한다.
    transcript.act({ type: "goto", url: "/" });
    await page.goto("/");
    const anonymousRedirect = new URL(page.url()).pathname === "/login";
    record(cases, "web-root-redirect", "Anonymous root redirects to login", "/login", page.url(), anonymousRedirect);
    transcript.assert("Anonymous root redirects to login", anonymousRedirect, "body");

    // 각 화면은 가드가 허용하는 세션 단계에서만 접근 가능하므로 단계별로 검증한다.
    const checkPage = async (path: string, primaryText: string, secondaryText: string) => {
      transcript.act({ type: "goto", url: path });
      await page.goto(path);
      const body = await page.locator("body").innerText();
      const hasForbiddenTerm = forbiddenTerms.find((term) => body.includes(term));
      const passed = body.includes(primaryText) && body.includes(secondaryText) && !hasForbiddenTerm;
      transcript.assert(`${path} renders ${primaryText}/${secondaryText} without forbidden terms`, passed, "body");
      record(
        cases,
        `web-render-${path.slice(1)}`,
        `${primaryText}, ${secondaryText}; forbidden terms absent`,
        { primaryText: true, secondaryText: true, forbiddenTerm: null },
        { primaryText: body.includes(primaryText), secondaryText: body.includes(secondaryText), forbiddenTerm: hasForbiddenTerm ?? null },
        passed,
      );
    };

    await checkPage("/login", "DID로 안전하게 로그인하세요", "거주국 선택");

    // DID 단계 세션에서만 지갑 연결 화면에 접근할 수 있다.
    const didResponse = await request.post("/api/auth/did/present", { data: { country: "KR" } });
    // FE mock과 BE 모두 201을 준다(NestJS @Post 기본 성공 코드). 어댑터는 response.ok로 판정하므로 둘 다 정상이다.
    record(cases, "auth-did-present", "DID claim issues a DID-stage session", "2xx", didResponse.status(), didResponse.ok());
    // 첫 화면은 방법 선택이다 — 서명 없이 등록하는 "주소로 추가"가 추천으로 먼저 보여야 한다.
    await checkPage("/connect-wallet", "지갑을 어떻게", "주소로 추가");

    // 완료 세션(dev 전용 test-login)에서 대시보드·내보내기를 검증한다.
    await bootstrapSession(page, { privateKey: "0x4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d" });
    const bootstrapped = await request.get("/api/auth/session");
    const bootstrappedBody = await bootstrapped.json() as { data: { walletAddress: string | null } };
    record(cases, "auth-bootstrap-session", "completed session is established for the active mode", true, bootstrappedBody.data.walletAddress !== null, bootstrappedBody.data.walletAddress !== null);
    await checkPage("/dashboard", "거래 요약", "전체 거래");
    // 여백이 많은 fullPage 대신 콘텐츠 밀집 영역을 캡처해 비균일 증거를 보존한다.
    transcript.act({ type: "screenshot", selector: "main", target: dashboardPath });
    await page.locator("main").first().screenshot({ path: dashboardPath, type: "jpeg", quality: 85 });
    await checkPage("/export", "리포트", "직접 신고용 내려받기");

    const listResponse = await request.get("/api/events?limit=100");
    const listBody = (await responseBody(listResponse)) as { data?: { items?: Array<{ event: NormalizedEvent; version?: number }> }; meta?: { provenance?: string } };
    const items = listBody.data?.items ?? [];
    const listPassed = listResponse.status() === 200 && listBody.meta?.provenance === "mock" && items.length > 0 && items.every((item) => typeof item.version === "number");
    record(cases, "api-list", "GET list returns versions and mock provenance", "200; items[].version; meta.provenance=mock", { status: listResponse.status(), itemCount: items.length, provenance: listBody.meta?.provenance, versionsPresent: items.every((item) => typeof item.version === "number") }, listPassed);

    const first = items[0];
    const existingId = String(first?.event.id);
    const existingResponse = await request.get(`/api/events/${existingId}`);
    const existingBody = (await responseBody(existingResponse)) as { data?: { version?: number } };
    record(cases, "api-get-existing", "GET existing event", "200 with event mutation", { status: existingResponse.status(), version: existingBody.data?.version }, existingResponse.status() === 200 && typeof existingBody.data?.version === "number");

    const missingResponse = await request.get("/api/events/not-an-event");
    const missingBody = (await responseBody(missingResponse)) as { error?: { code?: string } };
    record(cases, "api-get-missing", "GET missing event returns ErrorEnvelope", "404 ErrorEnvelope", { status: missingResponse.status(), error: missingBody.error }, missingResponse.status() === 404 && typeof missingBody.error?.code === "string");

    const originalVersion = existingBody.data?.version;
    const mutationResponse = await request.patch(`/api/events/${existingId}`, { data: { classification: "SEND", reason: "red-team version test", expectedVersion: originalVersion } });
    const mutationBody = (await responseBody(mutationResponse)) as { data?: { event?: { user_override?: unknown }; version?: number } };
    record(cases, "api-patch-success", "PATCH correct expectedVersion increments version and records override", "200; version+1; user_override", { status: mutationResponse.status(), version: mutationBody.data?.version, userOverride: mutationBody.data?.event?.user_override }, mutationResponse.status() === 200 && mutationBody.data?.version === Number(originalVersion) + 1 && mutationBody.data?.event?.user_override !== null && mutationBody.data?.event?.user_override !== undefined);

    const conflictResponse = await request.patch(`/api/events/${existingId}`, { data: { classification: "RECEIVE", expectedVersion: originalVersion } });
    const conflictBody = (await responseBody(conflictResponse)) as { error?: { code?: string }; data?: { event?: unknown; version?: number } };
    record(cases, "api-patch-conflict", "PATCH stale expectedVersion returns ConflictEnvelope", "409; data.event and data.version", { status: conflictResponse.status(), error: conflictBody.error, hasEvent: conflictBody.data?.event !== undefined, version: conflictBody.data?.version }, conflictResponse.status() === 409 && conflictBody.error?.code === "version_conflict" && conflictBody.data?.event !== undefined && typeof conflictBody.data?.version === "number");

    for (const [id, options] of [
      ["api-patch-invalid-classification", { data: { classification: "INVALID", expectedVersion: 1 } }],
      ["api-patch-invalid-json", { data: "not json", headers: { "content-type": "application/json" } }],
      ["api-patch-negative-version", { data: { classification: "SEND", expectedVersion: -1 } }],
    ] as const) {
      const response = await request.patch(`/api/events/${existingId}`, options);
      const body = (await responseBody(response)) as { error?: { code?: string } };
      record(cases, id, "Malformed PATCH request is rejected", "400 ErrorEnvelope", { status: response.status(), error: body.error }, response.status() === 400 && typeof body.error?.code === "string");
    }

    // 위 PATCH들이 분류를 바꿨으므로 첫 목록(라인 100)은 이미 요약과 다른 시점의 원장이다.
    // 교차검증은 요약과 같은 시점을 봐야 하므로 목록을 다시 읽는다.
    const ledgerResponse = await request.get("/api/events?limit=100");
    const ledgerBody = (await responseBody(ledgerResponse)) as { data?: { items?: Array<{ event: LedgerEvent }> } };
    const fixtureEvents = (ledgerBody.data?.items ?? []).map(({ event }) => event);

    const summaryResponse = await request.get("/api/events/summary");
    const summaryBody = (await responseBody(summaryResponse)) as { data?: SummaryPayload };
    // BE 요약 계약(BE PR #4 `feat(tax): 브릿지 원가 이동·실현손익 집계·가스 귀속` 이후):
    //  - computable = SPAM·UNKNOWN 분류·INTERNAL_TRANSFER·가격 UNKNOWN 제외.
    //  - periodPnl = **이동평균 실현손익** 합계다. 현금흐름(OUT +, IN −) 합이 아니다 —
    //    응답의 periodPnlBasis가 그 근거를 이름으로 밝히므로 여기서도 그 값을 함께 단언해
    //    조용한 현금흐름 회귀를 잡는다. 취득(IN)은 0 기여이고, 원가를 확인할 수 없는 처분
    //    (pnl_review=disposal_exceeds_holdings)은 "원가 0"이 아니라 "모름"이라 합계에서 빠져
    //    unresolvedProceeds로 따로 보고된다.
    //  - taxable = computable 중 RECEIVE/SEND/EXCHANGE.
    //  - pending = 비SPAM 중 UNKNOWN 분류·가격 UNKNOWN·confidence<0.5 **또는 fold가 남긴 pnl_review**.
    // 목록이 건별 pnl·pnl_review를 그대로 싣기 때문에 기대값을 고정 상수로 박지 않고 같은 원장에서 다시 접는다.
    // FE lib/review의 리뷰 정의(방향 모순까지 잡음)와는 다른 규칙이므로 BE 규칙만 그대로 모델링한다.
    const computable = fixtureEvents.filter((event) => {
      const classification = effectiveClassification(event);
      return classification !== "SPAM" && classification !== "UNKNOWN" && classification !== "INTERNAL_TRANSFER" && event.price_status !== "UNKNOWN";
    });
    // 계산 제외 이벤트와 취득은 pnl이 null이므로 이 필터만으로 BE의 `excluded`·`direction !== "OUT"` 건너뛰기와 일치한다.
    const realized = fixtureEvents.filter((event) => typeof event.pnl === "string" && event.pnl_review !== "disposal_exceeds_holdings");
    const fixtureRealizedPnl = realized.reduce((total, event) => total + scaledDecimal(String(event.pnl)), BigInt(0));
    const fixtureTaxableCount = computable.filter((event) => ["RECEIVE", "SEND", "EXCHANGE"].includes(effectiveClassification(event))).length;
    const fixturePendingCount = fixtureEvents.filter((event) => effectiveClassification(event) !== "SPAM" && (effectiveClassification(event) === "UNKNOWN" || event.price_status === "UNKNOWN" || Number(event.confidence) < 0.5 || event.pnl_review !== undefined)).length;
    // 미확인 처분이 하나도 없으면 unresolvedProceeds는 0이어야 한다(반대 방향은 proceeds가 응답에 없어 단언할 수 없다).
    const unresolvedLegs = fixtureEvents.filter((event) => event.pnl_review === "disposal_exceeds_holdings").length;
    const unresolvedProceeds = summaryBody.data?.unresolvedProceeds;
    const unresolvedPassed = typeof unresolvedProceeds === "string" && (unresolvedLegs > 0 || scaledDecimal(unresolvedProceeds) === BigInt(0));
    const summaryPassed = summaryResponse.status() === 200
      && ledgerResponse.status() === 200
      && summaryBody.data?.periodPnlBasis === "realized_moving_average"
      && typeof summaryBody.data?.periodPnl === "string"
      && scaledDecimal(summaryBody.data.periodPnl) === fixtureRealizedPnl
      && summaryBody.data?.computableEventCount === computable.length
      && summaryBody.data?.taxableEventCount === fixtureTaxableCount
      && Number(summaryBody.data?.pendingReviewCount) >= 1
      && summaryBody.data?.pendingReviewCount === fixturePendingCount
      && unresolvedPassed;
    record(
      cases,
      "api-summary-fixture-cross-check",
      "Summary reports realized moving-average P/L over computable events and flags UNKNOWN/unpriced/low-confidence/cost-review events as pending",
      { status: 200, periodPnlBasis: "realized_moving_average", periodPnl: unscaledDecimal(fixtureRealizedPnl), computableEventCount: computable.length, taxableEventCount: fixtureTaxableCount, pendingReviewCount: fixturePendingCount, unresolvedLegs },
      { status: summaryResponse.status(), summary: summaryBody.data },
      summaryPassed,
    );

    const dynamicTarget = items.find(({ event }) => event.classification === "INTERNAL_TRANSFER" && event.price_status !== "UNKNOWN" && event.fiat_value !== null);
    const targetId = String(dynamicTarget?.event.id);
    const targetVersion = dynamicTarget?.version;
    const reclassifyResponse = await request.patch(`/api/events/${targetId}`, { data: { classification: "SEND", reason: "summary recalculation test", expectedVersion: targetVersion } });
    const reclassifyBody = (await responseBody(reclassifyResponse)) as { data?: { version?: number } };
    const updatedSummaryResponse = await request.get("/api/events/summary");
    const updatedSummaryBody = (await responseBody(updatedSummaryResponse)) as { data?: { taxableEventCount?: number } };
    const dynamicPassed = reclassifyResponse.status() === 200 && reclassifyBody.data?.version === Number(targetVersion) + 1 && updatedSummaryResponse.status() === 200 && updatedSummaryBody.data?.taxableEventCount === Number(summaryBody.data?.taxableEventCount) + 1;
    record(cases, "api-summary-dynamic-reclassification", "Reclassification dynamically updates taxable count", "PATCH 200 then taxableEventCount +1", { patchStatus: reclassifyResponse.status(), updatedTaxableEventCount: updatedSummaryBody.data?.taxableEventCount, priorTaxableEventCount: summaryBody.data?.taxableEventCount }, dynamicPassed);

    const redTeamStatus = cases.every((result) => result.verdict === "passed") ? "passed" : "failed";
    // 스키마는 actions→assertions 연결 스트림의 단조 시각을 요구하므로 클램프 정규화한다(상대 순서 보존).
    let clampFloor = transcript.actions.at(-1)?.timestamp ?? new Date(0).toISOString();
    const clampedAssertions = transcript.assertions.map((entry) => {
      clampFloor = entry.timestamp >= clampFloor ? entry.timestamp : clampFloor;
      return { ...entry, timestamp: clampFloor };
    });
    await writeFile(transcriptPath, `${JSON.stringify({ schemaVersion: 1, surface: "web", tool: "playwright-chromium", spec: "tests/e2e/g001-smoke.spec.ts", actions: transcript.actions, assertions: clampedAssertions }, null, 2)}\n`);
    await writeFile(reportPath, `${JSON.stringify({ e2eStatus: redTeamStatus === "passed" ? "passed" : "failed", redTeamStatus, cases, artifacts: [dashboardPath, transcriptPath], blockers: [] }, null, 2)}\n`);
    expect(cases.filter((result) => result.verdict === "failed")).toEqual([]);
  });
});
