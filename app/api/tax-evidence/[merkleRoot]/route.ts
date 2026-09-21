import { error, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { documentMockEvidence } from "@/lib/mock/evidence-store";

/**
 * 루트가 덮는 정본 문서 + 기록 정보 — **OFF(FE mock) 전용**. ON 모드에서는 `proxy.ts`가 이 경로를 BE로 넘기고,
 * BE가 `TaxEvidence.document`에 저장한 잎을 기록 정보(거래 해시·블록·시각)와 함께 돌려준다.
 * 근거 화면(`/export/evidence/<루트>`)이 "체인의 해시 ← 머클루트 ← 이 판정들"을 그리는 데 쓴다.
 */
export async function GET(request: Request, { params }: { params: Promise<{ merkleRoot: string }> }) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const { merkleRoot } = await params;
  const detail = documentMockEvidence(session.walletAddress ?? "did-only", merkleRoot);
  if (!detail) return Response.json(error("not_found", "Evidence document not found."), { status: 404 });
  return Response.json(success(detail));
}
