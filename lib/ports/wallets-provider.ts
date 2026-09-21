import type { RegisteredWalletsDTO, RemovedWalletDTO } from "@/lib/http/dto";

/** 등록한 지갑 목록. 잔액 조회(`HoldingsProvider`)와 분리한다 — 무엇을 등록했는지는 잔액 서버와 무관한 사실이다. */
export interface WalletsProvider {
  getWallets(): Promise<RegisteredWalletsDTO>;
  /** 등록한 지갑 하나를 뺀다. 그 지갑에서 불러온 거래도 함께 사라진다 — 되돌릴 수 없다. */
  removeWallet(address: string): Promise<RemovedWalletDTO>;
}
