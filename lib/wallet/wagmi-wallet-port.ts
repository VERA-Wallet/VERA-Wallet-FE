import "client-only";

import { connect, getAccount, signMessage, watchAccount } from "wagmi/actions";
import type { WalletAccount, WalletPort } from "@/lib/ports/wallet-port";
import { wagmiConfig } from "./wagmi-config";

function toWalletAccount(account: { address?: string; chainId?: number; isConnected?: boolean }): WalletAccount | null {
  if (!account.isConnected || !account.address || !account.chainId) return null;
  return { address: account.address, chainId: account.chainId };
}

export const wagmiWalletPort: WalletPort = {
  async connect() {
    const result = await connect(wagmiConfig, { connector: wagmiConfig.connectors[0] });
    return { address: result.accounts[0], chainId: result.chainId };
  },
  getAccount() {
    return toWalletAccount(getAccount(wagmiConfig));
  },
  signMessage(message, account) {
    return signMessage(wagmiConfig, { message, ...(account ? { account: account.address as `0x${string}` } : {}) });
  },
  subscribeConnection(callback) {
    return watchAccount(wagmiConfig, {
      onChange(account) {
        callback(toWalletAccount(account));
      },
    });
  },
};
