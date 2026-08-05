import { authStore } from "@/lib/composition-root.server";
import { blankSession } from "@/lib/mock/auth-store";
import { sessionIdFrom, success } from "@/lib/auth-route";

export async function GET(request: Request) {
  const session = await authStore.get(sessionIdFrom(request) ?? "") ?? blankSession();
  return Response.json(success({ didVerified: session.didVerified, countryCode: session.countryCode, walletAddress: session.walletAddress, chainId: session.chainId }));
}
