export interface WalletAccount {
  address: string;
  chainId: number;
}

export interface WalletPort {
  connect(kind?: "browser" | "metamask"): Promise<WalletAccount>;
  getAccount(): WalletAccount | null;
  signMessage(message: string, account?: WalletAccount): Promise<string>;
  subscribeConnection(callback: (state: WalletAccount | null) => void): () => void;
}
