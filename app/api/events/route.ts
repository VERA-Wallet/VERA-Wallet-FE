import { error, success, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireCompletedOnboarding } from "@/lib/dal";
import { eventRepository } from "@/lib/composition-root.server";
import type { EventListDTO } from "@/lib/http/dto";


export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireCompletedOnboarding(request));
  if (session instanceof Response) return session;
  if (!session) return Response.json(error("unauthorized", "Completed onboarding required."), { status: 401 });
  const url = new URL(request.url);
  const limitValue = url.searchParams.get("limit");
  const limit = limitValue ? Number(limitValue) : undefined;
  const data = await eventRepository.list({ cursor: url.searchParams.get("cursor") ?? undefined, limit: Number.isFinite(limit) ? limit : undefined });
  return Response.json(success<EventListDTO>(data));
}
