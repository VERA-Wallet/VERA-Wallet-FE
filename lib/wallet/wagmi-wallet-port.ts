import "client-only";

import { connect, getAccount, signMessage, watchAccount } from "wagmi/actions";
import type { WalletAccount, WalletPort } from "@/lib/ports/wallet-port";
import { wagmiConfig } from "./wagmi-config";

function toWalletAccount(account: { address?: string; chainId?: number; isConnected?: boolean }): WalletAccount | null {
  if (!account.isConnected || !account.address || !account.chainId) return null;
  return { address: account.address, chainId: account.chainId };
}

export const wagmiWalletPort: WalletPort = {
  async connect(kind = "browser") {
    const id = kind === "metamask" ? "metaMaskSDK" : "injected";
    const connector = wagmiConfig.connectors.find(candidate => candidate.id === id);
    if (!connector) throw new Error("지갑 연결 기능을 준비하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    if (kind === "browser" && !await connector.getProvider()) {
      throw new Error("브라우저 지갑을 찾을 수 없습니다. 모바일에서는 MetaMask로 연결을 선택해 주세요.");
    }
    const current = getAccount(wagmiConfig);
    if (current.isConnected && current.connector?.uid === connector.uid && current.address && current.chainId) {
      return { address: current.address, chainId: current.chainId };
    }
    const result = await connect(wagmiConfig, { connector });
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
