import { success, unauthorizedResponse, walletNotBoundResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { eventRepository } from "@/lib/composition-root.server";
import type { EventListDTO } from "@/lib/http/dto";


export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  if (session.walletAddress === null) return walletNotBoundResponse();

  const url = new URL(request.url);
  const limitValue = url.searchParams.get("limit");
  // BE EventQueryService.list의 limit 클램프 계약을 따른다.
  const limit = Math.min(100, Math.max(1, Number(limitValue) || 20));
  const data = await eventRepository.list({ cursor: url.searchParams.get("cursor") ?? undefined, limit });
  return Response.json(success<EventListDTO>(data));
}
