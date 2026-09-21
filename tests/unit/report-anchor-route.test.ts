import { afterEach, describe, expect, it, vi } from "vitest";

import { resetMockReportAnchors, setMockReportAnchorFailure } from "@/lib/mock/report-anchor-store";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";

const requireDidSession = vi.fn();
vi.mock("@/lib/dal", () => ({ requireDidSession }));

// 정적 import는 ESM 호이스팅으로 `vi.mock` 팩토리보다 먼저 평가돼 위 `const`를 "초기화 전 접근"으로 만든다
// (`tests/unit/portfolio-holdings-route.test.ts`도 같은 이유로 동적 import를 쓴다). 그래서 라우트를 매 호출마다 동적으로 불러온다.
const session = (walletAddress: string | null) => ({ source: "mock" as const, didVerified: true, countryCode: "KR", walletAddress, chainId: null });

const FILE_HASH = `0x${"a".repeat(64)}`;

function validBody(overrides: Record<string, unknown> = {}) {
  return { version: 1, algorithm: "keccak256", fileHash: FILE_HASH, kind: "csv", countryCode: "KR", taxYear: 2027, byteLength: 1234, ...overrides };
}

async function postRegister(body: unknown) {
  const { POST } = await import("@/app/api/report-anchor/route");
  return POST(new Request("http://localhost/api/report-anchor", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
}

async function postRegisterRaw(rawBody: string) {
  const { POST } = await import("@/app/api/report-anchor/route");
  return POST(new Request("http://localhost/api/report-anchor", { method: "POST", body: rawBody, headers: { "content-type": "application/json" } }));
}

async function getRecord(fileHash: string, query = "") {
  const { GET } = await import("@/app/api/report-anchor/[fileHash]/route");
  return GET(new Request(`http://localhost/api/report-anchor/${fileHash}${query}`), { params: Promise.resolve({ fileHash }) });
}

async function postFailureSwitch(body: unknown) {
  const { POST } = await import("@/app/api/mock/report-anchor-failure/route");
  return POST(new Request("http://localhost/api/mock/report-anchor-failure", { method: "POST", body: JSON.stringify(body) }));
}

afterEach(() => {
  requireDidSession.mockReset();
  resetMockReportAnchors();
  setMockReportAnchorFailure(false);
  vi.unstubAllEnvs();
});

describe("POST /api/report-anchor", () => {
  it("401 without a DID session", async () => {
    requireDidSession.mockResolvedValue(null);
    expect((await postRegister(validBody())).status).toBe(401);
  });

  it("502 when the session infrastructure is down", async () => {
    requireDidSession.mockRejectedValue(new SessionInfrastructureError("timeout", "slow"));
    const response = await postRegister(validBody());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "upstream_unavailable" } });
  });

  it("400 when the body is not JSON", async () => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    const response = await postRegisterRaw("not json");
    expect(response.status).toBe(400);
  });

  it.each([
    ["version", { version: 2 }],
    ["algorithm", { algorithm: "md5" }],
    ["fileHash (format)", { fileHash: "not-a-hash" }],
    ["kind", { kind: "pdf" }],
    ["countryCode (empty)", { countryCode: "" }],
    ["taxYear (non-integer)", { taxYear: 2027.5 }],
    ["byteLength (negative)", { byteLength: -1 }],
  ])("400 on invalid %s", async (_label, patch) => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    const response = await postRegister(validBody(patch));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("200 happy path: registers pending and normalizes countryCode to uppercase", async () => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    const response = await postRegister(validBody({ countryCode: "kr" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.countryCode).toBe("KR");
    expect(body.data.anchorStatus).toBe("pending");
    expect(body.data.attempt).toBe(1);
  });
});

describe("GET /api/report-anchor/[fileHash]", () => {
  it("401 without a DID session", async () => {
    requireDidSession.mockResolvedValue(null);
    expect((await getRecord(FILE_HASH, "?kind=csv&countryCode=KR&taxYear=2027")).status).toBe(401);
  });

  it.each([
    ["no query at all", ""],
    ["kind missing", "?countryCode=KR&taxYear=2027"],
    ["kind invalid", "?kind=pdf&countryCode=KR&taxYear=2027"],
    ["countryCode missing", "?kind=csv&taxYear=2027"],
    ["countryCode empty", "?kind=csv&countryCode=&taxYear=2027"],
    ["taxYear missing", "?kind=csv&countryCode=KR"],
    // Number(null) === 0 함정: 빈 문자열/누락이 조용히 taxYear=0으로 통과하면 안 된다.
    ["taxYear empty string", "?kind=csv&countryCode=KR&taxYear="],
    ["taxYear non-numeric", "?kind=csv&countryCode=KR&taxYear=abcd"],
  ])("400 when %s", async (_label, query) => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    const response = await getRecord(FILE_HASH, query);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });

  it("404 when no record exists yet for that key", async () => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    const response = await getRecord(FILE_HASH, "?kind=csv&countryCode=KR&taxYear=2027");
    expect(response.status).toBe(404);
  });

  it("404 for another user's record — no existence oracle across users", async () => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    expect((await postRegister(validBody())).status).toBe(200);
    requireDidSession.mockResolvedValue(session("0xdead"));
    const response = await getRecord(FILE_HASH, "?kind=csv&countryCode=KR&taxYear=2027");
    expect(response.status).toBe(404);
  });

  it("200 happy path: returns my record and normalizes countryCode query to uppercase", async () => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    expect((await postRegister(validBody())).status).toBe(200);
    const response = await getRecord(FILE_HASH, "?kind=csv&countryCode=kr&taxYear=2027");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.anchorStatus).toBe("pending");
    expect(body.data.countryCode).toBe("KR");
  });
});

describe("POST /api/mock/report-anchor-failure", () => {
  it("404 in production (FE-only dev helper, not a BE contract surface)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await postFailureSwitch({ failing: true });
    expect(response.status).toBe(404);
  });

  it("401 without a DID session", async () => {
    requireDidSession.mockResolvedValue(null);
    expect((await postFailureSwitch({ failing: true })).status).toBe(401);
  });

  it("200 happy path: toggles the switch and reset clears the store", async () => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    const on = await postFailureSwitch({ failing: true });
    expect(on.status).toBe(200);
    expect((await on.json()).data).toMatchObject({ failing: true, records: 0 });

    expect((await postRegister(validBody())).status).toBe(200);
    const reset = await postFailureSwitch({ reset: true, failing: false });
    expect(reset.status).toBe(200);
    expect((await reset.json()).data).toMatchObject({ failing: false, records: 0 });
  });
});
