import { afterEach, describe, expect, it, vi } from "vitest";

// Slice 4: OFF 제거 후에도 남는 FE-소유 tax/ruleset 라우트가 provenance:"mock"를 방출하는 것은
// 영구 제품 결정이다(디코더/뱃지 테스트는 이를 증명하지 못한다). 라우트 응답 엔벨로프에서 직접 단언한다.
const requireDidSession = vi.fn();
const requireCompletedOnboarding = vi.fn();
vi.mock("@/lib/dal", () => ({ requireDidSession, requireCompletedOnboarding }));

// 유효한 DID 세션(지갑 미바인딩 — scenario estimate는 지갑이 필요 없다).
const beSession = { source: "be", didVerified: true, countryCode: "KR", walletAddress: null, chainId: null } as const;

afterEach(() => {
  requireDidSession.mockReset();
  requireCompletedOnboarding.mockReset();
});

describe("retained FE-owned route provenance contract", () => {
  it("GET /api/rulesets 엔벨로프 meta.provenance는 mock이다", async () => {
    requireDidSession.mockResolvedValue(beSession);
    const { GET } = await import("@/app/api/rulesets/route");
    const res = await GET(new Request("http://localhost/api/rulesets"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.provenance).toBe("mock");
  });

  it("GET /api/tax/rulesets 엔벨로프 meta.provenance는 mock이다", async () => {
    requireDidSession.mockResolvedValue(beSession);
    const { GET } = await import("@/app/api/tax/rulesets/route");
    const res = await GET(new Request("http://localhost/api/tax/rulesets"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.provenance).toBe("mock");
  });

  it("POST /api/tax/estimate(scenario)는 엔벨로프 meta와 payload 둘 다 provenance mock이다", async () => {
    requireDidSession.mockResolvedValue(beSession);
    const { POST } = await import("@/app/api/tax/estimate/route");
    const res = await POST(
      new Request("http://localhost/api/tax/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ country: "KR", taxYear: 2027, source: "scenario" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.provenance).toBe("mock");
    expect(body.data.provenance).toBe("mock");
  });
});
