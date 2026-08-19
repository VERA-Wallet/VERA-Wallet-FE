import { requireDidSession } from "@/lib/dal";
import { success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { taxEngine } from "@/lib/composition-root.server";

export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  // BE LegacyRulesetController와의 호환성: country 쿼리는 무시하고 /api/tax/rulesets와 같은 목록 응답을 돌려준다.
  return Response.json(success(await taxEngine.listRuleSets()));
}
