import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpReportVcClient } from "@/lib/report-vc/client";
import { FIXTURE_CAPABILITIES, FIXTURE_LINKED, fixtureIssuanceOffer, fixtureIssued, fixtureVerificationResult } from "@/lib/report-vc/fixtures";
import { ReportVcError } from "@/lib/report-vc/types";

const envelope = (data: unknown, status = 200, provenance = "live", headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ data, meta: { provenance, generatedAt: new Date().toISOString() } }), { status, headers: { "content-type": "application/json", ...headers } });
const failure = (code: string, message: string, status: number, headers: Record<string, string> = {}, details?: unknown) =>
  new Response(JSON.stringify({ error: { code, message, ...(details === undefined ? {} : { details }) } }), { status, headers });

const client = new HttpReportVcClient();
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("HttpReportVcClient", () => {
  it("translates a non-envelope 404 (BE not deployed, Next 404 page) into feature_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } })));
    await expect(client.capabilities()).rejects.toMatchObject({ code: "feature_unavailable", status: 404 });
  });

  it("does not turn a network failure into a mock success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(client.capabilities()).rejects.toMatchObject({ code: "feature_unavailable", status: 0 });
  });

  it("keeps a real envelope 404 as its own code rather than feature_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure("evidence_not_found", "not yours", 404)));
    await expect(client.evidenceIssuance("0xabc")).rejects.toMatchObject({ code: "evidence_not_found", status: 404 });
  });

  it("marks 401 as a session expiry and preserves Retry-After on transient errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure("unauthorized", "Unauthorized", 401)));
    const expired = await client.walletState().catch((error: unknown) => error);
    expect(expired).toBeInstanceOf(ReportVcError);
    expect((expired as ReportVcError).sessionExpired).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure("rate_limited", "slow down", 429, { "retry-after": "7" })));
    const limited = await client.walletState().catch((error: unknown) => error);
    expect(limited).toMatchObject({ code: "rate_limited", retryAfterMs: 7000 });
    expect((limited as ReportVcError).transient).toBe(true);
  });

  it("passes provenance through so the screen can refuse to call mock data a real verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope(FIXTURE_CAPABILITIES, 200, "mock")));
    await expect(client.capabilities()).resolves.toMatchObject({ provenance: "mock", data: { enabled: true } });
  });

  it("keeps 202 pending distinct from a linked wallet and rejects a 200 that still says unlinked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ status: "pending", retryAfterMs: 3000 }, 202)));
    await expect(client.linkAttemptStatus("a", signal())).resolves.toMatchObject({ data: { status: "pending", retryAfterMs: 3000 } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope(FIXTURE_LINKED, 200)));
    await expect(client.linkAttemptStatus("a", signal())).resolves.toMatchObject({ data: { status: "linked", did: FIXTURE_LINKED.did } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ status: "unlinked" }, 200)));
    await expect(client.linkAttemptStatus("a", signal())).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("sends only the evidence identifier plus an Idempotency-Key when requesting issuance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope(fixtureIssuanceOffer(), 201));
    vi.stubGlobal("fetch", fetchMock);
    await client.requestIssuance({ evidenceId: "0xroot", idempotencyKey: "key-1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/report-vc/issuances");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
    // 금액·DID·머클루트를 본문에 싣지 않는다. 서버가 저장된 기록에서 읽는다.
    expect(JSON.parse(init.body as string)).toEqual({ evidenceId: "0xroot" });
  });

  it("rejects a success-shaped 202 rather than treating a waiting issuance as issued", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ ...fixtureIssuanceOffer(), status: "issued" }, 202)));
    await expect(client.issuanceStatus("i", signal())).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("decodes a verification result and exposes issuance_in_progress details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope(fixtureVerificationResult("basic"))));
    await expect(client.verificationStatus("v", signal())).resolves.toMatchObject({ data: { status: "verified", claims: { totals: null } } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure("issuance_in_progress", "busy", 409, {}, { issuanceId: "i-9" })));
    await expect(client.requestIssuance({ evidenceId: "0xroot", idempotencyKey: "k" })).rejects.toMatchObject({ code: "issuance_in_progress", details: { issuanceId: "i-9" } });
  });

  it("posts only the file hash for a file check, never the bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope({ format: "csv", hash: `0x${"ab".repeat(32)}`, status: "not_included", evidenceRoot: `0x${"cd".repeat(32)}` }));
    vi.stubGlobal("fetch", fetchMock);
    await client.checkFile("v-1", { format: "csv", algorithm: "keccak256", hash: `0x${"ab".repeat(32)}`, byteLength: 12 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/report-vc/verifications/v-1/file-checks");
    expect(JSON.parse(init.body as string)).toEqual({ format: "csv", algorithm: "keccak256", hash: `0x${"ab".repeat(32)}`, byteLength: 12 });
  });

  it("treats cancel and unlink as idempotent 204s and surfaces envelope errors otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(client.cancelVerification("v")).resolves.toBeUndefined();
    await expect(client.unlinkWallet()).resolves.toBeUndefined();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure("unauthorized", "Unauthorized", 401)));
    await expect(client.unlinkWallet()).rejects.toMatchObject({ code: "unauthorized" });
  });
});

it("accepts a completed idempotent issuance replay without fabricating a new QR", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope(fixtureIssued(fixtureIssuanceOffer()))));
  const result = await client.requestIssuance({ evidenceId: "root", idempotencyKey: "key" });
  expect(result.data.status).toBe("issued");
  expect(result.data).not.toHaveProperty("qr");
});
