import { error, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { inspectMockEvidence } from "@/lib/mock/evidence-store";

/**
 * 체인 대조 — **OFF(FE mock) 전용**. ON 모드에서는 `proxy.ts`가 이 경로를 BE로 넘기고,
 * BE가 실제 OmniOne 노드에서 트랜잭션을 읽어 calldata의 해시를 대조한다.
 * 여기서는 체인이 없으므로 저장해 둔 기록을 그대로 답한다(흐름이 끊기지 않게 하는 데모 경로).
 */
export async function GET(request: Request, { params }: { params: Promise<{ merkleRoot: string }> }) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const { merkleRoot } = await params;
  const check = inspectMockEvidence(session.walletAddress ?? "did-only", merkleRoot);
  if (!check) return Response.json(error("not_found", "Evidence document not found."), { status: 404 });
  return Response.json(success(check));
}
