import { success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { isMockApiMode } from "@/lib/api-mode";
import { mockEvidenceCount, mockEvidenceFailing, resetMockEvidence, setMockEvidenceFailure } from "@/lib/mock/evidence-store";

/**
 * 실패 스위치 — **FE 전용 dev 헬퍼, BE 계약 표면이 아니다.** `app/api/mock/report-anchor-failure/route.ts`를
 * 그대로 옮겨 이름만 바꿨다(계획 §4). 가드도 그대로: production이거나 목업 모드가 아니면 404,
 * 그 뒤 `requireDidSession` 세션 가드(저장소가 사용자 범위이고 이 라우트가 상태를 지운다).
 *
 * `/api/mock/` 접두인 이유: `/api/tax-evidence/**`는 `proxy.ts`가 BE 소유로 잡을 접두다. 제어 라우트를
 * 그 밑에 두면 "BE 소유 접두 안에 FE 전용 dev 헬퍼가 숨어 있는" 모양이 되고, matcher를 넓힐 때마다
 * 이 라우트가 딸려 갈 위험이 남는다. BE 접두 밖으로 빼면 그 사고가 구조적으로 불가능하다.
 * `proxy.ts` allowlist·matcher에 넣지 않는다 — ON 모드에서는 `isMockApiMode()`가 false라 404이므로
 * e2e 스펙이 그 404를 "ON 모드다"의 판별자로 쓴다.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" || !isMockApiMode()) return new Response(null, { status: 404 });
  // 세션 가드: 저장소가 사용자 범위이므로 reset도 인증된 호출이어야 한다. test-login과 달리 이 라우트는 상태를 지운다.
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const body = (await request.json().catch(() => ({}))) as { failing?: boolean; reset?: boolean };
  if (body.reset) resetMockEvidence();
  if (typeof body.failing === "boolean") setMockEvidenceFailure(body.failing);
  return Response.json(success({ failing: mockEvidenceFailing(), records: mockEvidenceCount() }));
}
