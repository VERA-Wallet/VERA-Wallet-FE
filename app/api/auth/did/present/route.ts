import { authStore } from "@/lib/composition-root.server";
import { blankSession, newSessionId, sessionCookie } from "@/lib/mock/auth-store";
import { getMockRuleset } from "@/lib/mock/rulesets";
import { error, sessionIdFrom, success } from "@/lib/auth-route";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !["KR", "US", "UK", "DE"].includes(body.country)) return Response.json(error("invalid_request", "Unsupported country."), { status: 400 });
  const id = sessionIdFrom(request) ?? newSessionId();
  const previous = await authStore.get(id) ?? blankSession();
  const countryCode = body.country as "KR" | "US" | "UK" | "DE";
  // DID 제시는 온보딩의 첫 단계다 — 이전 지갑 클레임을 초기화해
  // 지갑→DID 역순으로 완료 세션이 만들어지는 우회를 차단한다(순서 강제 계약).
  await authStore.set(id, {
    ...previous,
    walletAddress: null,
    chainId: null,
    walletExpiresAt: null,
    didVerified: true,
    countryCode,
    didExpiresAt: Date.now() + 30 * 60_000,
  });
  return new Response(JSON.stringify(success({ countryCode, ruleset: getMockRuleset(countryCode)! })), { headers: { "content-type": "application/json", "set-cookie": sessionCookie(id) } });
}
