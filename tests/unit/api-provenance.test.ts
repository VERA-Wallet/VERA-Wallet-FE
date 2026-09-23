import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiProvenance, identityProvenance, identityMode } from "@/lib/api-mode";

const ENV = ["VERAWALLET_BACKEND_ORIGIN", "VERAWALLET_MOCK_MODE", "NEXT_PUBLIC_OMNIONE_CX_MOCK"] as const;
const saved: Record<string, string | undefined> = {};
const health = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.unstubAllGlobals(); });

describe("출처 판정 — BE가 말하는 모드를 따른다", () => {
  it("OFF(mock API)면 BE에 묻지 않고 mock이다", async () => {
    const fetcher = health({ mockMode: false }); vi.stubGlobal("fetch", fetcher);
    expect(await apiProvenance()).toBe("mock");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("ON이라도 BE가 MOCK_MODE면 mock이다 — e2e가 정확히 이 조합으로 돈다", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://be.test";
    vi.stubGlobal("fetch", health({ mockMode: true }));
    expect(await apiProvenance()).toBe("mock");
  });
  it("ON이고 BE가 실모드면 live다", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://be.test";
    vi.stubGlobal("fetch", health({ mockMode: false, identityProvider: "omnione_cx" }));
    expect(await apiProvenance()).toBe("live");
  });
  it("BE가 답하지 않거나 형태가 다르면 mock이다 — 모르면서 실데이터라고 하지 않는다", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://be.test";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await apiProvenance()).toBe("mock");
    vi.stubGlobal("fetch", health({ status: "ok" }));
    expect(await apiProvenance()).toBe("mock");
  });
});

describe("신원인증 출처 — 세 스위치가 모두 실모드여야 live", () => {
  it("Open DID stays live independently of mocked market data and CX switches", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://be.test";
    process.env.NEXT_PUBLIC_OMNIONE_CX_MOCK = "true";
    vi.stubGlobal("fetch", health({ mockMode: true, identityProvider: "opendid" }));
    expect(await identityMode()).toEqual({ provider: "opendid", provenance: "live" });
  });
  it("does not fall back to mock login when backend health is unavailable", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://be.test";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await identityMode()).provider).toBe("unavailable");
  });
  it("FE 인증창이 '했다 치고'면 BE가 실모드여도 mock이다", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://be.test"; process.env.NEXT_PUBLIC_OMNIONE_CX_MOCK = "true";
    vi.stubGlobal("fetch", health({ mockMode: false, identityProvider: "omnione_cx" }));
    expect(await identityProvenance()).toBe("mock");
  });
  it("BE 신원 공급자가 mock이면 인증창이 진짜여도 mock이다 — 토큰이 검증되지 않는 반쪽 실모드", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://be.test";
    vi.stubGlobal("fetch", health({ mockMode: false, identityProvider: "mock" }));
    expect(await identityProvenance()).toBe("mock");
  });
  it("전부 실모드면 live다", async () => {
    process.env.VERAWALLET_BACKEND_ORIGIN = "http://be.test";
    vi.stubGlobal("fetch", health({ mockMode: false, identityProvider: "omnione_cx" }));
    expect(await identityProvenance()).toBe("live");
  });
});
