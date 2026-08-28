export type AuthNonce = { nonce: string; domain: string; uri: string; chainId: number; issuedAt: string; expiresAtMs: number };
// 세션에는 chainId가 없다. EVM 주소는 체인 불문 동일하고, 활동 체인은 인덱싱된 이벤트 데이터의 사실이다.
export type AuthSession = { didVerified: boolean; countryCode: string | null; walletAddress: string | null };
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
  verify(input: { message: string; signature: string }): Promise<{ walletAddress: string; chainId: number }>; // chainId는 서명 메시지 실측값 echo
  /**
   * 서명 없이 주소만으로 지갑을 등록한다(보기 전용).
   *
   * 거래 조회에는 주소만 있으면 되므로 하드웨어·컨트랙트·과거 지갑도 이 경로로 들어온다.
   * 소유 증명이 없으니 verify로 등록한 지갑과 같은 취급을 받아서는 안 된다.
   */
  registerWatchWallet(input: { address: string }): Promise<{ walletAddress: string }>; // 워치온리는 서명된 체인이 없어 chainId를 반환하지 않는다
  /** cxToken: OmniOne CX 표준인증창 성공 콜백의 일회용 토큰. 없으면 mock 프레젠테이션으로 동작한다. */
  presentDid(input: { country: "KR" | "US" | "UK" | "DE"; cxToken?: string }): Promise<DidPresentation>;
  logout(): Promise<void>;
  getSession(): Promise<AuthSession>;
}
