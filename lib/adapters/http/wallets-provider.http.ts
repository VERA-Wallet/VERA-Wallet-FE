import "client-only";

import { decodeResponse } from "@/lib/http/error-codec";
import { registeredWalletsSchema, removedWalletSchema, type RegisteredWalletsDTO, type RemovedWalletDTO } from "@/lib/http/dto";
import type { WalletsProvider } from "@/lib/ports/wallets-provider";
import { HoldingsFetchError } from "@/lib/adapters/http/holdings-provider.http";

/** 브라우저에서 `/api/auth/wallets`를 읽는다(ON 모드는 proxy가 BE로 넘긴다). */
export class HttpWalletsProvider implements WalletsProvider {
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async getWallets(): Promise<RegisteredWalletsDTO> {
    const response = await decodeResponse(await this.fetcher("/api/auth/wallets"), registeredWalletsSchema);
    if ("data" in response && "meta" in response) return response.data;
    throw new HoldingsFetchError(response.error.code, response.error.message);
  }

  async removeWallet(address: string): Promise<RemovedWalletDTO> {
    const response = await decodeResponse(await this.fetcher(`/api/auth/wallets/${encodeURIComponent(address)}`, { method: "DELETE" }), removedWalletSchema);
    if ("data" in response && "meta" in response) return response.data;
    throw new HoldingsFetchError(response.error.code, response.error.message);
  }
}
