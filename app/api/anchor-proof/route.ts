import { error, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { anchorProofProvider } from "@/lib/composition-root.server";


export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const eventId = new URL(request.url).searchParams.get("eventId");
  if (!eventId) return Response.json(error("invalid_request", "eventId is required."), { status: 400 });
  if (session.walletAddress === null) return Response.json(error("not_found", "Anchor proof not found."), { status: 404 });

  const proof = await anchorProofProvider.getProof(eventId);
  if (!proof) return Response.json(error("not_found", "Anchor proof not found."), { status: 404 });
  return Response.json(success(proof));
}
