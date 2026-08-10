import { requireCompletedOnboarding } from "@/lib/dal";
import { error, success, withSessionInfrastructureError } from "@/lib/auth-route";
import { getMockRuleset } from "@/lib/mock/rulesets";

export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireCompletedOnboarding(request));
  if (session instanceof Response) return session;
  if (!session) return Response.json(error("unauthorized", "Completed onboarding required."), { status: 401 });
  const ruleset = getMockRuleset(new URL(request.url).searchParams.get("country") ?? "");
  return ruleset ? Response.json(success(ruleset)) : Response.json(error("not_found", "Ruleset not found."), { status: 404 });
}
