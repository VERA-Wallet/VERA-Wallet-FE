import type { EventDetailDTO, EventListDTO, EventMutation, ReclassifyRequestDTO } from "@/lib/http/dto";

export type ReclassifyResult =
  | { status: "ok"; event: EventMutation["event"]; version: number }
  | { status: "conflict"; event: EventMutation["event"]; version: number }
  | { status: "not_found"; event: null; version: null };

export interface EventRepository {
  list(input?: { cursor?: string; limit?: number }): Promise<EventListDTO>;
  getById(id: string): Promise<EventDetailDTO | null>;
  reclassify(id: string, input: ReclassifyRequestDTO): Promise<ReclassifyResult>;
}
