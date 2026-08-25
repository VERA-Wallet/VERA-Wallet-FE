import type { EventDetailDTO, EventListDTO, EventMutation, ReclassifyRequestDTO, SetValueOverrideRequestDTO } from "@/lib/http/dto";

export type ReclassifyResult =
  | { status: "ok"; event: EventMutation["event"]; version: number }
  | { status: "conflict"; event: EventMutation["event"]; version: number }
  | { status: "not_found"; event: null; version: null };

export interface EventRepository {
  list(input?: { cursor?: string; limit?: number }): Promise<EventListDTO>;
  getById(id: string): Promise<EventDetailDTO | null>;
  reclassify(id: string, input: ReclassifyRequestDTO): Promise<ReclassifyResult>;
  /** 한 거래의 금액 override(취득가·양도가·부대비용·가스비·출처·증빙·50% 의제)를 저장한다. */
  setValueOverride(id: string, input: SetValueOverrideRequestDTO): Promise<ReclassifyResult>;
}
