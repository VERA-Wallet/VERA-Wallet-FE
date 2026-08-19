import { error, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { eventRepository } from "@/lib/composition-root.server";
import type { EventMutation, ReclassifyRequestDTO } from "@/lib/http/dto";
import type { ConflictEnvelope } from "@/lib/http/envelope";
import { classificationSchema } from "@/lib/schema/normalized-event";
import { z } from "zod";

const reclassifyRequestSchema = z.object({
  classification: classificationSchema,
  reason: z.string().optional(),
  expectedVersion: z.number().int().positive(),
});


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
  const payload = reclassifyRequestSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return Response.json(error("invalid_request", "Invalid reclassification request."), { status: 400 });
  const { id } = await params;
  const result = await eventRepository.reclassify(id, payload.data satisfies ReclassifyRequestDTO);
  if (result.status === "not_found") return Response.json(error("not_found", "Event not found."), { status: 404 });
  const data: EventMutation = { event: result.event, version: result.version };
  if (result.status === "conflict") {
    const body: ConflictEnvelope<EventMutation> = { error: { code: "version_conflict", message: "Event version does not match." }, data };
    return Response.json(body, { status: 409 });
  }
  return Response.json(success(data));
}
