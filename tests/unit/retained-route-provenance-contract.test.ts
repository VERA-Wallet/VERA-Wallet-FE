import { afterEach, describe, expect, it, vi } from "vitest";

import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";
import { FIXTURE_TAX_YEAR } from "../fixtures/tax-year";

// FE-소유 라우트의 provenance는 **응답 데이터의 출처**를 말한다.
// 정적 룰셋 목록과 시나리오 계산은 언제나 mock이다. 지갑 계산은 입력 스냅샷의 출처를 그대로 잇는다 —
// OFF(FE mock store)면 mock, ON에서 BE 스냅샷으로 계산했으면 BE 응답의 provenance(실어댑터면 live).
// 실 BE 데이터로 계산한 답에 mock 배지가 붙던 결함(2026-09-08 실지갑 검증)을 여기서 못 박는다.
const requireDidSession = vi.fn();
const requireCompletedOnboarding = vi.fn();
const getSessionCookieHeaderForEventReader = vi.fn(async () => "vw_access_token=jwt");
vi.mock("@/lib/dal", () => ({ requireDidSession, requireCompletedOnboarding, getSessionCookieHeaderForEventReader }));

const readBeWalletEventsWithProvenance = vi.fn();
vi.mock("@/lib/adapters/http/event-repository.server", () => ({
  readBeWalletEventsWithProvenance,
  readBeWalletEvents: async (cookie: string | undefined) => (await readBeWalletEventsWithProvenance(cookie)).events,
  BeEventReadError: class BeEventReadError extends Error {},
}));

// 환율은 결정적 고정표로 — 이 파일은 네트워크를 쓰지 않는다.
process.env.VERAWALLET_FX_SOURCE = "fixed";

// 유효한 DID 세션(지갑 미바인딩 — scenario estimate는 지갑이 필요 없다).
const beSession = { source: "be", didVerified: true, countryCode: "KR", walletAddress: null, chainId: null } as const;

afterEach(() => {
  requireDidSession.mockReset();
  requireCompletedOnboarding.mockReset();
  readBeWalletEventsWithProvenance.mockReset();
  delete process.env.VERAWALLET_BACKEND_ORIGIN;
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

  it("POST /api/tax/estimate(wallet)는 ON 모드에서 BE 스냅샷의 provenance(live)를 엔벨로프와 payload에 그대로 싣는다", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://be.test";
    requireDidSession.mockResolvedValue({ ...beSession, walletAddress: "0x1111111111111111111111111111111111111111" });
    readBeWalletEventsWithProvenance.mockResolvedValue({ events: createNormalizedEventFixtures(FIXTURE_TAX_YEAR), provenance: "live" });
    const { POST } = await import("@/app/api/tax/estimate/route");
    const res = await POST(
      new Request("http://localhost/api/tax/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ country: "KR", taxYear: FIXTURE_TAX_YEAR, source: "wallet" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(readBeWalletEventsWithProvenance).toHaveBeenCalledWith("vw_access_token=jwt");
    expect(body.meta.provenance).toBe("live");
    expect(body.data.provenance).toBe("live");
  });
});
