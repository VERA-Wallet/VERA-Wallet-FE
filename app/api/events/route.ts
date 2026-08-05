import { error } from "@/lib/auth-route";
import { requireCompletedOnboarding } from "@/lib/dal";
import { eventRepository } from "@/lib/composition-root.server";
import type { SuccessEnvelope } from "@/lib/http/envelope";
import type { EventListDTO } from "@/lib/http/dto";

function success<T>(data: T): SuccessEnvelope<T> {
  return { data, meta: { provenance: "mock", generatedAt: new Date().toISOString() } };
}

export async function GET(request: Request) {
  if (!await requireCompletedOnboarding(request)) return Response.json(error("unauthorized", "Completed onboarding required."), { status: 401 });
  const url = new URL(request.url);
  const limitValue = url.searchParams.get("limit");
  const limit = limitValue ? Number(limitValue) : undefined;
  const data = await eventRepository.list({ cursor: url.searchParams.get("cursor") ?? undefined, limit: Number.isFinite(limit) ? limit : undefined });
  return Response.json(success<EventListDTO>(data));
}
