import { authStore } from "@/lib/composition-root.server";
import { SESSION_COOKIE, sessionCookie } from "@/lib/mock/auth-store";
import { sessionIdFrom } from "@/lib/auth-route";

export async function POST(request: Request) {
  const id = sessionIdFrom(request);
  if (id) await authStore.destroy(id);
  return new Response(null, { status: 204, headers: { "set-cookie": sessionCookie("", 0), "x-session-cookie": SESSION_COOKIE } });
}
