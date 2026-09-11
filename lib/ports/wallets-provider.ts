import type { RegisteredWalletsDTO } from "@/lib/http/dto";

/** 등록한 지갑 목록. 잔액 조회(`HoldingsProvider`)와 분리한다 — 무엇을 등록했는지는 잔액 서버와 무관한 사실이다. */
export interface WalletsProvider {
  getWallets(): Promise<RegisteredWalletsDTO>;
}
