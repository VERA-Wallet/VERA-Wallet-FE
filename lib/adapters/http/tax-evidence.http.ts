import "client-only";

import { z } from "zod";

import { decodeResponse } from "@/lib/http/error-codec";
import type { EvidenceChainCheck, EvidenceRecord, TaxEvidenceProvider } from "@/lib/ports/tax-evidence";
import type { EvidenceDocument } from "@/lib/tax/evidence";

const evidenceRecordSchema = z.object({
  merkleRoot: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  countryCode: z.string().min(1),
  taxYear: z.number().int(),
  leafCount: z.number().int().nonnegative(),
  recordedAt: z.string().datetime(),
  anchorStatus: z.string().min(1),
  txHash: z.string().nullable(),
  blockNumber: z.string().nullable(),
  anchoredAt: z.string().nullable(),
  explorerUrl: z.string().nullable(),
});

const chainCheckSchema = z.object({
  merkleRoot: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  txHash: z.string().nullable(),
  blockNumber: z.string().nullable(),
  readFromChain: z.boolean(),
  success: z.boolean(),
  anchoredPayloadHash: z.string().nullable(),
  matches: z.boolean(),
  checkedAt: z.string().datetime(),
});

export class HttpTaxEvidenceProvider implements TaxEvidenceProvider {
  // 전역 fetch를 프로퍼티로 두면 브라우저에서 this 바인딩이 깨진다 — 래퍼로 바인딩한다(다른 어댑터와 같은 이유).
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async record(document: EvidenceDocument): Promise<EvidenceRecord> {
    const response = await decodeResponse(
      await this.fetcher("/api/tax-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 루트를 함께 보낸다. 서버는 이것을 믿는 대신 **대조한다** — 두 구현이 갈리면 그 자리에서 드러난다.
        body: JSON.stringify({ version: document.version, leaves: document.leaves, merkleRoot: document.merkleRoot }),
      }),
      evidenceRecordSchema,
    );
    if ("data" in response && "meta" in response) return response.data;
    throw new Error(response.error.message);
  }

  async latest(country: string, taxYear: number): Promise<EvidenceRecord | null> {
    const response = await decodeResponse(
      await this.fetcher(`/api/tax-evidence?country=${encodeURIComponent(country)}&taxYear=${taxYear}`),
      evidenceRecordSchema,
    );
    if ("data" in response && "meta" in response) return response.data;
    if (response.error.code === "not_found") return null;
    throw new Error(response.error.message);
  }

  async checkChain(merkleRoot: string): Promise<EvidenceChainCheck> {
    const response = await decodeResponse(
      await this.fetcher(`/api/tax-evidence/${encodeURIComponent(merkleRoot)}/chain`),
      chainCheckSchema,
    );
    if ("data" in response && "meta" in response) return response.data;
    throw new Error(response.error.message);
  }
}
