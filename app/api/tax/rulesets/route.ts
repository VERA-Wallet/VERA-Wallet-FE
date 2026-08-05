import { requireCompletedOnboarding } from "@/lib/dal";
import { error, success } from "@/lib/auth-route";
import { taxEngine } from "@/lib/composition-root.server";

export async function GET(request: Request) {
  if (!await requireCompletedOnboarding(request)) return Response.json(error("unauthorized", "Completed onboarding required."), { status: 401 });
  return Response.json(success(await taxEngine.listRuleSets()));
}
