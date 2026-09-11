import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";

const requireCompletedOnboarding = vi.fn();
const requireDidSession = vi.fn();
vi.mock("@/lib/dal", () => ({ requireCompletedOnboarding, requireDidSession }));

afterEach(() => {
  requireCompletedOnboarding.mockReset();
  requireDidSession.mockReset();
});

type Handler = (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>;

const routes: Array<[string, () => Promise<Handler>, "GET" | "POST" | "PATCH", boolean]> = [
  ["events", async () => (await import("@/app/api/events/route")).GET as Handler, "GET", false],
  ["event by id", async () => (await import("@/app/api/events/[id]/route")).GET as Handler, "GET", true],
  ["event summary", async () => (await import("@/app/api/events/summary/route")).GET as Handler, "GET", false],
  ["SIWE verify", async () => (await import("@/app/api/auth/verify/route")).POST as Handler, "POST", false],
  ["anchor proof", async () => (await import("@/app/api/anchor-proof/route")).GET as Handler, "GET", false],
  ["rulesets", async () => (await import("@/app/api/rulesets/route")).GET as Handler, "GET", false],
  ["tax estimate", async () => (await import("@/app/api/tax/estimate/route")).POST as Handler, "POST", false],
  ["tax rulesets", async () => (await import("@/app/api/tax/rulesets/route")).GET as Handler, "GET", false],
  ["portfolio holdings", async () => (await import("@/app/api/portfolio/holdings/route")).GET as Handler, "GET", false],
  ["registered wallets", async () => (await import("@/app/api/auth/wallets/route")).GET as Handler, "GET", false],
  // PATCH도 같은 게이트를 쓴다. GET만 고정하면 PATCH에서 래퍼가 빠져도 통과한다.
  ["event by id reclassify", async () => (await import("@/app/api/events/[id]/route")).PATCH as Handler, "PATCH", true],
];

describe("protected route infrastructure contract", () => {
  it.each(routes)("maps %s session infrastructure failures to 502", async (_name, load, method, requiresParams) => {
    const infrastructureError = new SessionInfrastructureError("network", "offline");
    requireCompletedOnboarding.mockRejectedValue(infrastructureError);
    requireDidSession.mockRejectedValue(infrastructureError);
    const handler = await load();
    const response = await handler(new Request("http://localhost/api/test", { method }), requiresParams ? { params: Promise.resolve({ id: "event-1" }) } : undefined);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "upstream_unavailable" } });
  });

  it("rethrows non-session errors", async () => {
    const { withSessionInfrastructureError } = await import("@/lib/auth-route");
    const failure = new Error("programming error");
    await expect(withSessionInfrastructureError(async () => { throw failure; })).rejects.toBe(failure);
  });
});
