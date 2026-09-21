import { error, success, unauthorizedResponse, withSessionInfrastructureError } from "@/lib/auth-route";
import { requireDidSession } from "@/lib/dal";
import { latestMockEvidence, recordMockEvidence } from "@/lib/mock/evidence-store";
import { merkleRoot } from "@/lib/tax/evidence";
import type { EvidenceLeaf } from "@/lib/tax/evidence";

/**
 * OFF 저장소의 사용자 키. FE mock 세션에는 DID 해시가 없고(BE만 쥔다) 이 저장소는 단일 프로세스·
 * 단일 사용자 데모용이므로, 지갑 주소를 쓰고 지갑 연결 전에는 한 칸으로 모은다.
 */
function mockUserKey(session: { walletAddress: string | null }): string {
  return session.walletAddress ?? "did-only";
}

/**
 * 계산 근거 기록 — **OFF(FE mock) 전용**이다.
 *
 * ON 모드에서는 같은 경로가 `proxy.ts`의 allowlist를 타고 BE로 넘어가고, BE가 잎에서 루트를 다시
 * 계산해 OmniOne 체인에 올린다. 여기 구현은 체인 없이도 흐름이 끊기지 않게 하는 데모 경로이며,
 * 루트 계산만은 실제와 같은 규칙(`lib/tax/evidence.ts`)을 쓴다.
 */
export async function POST(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  let body: { version?: number; leaves?: EvidenceLeaf[]; merkleRoot?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(error("invalid_request", "Body must be JSON."), { status: 400 });
  }
  if (body.version !== 1 || !Array.isArray(body.leaves) || body.leaves.length === 0) {
    return Response.json(error("invalid_request", "version and leaves are required."), { status: 400 });
  }

  try {
    // BE와 같은 순서(evidence.service.ts): 루트를 먼저 계산·대조하고, 어긋나면 아무것도 저장하지 않는다.
    // 먼저 저장부터 하면(옛 순서) 루트가 어긋난 문서도 저장소에 남아, 다음 조회가 "저장은 됐는데
    // 루트가 다른" 유령 기록을 돌려준다(계획 §9의 WP0 순서 결함 근거).
    const header = body.leaves[0];
    if (!header || header.kind !== "header") {
      return Response.json(error("invalid_request", "첫 잎은 헤더여야 합니다."), { status: 400 });
    }
    const root = merkleRoot(body.leaves);
    if (body.merkleRoot && body.merkleRoot.toLowerCase() !== root.toLowerCase()) {
      return Response.json(error("invalid_request", "Evidence merkle root mismatch."), { status: 400 });
    }
    const record = recordMockEvidence(mockUserKey(session), body.leaves);
    return Response.json(success(record));
  } catch (cause) {
    return Response.json(error("invalid_request", cause instanceof Error ? cause.message : "Invalid evidence."), { status: 400 });
  }
}

export async function GET(request: Request) {
  const session = await withSessionInfrastructureError(() => requireDidSession(request));
  if (session instanceof Response) return session;
  if (!session) return unauthorizedResponse();

  const params = new URL(request.url).searchParams;
  const country = params.get("country");
  const taxYear = Number(params.get("taxYear"));
  if (!country || !Number.isInteger(taxYear)) {
    return Response.json(error("invalid_request", "country and taxYear are required."), { status: 400 });
  }
  const record = latestMockEvidence(mockUserKey(session), country, taxYear);
  if (!record) return Response.json(error("not_found", "No recorded evidence for that tax year."), { status: 404 });
  return Response.json(success(record));
}
