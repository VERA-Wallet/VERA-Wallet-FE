export type SiweChallengeRecord = {
  jti: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: string;
  expiresAtMs: number;
  consumedAt: number | null;
};

export interface SiweChallengeStore {
  issue(record: SiweChallengeRecord): Promise<void>;
  peek(jti: string): Promise<SiweChallengeRecord | null>;
  consume(jti: string): Promise<"ok" | "not-found" | "expired" | "already-consumed">;
}
