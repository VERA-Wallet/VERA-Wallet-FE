import { error, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { eventRepository } from "@/lib/composition-root.server";
import { setValueOverrideRequestSchema } from "@/lib/http/dto";
import type { EventMutation } from "@/lib/http/dto";
import type { ReclassifyResult } from "@/lib/ports/event-repository";
import type { ConflictEnvelope } from "@/lib/http/envelope";
import { classificationSchema } from "@/lib/schema/normalized-event";
import { z } from "zod";

const reclassifyRequestSchema = z.object({
  classification: classificationSchema,
  reason: z.string().optional(),
  expectedVersion: z.number().int().positive(),
});

/** ok/conflict/not_found 처리는 재분류와 금액 override가 완전히 같다 — 한 곳으로 모은다. */
function mutationResponse(result: ReclassifyResult): Response {
  if (result.status === "not_found") return Response.json(error("not_found", "Event not found."), { status: 404 });
  const data: EventMutation = { event: result.event, version: result.version };
  if (result.status === "conflict") {
    const body: ConflictEnvelope<EventMutation> = { error: { code: "version_conflict", message: "Event version does not match." }, data };
    return Response.json(body, { status: 409 });
  }
  return Response.json(success(data));
}


export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await withSessionInfrastructureError(() => requireDidSession(_request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  if (session.walletAddress === null) {
    // BE detail/reclassify는 listOrSync를 타지 않고 transactions.get이 null이 되므로 bound-wallet 404가 아니라 Event not found 404다.
    return Response.json(error("not_found", "Event not found."), { status: 404 });
  }
  const { id } = await params;
  const data = await eventRepository.getById(id);
  return data ? Response.json(success(data)) : Response.json(error("not_found", "Event not found."), { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  if (session.walletAddress === null) {
    // BE detail/reclassify는 listOrSync를 타지 않고 transactions.get이 null이 되므로 bound-wallet 404가 아니라 Event not found 404다.
    return Response.json(error("not_found", "Event not found."), { status: 404 });
  }
  const body: unknown = await request.json().catch(() => null);
  const { id } = await params;
  // payload 모양으로 분기한다: classification이 있으면 재분류, value_override 키가 있으면 금액 override.
  const reclassify = reclassifyRequestSchema.safeParse(body);
  if (reclassify.success) return mutationResponse(await eventRepository.reclassify(id, reclassify.data));
  const valueOverride = setValueOverrideRequestSchema.safeParse(body);
  if (valueOverride.success) return mutationResponse(await eventRepository.setValueOverride(id, valueOverride.data));
  return Response.json(error("invalid_request", "Invalid event mutation request."), { status: 400 });
}
