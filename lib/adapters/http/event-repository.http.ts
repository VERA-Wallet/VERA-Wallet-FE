import "client-only";

import { decodeResponse } from "@/lib/http/error-codec";
import { beEventDetailSchema, beEventListSchema, beEventMutationSchema } from "@/lib/schema/be-event-transport";
import type { EventDetailDTO, EventListDTO, ReclassifyRequestDTO, SetValueOverrideRequestDTO } from "@/lib/http/dto";
import type { EventRepository, ReclassifyResult } from "@/lib/ports/event-repository";

function requestError(message: string): Error {
  return new Error(message);
}

export class HttpEventRepository implements EventRepository {
  // 전역 fetch를 인스턴스 프로퍼티로 저장하면 브라우저에서 this 바인딩이 깨져 Illegal invocation이 된다 — 래퍼로 바인딩한다.
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async list(input: { cursor?: string; limit?: number } = {}): Promise<EventListDTO> {
    const query = new URLSearchParams();
    if (input.cursor) query.set("cursor", input.cursor);
    if (input.limit) query.set("limit", String(input.limit));
    const response = await decodeResponse(await this.fetcher(`/api/events${query.size ? `?${query}` : ""}`), beEventListSchema);
    if ("data" in response && "meta" in response) return response.data;
    throw requestError(response.error.message);
  }

  async getById(id: string): Promise<EventDetailDTO | null> {
    const response = await decodeResponse(await this.fetcher(`/api/events/${encodeURIComponent(id)}`), beEventDetailSchema);
    if ("data" in response && "meta" in response) return response.data;
    if (response.error.code === "not_found") return null;
    throw requestError(response.error.message);
  }

  async reclassify(id: string, input: ReclassifyRequestDTO): Promise<ReclassifyResult> {
    const response = await decodeResponse(
      await this.fetcher(`/api/events/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      beEventMutationSchema,
    );
    if ("data" in response && "meta" in response) return { status: "ok", ...response.data };
    if ("data" in response && response.error.code === "version_conflict") return { status: "conflict", ...response.data };
    if (response.error.code === "not_found") return { status: "not_found", event: null, version: null };
    throw requestError(response.error.message);
  }

  async setValueOverride(id: string, input: SetValueOverrideRequestDTO): Promise<ReclassifyResult> {
    // 재분류와 같은 PATCH 엔드포인트를 쓴다. 서버가 payload 모양으로 분기한다(classification vs value_override).
    const response = await decodeResponse(
      await this.fetcher(`/api/events/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      beEventMutationSchema,
    );
    if ("data" in response && "meta" in response) return { status: "ok", ...response.data };
    if ("data" in response && response.error.code === "version_conflict") return { status: "conflict", ...response.data };
    if (response.error.code === "not_found") return { status: "not_found", event: null, version: null };
    throw requestError(response.error.message);
  }
}
