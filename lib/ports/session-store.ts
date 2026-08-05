export type OnboardingSession = {
  didVerified: boolean;
  countryCode: string | null;
  walletAddress: string | null;
  chainId: number | null;
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
  chainId: null,
  didExpiresAt: null,
  walletExpiresAt: null,
});
