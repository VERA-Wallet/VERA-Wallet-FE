import { authStore } from "@/lib/composition-root.server";
import { newSessionId, sessionCookie } from "@/lib/mock/auth-store";

// Development-only e2e helper; never issue completed sessions in production.
export async function POST() {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const id = newSessionId();
  const expiresAt = Date.now() + 30 * 60_000;
  await authStore.set(id, { didVerified: true, countryCode: "KR", walletAddress: "0x0000000000000000000000000000000000000001", chainId: 1, didExpiresAt: expiresAt, walletExpiresAt: expiresAt });
  return new Response(null, { status: 204, headers: { "set-cookie": sessionCookie(id) } });
}
