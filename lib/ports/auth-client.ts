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
  /** cxToken: OmniOne CX 표준인증창 성공 콜백의 일회용 토큰. 없으면 mock 프레젠테이션으로 동작한다. */
  presentDid(input: { country: "KR" | "US" | "UK" | "DE"; cxToken?: string }): Promise<DidPresentation>;
  logout(): Promise<void>;
  getSession(): Promise<AuthSession>;
}
