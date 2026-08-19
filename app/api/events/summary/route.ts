import { error, success, unauthorizedResponse, walletNotBoundResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";

import { summaryProvider } from "@/lib/composition-root.server";
import type { SummaryDTO } from "@/lib/http/dto";

export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const url = new URL(request.url);
  // BE validatePeriod는 falsy 값을 건너뛰므로 빈 값은 400이 아니라 전체 기간으로 처리한다.
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const fromTimestamp = from === undefined ? undefined : Date.parse(from);
  const toTimestamp = to === undefined ? undefined : Date.parse(to);
  // BE validatePeriod 수준으로 완화하되, 파싱 불가 날짜와 역순 기간은 거부한다.
  const validPeriod =
    (fromTimestamp === undefined || Number.isFinite(fromTimestamp)) &&
    (toTimestamp === undefined || Number.isFinite(toTimestamp)) &&
    (fromTimestamp === undefined || toTimestamp === undefined || fromTimestamp < toTimestamp);
  if (!validPeriod) {
    return Response.json(error("invalid_request", "Period query must be RFC 3339 with from earlier than to."), { status: 400 });
  }
  if (session.walletAddress === null) return walletNotBoundResponse();

  const data = await summaryProvider.getSummary({ from, to });
  return Response.json(success<SummaryDTO>(data));
}
