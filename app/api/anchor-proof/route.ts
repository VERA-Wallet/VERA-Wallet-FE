import { success, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireCompletedOnboarding } from "@/lib/dal";
import { anchorProofProvider } from "@/lib/composition-root.server";
import type { ErrorEnvelope } from "@/lib/http/envelope";


export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireCompletedOnboarding(request));
  if (session instanceof Response) return session;
  if (!session) {
    const body: ErrorEnvelope = { error: { code: "unauthorized", message: "Completed onboarding required." } };
    return Response.json(body, { status: 401 });
  }
  const eventId = new URL(request.url).searchParams.get("eventId");
  if (!eventId) {
    const body: ErrorEnvelope = { error: { code: "invalid_request", message: "eventId is required." } };
    return Response.json(body, { status: 400 });
  }
  const proof = await anchorProofProvider.getProof(eventId);
  if (!proof) {
    const body: ErrorEnvelope = { error: { code: "not_found", message: "Anchor proof not found." } };
    return Response.json(body, { status: 404 });
  }
  return Response.json(success(proof));
}
