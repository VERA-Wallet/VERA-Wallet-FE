import { requireCompletedOnboarding } from "@/lib/dal";
import { error, success, withSessionInfrastructureError } from "@/lib/auth-route";
import { taxEngine } from "@/lib/composition-root.server";

export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireCompletedOnboarding(request));
  if (session instanceof Response) return session;
  if (!session) return Response.json(error("unauthorized", "Completed onboarding required."), { status: 401 });
  return Response.json(success(await taxEngine.listRuleSets()));
}
