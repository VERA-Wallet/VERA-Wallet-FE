import type { WalletVerification } from "@/lib/ports/session-store";

/**
 * 지갑 등록 방법. 선택 필드인 이유는 BE 세션 계약이 아직 이 값을 내려주지 않기 때문이다.
 * `undefined`는 "모른다"이지 "검증됐다"가 아니므로, 화면은 `watch_only`가 명시됐을 때만 미검증을 말한다.
 */
export type SessionWalletVerification = WalletVerification | null;

export type SessionSnapshot =
  | { source: "anonymous" }
  // BE는 요청 시점이 곧 검증 시점이고 JWT exp가 만료를 담당하므로 FE가 별도 만료를 보관하지 않는다.
  | { source: "be"; didVerified: true; countryCode: string; walletAddress: string | null; walletVerification?: SessionWalletVerification }
  // mock은 로컬 60분 타임스탬프를 가진다(BE JWT 1h와 대칭). 이를 union으로 분리해 { source: "be", didExpiresAt: ... } 같은 불가능한 조합을 막는다.
  // walletExpiresAt이 nullable인 이유: DID 제시 직후 세션은 지갑 클레임이 비어 있고(온보딩 순서 강제) 그때 walletExpiresAt도 null이다.
  // 여기서 non-null을 요구하면 DID-only 사용자가 전부 익명으로 떨어져 /connect-wallet이 /login으로 튄다.
  | { source: "mock"; didVerified: true; countryCode: string; walletAddress: string | null; walletVerification?: SessionWalletVerification; didExpiresAt: number; walletExpiresAt: number | null };

export const anonymousSnapshot = (): SessionSnapshot => ({ source: "anonymous" });
