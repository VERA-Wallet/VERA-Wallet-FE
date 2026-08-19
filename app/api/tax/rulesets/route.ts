import { requireDidSession } from "@/lib/dal";
import { unauthorizedResponse, success, withSessionInfrastructureError } from "@/lib/auth-route";
import { taxEngine } from "@/lib/composition-root.server";

export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  return Response.json(success(await taxEngine.listRuleSets()));
}
