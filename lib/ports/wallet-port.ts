export interface WalletAccount {
  address: string;
  chainId: number;
}

export interface WalletPort {
  connect(): Promise<WalletAccount>;
  getAccount(): WalletAccount | null;
  signMessage(message: string): Promise<string>;
  subscribeConnection(callback: (state: WalletAccount | null) => void): () => void;
}
