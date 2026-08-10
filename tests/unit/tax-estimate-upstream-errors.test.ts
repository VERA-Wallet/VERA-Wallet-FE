import { afterEach, describe, expect, it, vi } from "vitest";

const requireCompletedOnboarding = vi.fn();
const estimate = vi.fn();

vi.mock("@/lib/dal", () => ({ requireCompletedOnboarding }));
vi.mock("@/lib/composition-root.server", () => ({ taxEngine: { estimate, listRuleSets: vi.fn() } }));

afterEach(() => {
  requireCompletedOnboarding.mockReset();
  estimate.mockReset();
});

function estimateRequest(): Request {
  return new Request("http://localhost/api/tax/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ country: "US", taxYear: 2025, source: "wallet" }),
  });
}

// 세션은 통과했는데 그 뒤 BE 이벤트 조회가 실패하는 경로. 여기서 던지면 Next가 500 HTML을 돌려주고
// 화면은 원인을 모른 채 "계산 실패"만 본다 — 세션 경계와 같은 JSON 계약으로 맞춰야 한다.
describe("tax estimate upstream failure contract", () => {
  it("maps a BE event read rejection to its own status and code", async () => {
    const { BeEventReadError } = await import("@/lib/adapters/http/event-repository.server");
    requireCompletedOnboarding.mockResolvedValue({ source: "be", didVerified: true, countryCode: "US", walletAddress: "0x1", chainId: 1 });
    estimate.mockRejectedValue(new BeEventReadError(404, "not_found", "A bound wallet is required before sync."));

    const { POST } = await import("@/app/api/tax/estimate/route");
    const response = await POST(estimateRequest());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("maps an event-service outage to a 502 JSON envelope instead of throwing", async () => {
    const { SessionInfrastructureError } = await import("@/lib/ports/session-reader");
    requireCompletedOnboarding.mockResolvedValue({ source: "be", didVerified: true, countryCode: "US", walletAddress: "0x1", chainId: 1 });
    estimate.mockRejectedValue(new SessionInfrastructureError("network", "BE 이벤트 조회에 실패했다."));

    const { POST } = await import("@/app/api/tax/estimate/route");
    const response = await POST(estimateRequest());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "upstream_unavailable" } });
  });

  it("refuses to calculate from a truncated snapshot", async () => {
    const { EventCollectionTruncatedError } = await import("@/lib/collect/bounded-event-collector");
    requireCompletedOnboarding.mockResolvedValue({ source: "be", didVerified: true, countryCode: "US", walletAddress: "0x1", chainId: 1 });
    estimate.mockRejectedValue(new EventCollectionTruncatedError(5000, 50));

    const { POST } = await import("@/app/api/tax/estimate/route");
    const response = await POST(estimateRequest());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "upstream_truncated" } });
  });

  it("still rethrows a programming error rather than dressing it as an upstream problem", async () => {
    requireCompletedOnboarding.mockResolvedValue({ source: "be", didVerified: true, countryCode: "US", walletAddress: "0x1", chainId: 1 });
    const bug = new TypeError("cannot read properties of undefined");
    estimate.mockRejectedValue(bug);

    const { POST } = await import("@/app/api/tax/estimate/route");
    await expect(POST(estimateRequest())).rejects.toBe(bug);
  });
});
