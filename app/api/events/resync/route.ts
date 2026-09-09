import { randomUUID } from "node:crypto";
import { success, unauthorizedResponse, walletNotBoundResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { MOCK_SYNC_JOB_PREFIX } from "@/lib/mock/resync.server";

/**
 * BE `POST /api/events/resync`의 FE mock. BE와 같이 **작업을 받았다는 사실**만 202로 돌려주고,
 * 결과는 `GET /api/events/resync/[jobId]`가 준다. mock 저장소는 즉시 셀 수 있지만 계약(202 + 폴링)을 같게 둬야
 * OFF 모드에서 폴링 경로가 실제로 돈다.
 */
export async function POST(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  if (session.walletAddress === null) return walletNotBoundResponse();

  const now = new Date().toISOString();
  return Response.json(success({ jobId: `${MOCK_SYNC_JOB_PREFIX}${randomUUID()}`, status: "queued", createdAt: now, updatedAt: now }), { status: 202 });
}
