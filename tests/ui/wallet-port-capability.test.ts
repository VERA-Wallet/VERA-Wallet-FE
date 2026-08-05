import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WalletPort } from "@/lib/ports/wallet-port";

const wallet: WalletPort = {
  connect: async () => ({ address: "0x1", chainId: 1 }),
  getAccount: () => null,
  signMessage: async () => "0xsig",
  subscribeConnection: () => () => undefined,
};

describe("WalletPort capability boundary", () => {
  it("exposes only connection and message signing capabilities", () => {
    expect(Object.keys(wallet)).toEqual(["connect", "getAccount", "signMessage", "subscribeConnection"]);
  });

  it("keeps transaction actions out of the wagmi adapter", () => {
    const source = readFileSync("lib/wallet/wagmi-wallet-port.ts", "utf8");
    expect(source).not.toMatch(/sendTransaction|writeContract|\.request\s*\(/);
  });
});
