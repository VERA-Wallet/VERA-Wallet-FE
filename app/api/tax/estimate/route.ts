import { requireCompletedOnboarding } from "@/lib/dal";
import { error, success } from "@/lib/auth-route";
import { taxEngine } from "@/lib/composition-root.server";
import { taxEstimateRequestSchema } from "@/lib/http/tax-dto";
import { MarginalBudgetError, UnknownRuleSetError } from "@/lib/tax/engine";

export async function POST(request: Request) {
  if (!await requireCompletedOnboarding(request)) return Response.json(error("unauthorized", "Completed onboarding required."), { status: 401 });

  const payload: unknown = await request.json().catch(() => null);
  const parsed = taxEstimateRequestSchema.safeParse(payload);
  if (!parsed.success) return Response.json(error("invalid_request", "Invalid estimate request.", parsed.error.issues), { status: 400 });

  try {
    return Response.json(success(await taxEngine.estimate(parsed.data)));
  } catch (cause) {
    if (cause instanceof MarginalBudgetError) return Response.json(error("payload_too_large", "Marginal contribution budget exceeded."), { status: 413 });
    if (cause instanceof UnknownRuleSetError) return Response.json(error("not_found", "Ruleset not found."), { status: 404 });
    throw cause;
  }
}
