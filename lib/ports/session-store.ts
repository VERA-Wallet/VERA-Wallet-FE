/** 지갑이 어떻게 등록됐는가. `siwe`만 소유가 증명된 것이고 `watch_only`는 주소만 받은 것이다. */
export type WalletVerification = "siwe" | "watch_only";

export type OnboardingSession = {
  didVerified: boolean;
  countryCode: string | null;
  walletAddress: string | null;
  // 지갑이 없으면 null. 화면이 "미검증"을 말하려면 등록 방법이 세션에 남아 있어야 한다.
  walletVerification: WalletVerification | null;
  didExpiresAt: number | null;
  walletExpiresAt: number | null;
};

export interface SessionStore {
  get(sessionId: string): Promise<OnboardingSession | null>;
  set(sessionId: string, session: OnboardingSession): Promise<void>;
  destroy(sessionId: string): Promise<void>;
}

export const emptyOnboardingSession = (): OnboardingSession => ({
  didVerified: false,
  countryCode: null,
  walletAddress: null,
  walletVerification: null,
  didExpiresAt: null,
  walletExpiresAt: null,
});
