import { error, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { registerMockReportAnchor } from "@/lib/mock/report-anchor-store";
import type { ReportAnchorInput } from "@/lib/ports/report-anchor";

/**
 * OFF 저장소의 사용자 키. `app/api/tax-evidence/route.ts:10`과 같은 규칙(mock 세션에는 DID 해시가
 * 없고 이 저장소는 단일 프로세스·단일 사용자 데모용이라 지갑 주소로 모은다). **두 라우트에 각각 두고
 * 주석으로 같은 규칙임을 밝힌다** — mock 사용자 키는 OFF 데모 전용이라 공용 모듈로 올리면
 * "계약처럼 보이는 것"이 하나 더 생긴다.
 */
function mockUserKey(session: { walletAddress: string | null }): string {
  return session.walletAddress ?? "did-only";
}

/**
 * 리포트 파일 해시 등록 — **OFF(FE mock) 전용**이다.
 *
 * ON 모드에서는 같은 경로가 `proxy.ts`의 allowlist를 타고 BE로 넘어가고, BE가 해시를 저장소에
 * 남기고 OmniOne 체인에 등록한다. 계약은 `docs/be-contract-draft-report-anchor.md`.
 */
export async function POST(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  let body: Partial<ReportAnchorInput>;
  try {
    body = (await request.json()) as Partial<ReportAnchorInput>;
  } catch {
    return Response.json(error("invalid_request", "Body must be JSON."), { status: 400 });
  }

  if (body.version !== 1) {
    return Response.json(error("invalid_request", "version must be 1."), { status: 400 });
  }
  if (body.algorithm !== "keccak256" && body.algorithm !== "sha256") {
    return Response.json(error("invalid_request", "algorithm must be keccak256 or sha256."), { status: 400 });
  }
  if (typeof body.fileHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(body.fileHash)) {
    return Response.json(error("invalid_request", "fileHash must be a 32-byte hex digest."), { status: 400 });
  }
  if (body.kind !== "csv" && body.kind !== "xlsx") {
    return Response.json(error("invalid_request", "kind must be csv or xlsx."), { status: 400 });
  }
  if (typeof body.countryCode !== "string" || body.countryCode.length === 0) {
    return Response.json(error("invalid_request", "countryCode is required."), { status: 400 });
  }
  if (typeof body.taxYear !== "number" || !Number.isInteger(body.taxYear)) {
    return Response.json(error("invalid_request", "taxYear must be an integer."), { status: 400 });
  }
  if (typeof body.byteLength !== "number" || !Number.isInteger(body.byteLength) || body.byteLength < 0) {
    return Response.json(error("invalid_request", "byteLength must be a non-negative integer."), { status: 400 });
  }

  // countryCode는 라우트 경계에서 대문자로 정규화한다 — 저장소 키와 stale 비교의 대소문자 비대칭을 막는다.
  const record = registerMockReportAnchor(mockUserKey(session), {
    version: 1,
    algorithm: body.algorithm,
    fileHash: body.fileHash,
    kind: body.kind,
    countryCode: body.countryCode.toUpperCase(),
    taxYear: body.taxYear,
    byteLength: body.byteLength,
  });
  return Response.json(success(record));
}
