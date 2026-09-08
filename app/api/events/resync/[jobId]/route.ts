import { error, success, unauthorizedResponse, walletNotBoundResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { isMockSyncJobId, mockResyncResult } from "@/lib/mock/resync.server";

/** BE `GET /api/events/resync/:jobId`의 FE mock. mock 작업은 조회 즉시 완료다 — 결과는 조회 시점에 다시 센다. */
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();
  if (session.walletAddress === null) return walletNotBoundResponse();

  const { jobId } = await context.params;
  if (!isMockSyncJobId(jobId)) return Response.json(error("not_found", "Sync job not found."), { status: 404 });
  const now = new Date().toISOString();
  return Response.json(success({ jobId, status: "done", createdAt: now, updatedAt: now, result: await mockResyncResult() }));
}
