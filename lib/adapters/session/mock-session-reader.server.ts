import "server-only";

import { SESSION_COOKIE } from "@/lib/mock/auth-store";
import type { SessionSnapshot } from "@/lib/ports/session-snapshot";
import type { SessionReader } from "@/lib/ports/session-reader";
import type { SessionStore } from "@/lib/ports/session-store";

export class MockSessionReader implements SessionReader {
  readonly cookieMode = "raw" as const;

  constructor(private readonly store: SessionStore) {}

  async read(cookieHeader: string | undefined): Promise<SessionSnapshot> {
    const sessionId = cookieHeader?.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (!sessionId) return { source: "anonymous" };

    // RSC에서 Request 없이 자기 서버를 HTTP로 다시 부르면 self-fetch가 불가능하고 SSRF·루프 위험도 있다.
    const session = await this.store.get(sessionId);
    // walletExpiresAt은 여기서 검사하지 않는다 — DID 제시 직후에는 지갑 클레임이 비어 있는 것이 정상이다(온보딩 순서 강제).
    if (!session || !session.didVerified || session.countryCode === null || session.didExpiresAt === null) return { source: "anonymous" };

    return {
      source: "mock",
      didVerified: true,
      countryCode: session.countryCode,
      walletAddress: session.walletAddress,
      walletVerification: session.walletVerification,
      didExpiresAt: session.didExpiresAt,
      walletExpiresAt: session.walletExpiresAt,
    };
  }
}
