import "client-only";

import { z } from "zod";

import { decodeResponse } from "@/lib/http/error-codec";
import type { ReportAnchorInput, ReportAnchorKey, ReportAnchorProvider, ReportAnchorRecord } from "@/lib/ports/report-anchor";

const reportAnchorRecordSchema = z.object({
  fileHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  algorithm: z.enum(["keccak256", "sha256"]),
  kind: z.enum(["csv", "xlsx"]),
  countryCode: z.string().min(1),
  taxYear: z.number().int(),
  byteLength: z.number().int().nonnegative(),
  recordedAt: z.string().datetime(),
  // `EvidenceRecord`와 같은 이유로 열어 둔다 — literal union으로 굳히면 BE가 전이 상태를 하나 더 만드는 순간 전 요청이 계약 위반으로 거절된다.
  anchorStatus: z.string().min(1),
  attempt: z.number().int().positive(),
  txHash: z.string().nullable(),
  blockNumber: z.string().nullable(),
  // 시각은 `recordedAt`과 같은 형식이어야 한다. 그냥 문자열로 두면 화면이 파싱할 수 없는 값을
  // 받아 `formatDateTime`이 조용히 "Invalid Date"를 그린다.
  anchoredAt: z.string().datetime().nullable(),
  explorerUrl: z.string().nullable(),
  failureReason: z.string().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
});

export class HttpReportAnchorProvider implements ReportAnchorProvider {
  // 전역 fetch를 프로퍼티로 두면 브라우저에서 this 바인딩이 깨진다 — 래퍼로 바인딩한다(`tax-evidence.http.ts`와 같은 이유).
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async register(input: ReportAnchorInput): Promise<ReportAnchorRecord> {
    const response = await decodeResponse(
      await this.fetcher("/api/report-anchor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      reportAnchorRecordSchema,
    );
    if ("data" in response && "meta" in response) return response.data;
    throw new Error(response.error.message);
  }

  async get(key: ReportAnchorKey): Promise<ReportAnchorRecord | null> {
    // 해시만으로는 레코드를 특정할 수 없다 — 메타 셋을 전부 쿼리로 싣는다(`lib/ports/report-anchor.ts`의 §0-F6).
    const query = new URLSearchParams({ kind: key.kind, countryCode: key.countryCode, taxYear: String(key.taxYear) });
    const response = await decodeResponse(
      await this.fetcher(`/api/report-anchor/${encodeURIComponent(key.fileHash)}?${query}`),
      reportAnchorRecordSchema,
    );
    if ("data" in response && "meta" in response) return response.data;
    if (response.error.code === "not_found") return null;
    throw new Error(response.error.message);
  }
}
