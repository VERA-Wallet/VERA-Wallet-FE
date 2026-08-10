export type SessionSnapshot =
  | { source: "anonymous" }
  // BE는 요청 시점이 곧 검증 시점이고 JWT exp가 만료를 담당하므로 FE가 별도 만료를 보관하지 않는다.
  | { source: "be"; didVerified: true; countryCode: string; walletAddress: string | null; chainId: number | null }
  // mock만 로컬 30분 타임스탬프를 가진다. 이를 union으로 분리해 { source: "be", didExpiresAt: ... } 같은 불가능한 조합을 막는다.
  // walletExpiresAt이 nullable인 이유: DID 제시 직후 세션은 지갑 클레임이 비어 있고(온보딩 순서 강제) 그때 walletExpiresAt도 null이다.
  // 여기서 non-null을 요구하면 DID-only 사용자가 전부 익명으로 떨어져 /connect-wallet이 /login으로 튄다.
  | { source: "mock"; didVerified: true; countryCode: string; walletAddress: string | null; chainId: number | null; didExpiresAt: number; walletExpiresAt: number | null };

export const anonymousSnapshot = (): SessionSnapshot => ({ source: "anonymous" });
