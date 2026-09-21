import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

  it("keeps the export anchor path free of chain writes", () => {
    // 파일 해시 등록은 BE가 체인에 올린다. 화면·어댑터·파일 생성 어디에도 지갑 트랜잭션이 없어야 한다.
    // 파일 세 개를 손으로 적는 대신 디렉터리를 훑는다 — 새 파일이 스캔을 빠져나가지 못한다.
    for (const dir of ["components/report", "lib/adapters/http", "lib/export"]) {
      for (const file of readdirSync(dir, { recursive: true }) as string[]) {
        if (!/\.tsx?$/.test(file)) continue;
        expect(readFileSync(join(dir, file), "utf8")).not.toMatch(/sendTransaction|writeContract|\.request\s*\(/);
      }
    }
  });
});
