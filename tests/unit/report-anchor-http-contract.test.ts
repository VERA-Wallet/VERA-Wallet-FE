import { describe, expect, it, vi } from "vitest";

import { HttpReportAnchorProvider } from "@/lib/adapters/http/report-anchor.http";
import type { ReportAnchorInput } from "@/lib/ports/report-anchor";

const input: ReportAnchorInput = {
  version: 1,
  algorithm: "keccak256",
  fileHash: `0x${"4a".repeat(32)}`,
  kind: "csv",
  countryCode: "KR",
  taxYear: 2027,
  byteLength: 48213,
};

const record = {
  fileHash: input.fileHash,
  algorithm: "keccak256",
  kind: "csv",
  countryCode: "KR",
  taxYear: 2027,
  byteLength: 48213,
  recordedAt: "2027-05-01T00:00:00.000Z",
  anchorStatus: "anchored",
  attempt: 1,
  txHash: "0x9be3",
  blockNumber: "1284",
  anchoredAt: "2027-05-01T00:00:01.200Z",
  explorerUrl: null,
  failureReason: null,
  lastFailureAt: null,
};

const meta = { provenance: "mock" as const, generatedAt: "2027-05-01T00:00:01.200Z" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// 클라이언트 경계: 라우트 출력과 클라이언트 zod 계약이 어긋나면 브라우저에서만 드러난다. 여기서 못 박는다.
describe("HttpReportAnchorProvider contract", () => {
  it("register() posts only the 7 input fields and decodes the record, including attempt/lastFailureAt", async () => {
    const fetcher = vi.fn(async () => json({ data: record, meta }));
    const result = await new HttpReportAnchorProvider(fetcher).register(input);

    expect(result).toEqual(record);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/report-anchor");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["algorithm", "byteLength", "countryCode", "fileHash", "kind", "taxYear", "version"]);
    expect(body).toEqual(input);
  });

  it("get() sends kind, countryCode and taxYear as query params with fileHash encoded in the path", async () => {
    const fetcher = vi.fn(async () => json({ data: record, meta }));
    await new HttpReportAnchorProvider(fetcher).get({ fileHash: input.fileHash, kind: "csv", countryCode: "KR", taxYear: 2027 });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    const [path, query] = url.split("?");
    expect(path).toBe(`/api/report-anchor/${input.fileHash}`);
    expect(new URLSearchParams(query)).toEqual(new URLSearchParams({ kind: "csv", countryCode: "KR", taxYear: "2027" }));
  });

  it("decodes a 404 not_found as no record — never throws on 'not registered yet'", async () => {
    const fetcher = vi.fn(async () => json({ error: { code: "not_found", message: "No anchor record for that file." } }, 404));
    const result = await new HttpReportAnchorProvider(fetcher).get({ fileHash: input.fileHash, kind: "csv", countryCode: "KR", taxYear: 2027 });
    expect(result).toBeNull();
  });

  it("throws on a non-404 error — e.g. unauthorized must not be swallowed into null", async () => {
    const fetcher = vi.fn(async () => json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401));
    await expect(
      new HttpReportAnchorProvider(fetcher).get({ fileHash: input.fileHash, kind: "csv", countryCode: "KR", taxYear: 2027 }),
    ).rejects.toThrow("Unauthorized");
  });

  it("rejects a record missing failureReason as invalid_response — never renders a half-parsed anchor state", async () => {
    const withoutFailureReason: Record<string, unknown> = { ...record };
    delete withoutFailureReason.failureReason;
    const fetcher = vi.fn(async () => json({ data: withoutFailureReason, meta }));
    await expect(new HttpReportAnchorProvider(fetcher).register(input)).rejects.toThrow("invalid response");
  });

  it("rejects a non-hex fileHash as invalid_response", async () => {
    const fetcher = vi.fn(async () => json({ data: { ...record, fileHash: "not-a-hash" }, meta }));
    await expect(new HttpReportAnchorProvider(fetcher).register(input)).rejects.toThrow("invalid response");
  });
});
