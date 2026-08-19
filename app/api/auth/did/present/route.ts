import { authStore } from "@/lib/composition-root.server";
import { blankSession, newSessionId, sessionCookie } from "@/lib/mock/auth-store";
import { getMockRuleset } from "@/lib/mock/rulesets";
import { error, sessionIdFrom, success } from "@/lib/auth-route";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !["KR", "US", "UK", "DE"].includes(body.country)) return Response.json(error("invalid_request", "country must be one of the following values: KR, DE, US, UK"), { status: 400 });
  const id = sessionIdFrom(request) ?? newSessionId();
  const previous = await authStore.get(id) ?? blankSession();
  const countryCode = body.country as "KR" | "US" | "UK" | "DE";
  // 지갑→DID 역순 우회 차단은 이제 nonce의 DID 가드가 담당한다. BE처럼 기존 지갑 바인딩은 유지한다.
  await authStore.set(id, {
    ...previous,
    didVerified: true,
    countryCode,
    didExpiresAt: Date.now() + 60 * 60_000,
  });
  return new Response(JSON.stringify(success({ countryCode, ruleset: getMockRuleset(countryCode)! })), { status: 201, headers: { "content-type": "application/json", "set-cookie": sessionCookie(id) } });
}
