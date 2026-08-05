import "client-only";

import { z } from "zod";

import { decodeResponse } from "@/lib/http/error-codec";
import type { AnchorProofProvider } from "@/lib/ports/anchor-proof-provider";

const anchorProofSchema = z.object({
  tx_hash: z.string().min(1),
  merkle_root: z.string().min(1),
  anchored_at: z.string().datetime(),
  explorer_url: z.url(),
});

export class HttpAnchorProofProvider implements AnchorProofProvider {
  // 전역 fetch를 인스턴스 프로퍼티로 저장하면 브라우저에서 this 바인딩이 깨져 Illegal invocation이 된다 — 래퍼로 바인딩한다.
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async getProof(eventId: string) {
    const response = await decodeResponse(
      await this.fetcher(`/api/anchor-proof?eventId=${encodeURIComponent(eventId)}`),
      anchorProofSchema,
    );
    if ("data" in response && "meta" in response) return response.data;
    if (response.error.code === "not_found") return null;
    throw new Error(response.error.message);
  }
}
