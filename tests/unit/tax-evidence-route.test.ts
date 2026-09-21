import { afterEach, describe, expect, it, vi } from "vitest";

import { resetMockEvidence } from "@/lib/mock/evidence-store";
import { buildEvidenceDocument } from "@/lib/tax/evidence";
import { SessionInfrastructureError } from "@/lib/ports/session-reader";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";

/**
 * `POST /api/tax-evidence`의 저장 순서 회귀 테스트(계획 §0 WP0 — `route.ts:37-42`).
 *
 * 옛 순서는 먼저 저장하고 나서 루트를 대조했다. FE가 보낸 루트가 서버 재계산과 어긋나면 400을
 * 돌려주면서도, 저장소에는 이미 그 문서가 들어가 있었다 — "400을 받았는데 조회하면 있다"는
 * 유령 기록이 남는다. 이 파일은 그 결함이 다시 들어오지 않는지만 고정한다(저장소 전이는
 * `tests/unit/evidence-store.test.ts`가 맡는다).
 */

const requireDidSession = vi.fn();
vi.mock("@/lib/dal", () => ({ requireDidSession }));

// 정적 import는 ESM 호이스팅으로 `vi.mock` 팩토리보다 먼저 평가돼 위 `const`를 "초기화 전 접근"으로 만든다
// (`tests/unit/report-anchor-route.test.ts:10`과 같은 이유). 그래서 라우트를 매 호출마다 동적으로 불러온다.
const session = (walletAddress: string | null) => ({ source: "mock" as const, didVerified: true, countryCode: "KR", walletAddress, chainId: null });

async function postEvidence(body: unknown) {
  const { POST } = await import("@/app/api/tax-evidence/route");
  return POST(new Request("http://localhost/api/tax-evidence", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
}

async function getLatest(country: string, taxYear: number) {
  const { GET } = await import("@/app/api/tax-evidence/route");
  return GET(new Request(`http://localhost/api/tax-evidence?country=${country}&taxYear=${taxYear}`));
}

function validDocument() {
  return buildEvidenceDocument(EVIDENCE_FIXTURE_ESTIMATE);
}

afterEach(() => {
  requireDidSession.mockReset();
  resetMockEvidence();
});

describe("POST /api/tax-evidence — 순서 결함 회귀", () => {
  it("루트가 어긋나면 400이고, 아무것도 저장하지 않는다", async () => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    const document = validDocument();
    const wrongRoot = `0x${"b".repeat(64)}`;

    const response = await postEvidence({ version: 1, leaves: document.leaves, merkleRoot: wrongRoot });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });

    // 저장이 안 됐어야 한다 — 같은 국가·연도로 조회해도 아무 기록이 없다.
    const header = document.leaves[0] as { country: string; taxYear: number };
    const lookup = await getLatest(header.country, header.taxYear);
    expect(lookup.status).toBe(404);
  });

  it("루트가 맞으면(또는 생략하면) 200으로 저장한다", async () => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    const document = validDocument();

    const response = await postEvidence({ version: 1, leaves: document.leaves, merkleRoot: document.merkleRoot });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.merkleRoot.toLowerCase()).toBe(document.merkleRoot.toLowerCase());
    expect(body.data.anchorStatus).toBe("pending");

    const header = document.leaves[0] as { country: string; taxYear: number };
    const lookup = await getLatest(header.country, header.taxYear);
    expect(lookup.status).toBe(200);
  });

  it("첫 잎이 헤더가 아니면 400이고 저장하지 않는다", async () => {
    requireDidSession.mockResolvedValue(session("0xabc"));
    const document = validDocument();
    const withoutHeader = document.leaves.slice(1);

    const response = await postEvidence({ version: 1, leaves: withoutHeader });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_request" } });
  });
});

describe("POST /api/tax-evidence — 세션", () => {
  it("401 without a DID session", async () => {
    requireDidSession.mockResolvedValue(null);
    const document = validDocument();
    expect((await postEvidence({ version: 1, leaves: document.leaves })).status).toBe(401);
  });

  it("502 when the session infrastructure is down", async () => {
    requireDidSession.mockRejectedValue(new SessionInfrastructureError("timeout", "slow"));
    const document = validDocument();
    const response = await postEvidence({ version: 1, leaves: document.leaves });
    expect(response.status).toBe(502);
  });
});
