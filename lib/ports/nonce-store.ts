export type SiweChallengeRecord = {
  jti: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: string;
  expiresAtMs: number;
  consumedAt: number | null;
  // BE는 wallet-challenge 서비스에서 challenge를 user에 귀속시키지만, mock은 세션 id가 그 경계다.
  sessionId: string;
};

export interface SiweChallengeStore {
  issue(record: SiweChallengeRecord): Promise<void>;
  peek(jti: string): Promise<SiweChallengeRecord | null>;
  // 소유자 검사와 소비를 한 연산으로 묶어 durable store(Redis/DB) 전환 시 TOCTOU가 생기지 않게 경계를 store 계약에 내장한다.
  consume(jti: string, sessionId: string): Promise<"ok" | "not-found" | "expired" | "already-consumed">;
}
