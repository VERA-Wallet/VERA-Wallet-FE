import { error, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { getMockReportAnchor } from "@/lib/mock/report-anchor-store";

/**
 * OFF 저장소의 사용자 키. `app/api/tax-evidence/route.ts:10`과 같은 규칙. **두 라우트에 각각 두고
 * 주석으로 같은 규칙임을 밝힌다** — mock 사용자 키는 OFF 데모 전용이라 공용 모듈로 올리면
 * "계약처럼 보이는 것"이 하나 더 생긴다.
 */
function mockUserKey(session: { walletAddress: string | null }): string {
  return session.walletAddress ?? "did-only";
}

/**
 * 등록 기록 조회 — **OFF(FE mock) 전용**이다. 메타 셋(`kind`·`countryCode`·`taxYear`)은 쿼리로 받고
 * 전부 필수다 — 빠지면 400이다. 기본값을 넣으면 "연도를 안 보낸 조회"가 조용히 다른 연도의
 * 레코드를 집어 온다(estimate가 없는 기간의 리포트는 국가·연도가 달라도 파일 바이트가 같다).
 */
export async function GET(request: Request, { params }: { params: Promise<{ fileHash: string }> }) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const { fileHash } = await params;
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  const countryCode = query.get("countryCode");
  // `Number(query.get("taxYear"))`는 값이 없거나 빈 문자열이면 0이 되어 `isInteger`를 통과하는 함정이 있다
  // (`Number(null) === 0`) — 원문 문자열을 먼저 형식으로 검증한 뒤에만 숫자로 바꾼다.
  const rawTaxYear = query.get("taxYear");
  if ((kind !== "csv" && kind !== "xlsx") || !countryCode || rawTaxYear === null || !/^\d{4}$/.test(rawTaxYear)) {
    return Response.json(error("invalid_request", "kind, countryCode and taxYear are required."), { status: 400 });
  }
  const taxYear = Number(rawTaxYear);

  // 내 기록만 답한다. 남의 기록에 200을 주면 "그 파일이 존재하는가"를 묻는 오라클이 된다.
  // countryCode는 라우트 경계에서 대문자로 정규화한다 — 저장소 키와 stale 비교의 대소문자 비대칭을 막는다.
  const record = getMockReportAnchor(mockUserKey(session), { fileHash, kind, countryCode: countryCode.toUpperCase(), taxYear });
  if (!record) return Response.json(error("not_found", "No anchor record for that file."), { status: 404 });
  return Response.json(success(record));
}
