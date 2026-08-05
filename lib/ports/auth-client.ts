export type AuthNonce = { nonce: string; domain: string; uri: string; chainId: number; issuedAt: string; expiresAtMs: number };
export type AuthSession = { didVerified: boolean; countryCode: string | null; walletAddress: string | null; chainId: number | null };
export type DidPresentation = { countryCode: "KR" | "US" | "UK" | "DE"; ruleset: { country: string; cost_basis: string; badge_label: string } };

export class AuthClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthClientError";
  }
}
export interface AuthClient {
  requestNonce(input: { chainId: number }): Promise<AuthNonce>;
  verify(input: { message: string; signature: string }): Promise<{ walletAddress: string; chainId: number }>;
  presentDid(input: { country: "KR" | "US" | "UK" | "DE" }): Promise<DidPresentation>;
  logout(): Promise<void>;
  getSession(): Promise<AuthSession>;
}
