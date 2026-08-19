import { requireDidSession } from "@/lib/dal";
import { error, success, unauthorizedResponse, walletNotBoundResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { taxEngine } from "@/lib/composition-root.server";
import { taxEstimateRequestSchema } from "@/lib/http/tax-dto";
import { MarginalBudgetError, UnknownRuleSetError } from "@/lib/tax/engine";

export async function POST(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const payload: unknown = await request.json().catch(() => null);
  const parsed = taxEstimateRequestSchema.safeParse(payload);
  if (!parsed.success) return Response.json(error("invalid_request", "Invalid estimate request.", parsed.error.issues), { status: 400 });
  // BE는 source를 무시하고 항상 listOrSync를 타므로 지갑 없으면 404 — FE는 scenario 충실도를 지키되 wallet source만 BE와 같은 404.
  if (parsed.data.source === "wallet" && session.walletAddress === null) return walletNotBoundResponse();

  try {
    return Response.json(success(await taxEngine.estimate(parsed.data)));
  } catch (cause) {
    if (cause instanceof MarginalBudgetError) return Response.json(error("payload_too_large", "Marginal contribution budget exceeded."), { status: 413 });
    if (cause instanceof UnknownRuleSetError) return Response.json(error("not_found", "Ruleset not found."), { status: 404 });
    // ON 모드에서는 계산 입력을 BE에서 읽는다. 그 조회가 거절되면 원인을 그대로 전한다 —
    // 500 HTML로 흘리면 화면이 원인을 모르고, 빈 결과로 뭉개면 "계산할 거래가 없다"는 거짓말이 된다.
    const { BeEventReadError } = await import("@/lib/adapters/http/event-repository.server");
    if (cause instanceof BeEventReadError) return Response.json(error(cause.code, cause.message), { status: cause.status });
    const { EventCollectionTruncatedError } = await import("@/lib/collect/bounded-event-collector");
    if (cause instanceof EventCollectionTruncatedError) return Response.json(error("upstream_truncated", "거래를 끝까지 불러오지 못해 계산을 중단했습니다."), { status: 502 });
    // 세션은 통과했는데 이벤트 조회가 타임아웃·네트워크로 실패하는 경우가 있다.
    // 이걸 그대로 던지면 Next가 500 HTML을 돌려줘 화면이 원인을 모른다 — 세션 경계와 같은 502 계약으로 맞춘다.
    const { SessionInfrastructureError } = await import("@/lib/ports/session-reader");
    if (cause instanceof SessionInfrastructureError) return Response.json(error("upstream_unavailable", "인증 서버에서 정상적인 응답을 받지 못했습니다."), { status: 502 });
    throw cause;
  }
}
