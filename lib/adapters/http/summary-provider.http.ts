import "client-only";

import { decodeResponse } from "@/lib/http/error-codec";
import { summarySchema } from "@/lib/http/dto";
import type { SummaryDTO } from "@/lib/http/dto";
import type { SummaryProvider } from "@/lib/ports/summary-provider";

export class HttpSummaryProvider implements SummaryProvider {
  // 전역 fetch를 인스턴스 프로퍼티로 저장하면 브라우저에서 this 바인딩이 깨져 Illegal invocation이 된다 — 래퍼로 바인딩한다.
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async getSummary(input: { from?: string; to?: string } = {}): Promise<SummaryDTO> {
    const query = new URLSearchParams();
    if (input.from) query.set("from", input.from);
    if (input.to) query.set("to", input.to);
    const response = await decodeResponse(
      await this.fetcher(`/api/events/summary${query.size ? `?${query}` : ""}`),
      summarySchema,
    );
    if ("data" in response && "meta" in response) return response.data;
    throw new Error(response.error.message);
  }
}
