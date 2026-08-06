import { describe, expect, it } from "vitest";
import {
  EXCHANGES,
  EXCHANGE_LINKS_STORAGE_KEY,
  exchangeById,
  loadExchangeLinks,
  maskApiKey,
  parseExchangeLinks,
  saveExchangeLinks,
  type ExchangeLink,
} from "@/lib/exchange/mock-links";

import { memoryStorage } from "@/tests/fixtures/memory-storage";

const link: ExchangeLink = {
  exchangeId: "upbit",
  credentialLabel: "UPBI••••7890",
  connectedAt: "2026-08-01T00:00:00.000Z",
  scope: "read-only",
};

describe("exchange catalog", () => {
  it("keeps ids and mark initials unique so rows stay distinguishable", () => {
    expect(new Set(EXCHANGES.map((exchange) => exchange.id)).size).toBe(EXCHANGES.length);
    expect(new Set(EXCHANGES.map((exchange) => exchange.initials)).size).toBe(EXCHANGES.length);
  });

  it("tells every exchange what the user has to prepare", () => {
    for (const exchange of EXCHANGES) expect(exchange.hint.length).toBeGreaterThan(0);
  });

  it("never asks for a passphrase on an OAuth exchange", () => {
    // OAuth 흐름에는 사용자가 붙여 넣는 값이 없다. 요구 표시가 남아 있으면 화면이 없는 입력란을 약속한다.
    for (const exchange of EXCHANGES.filter((item) => item.method === "oauth")) {
      expect(exchange.requiresPassphrase).toBe(false);
    }
  });

  it("resolves known ids and refuses to invent unknown ones", () => {
    expect(exchangeById("upbit")?.name).toBe("업비트");
    expect(exchangeById("nonexistent-exchange")).toBeNull();
  });
});

describe("maskApiKey", () => {
  it("keeps only the head and tail of a long key", () => {
    expect(maskApiKey("UPBIT-KEY-1234567890")).toBe("UPBI••••7890");
  });

  it("never leaves the original key inside the masked label", () => {
    const key = "AKIA-SECRET-VALUE-0001";
    expect(maskApiKey(key)).not.toContain(key);
    expect(maskApiKey(key)).not.toContain("SECRET");
  });

  it("hides short keys entirely instead of exposing them", () => {
    expect(maskApiKey("short")).toBe("••••••••");
    expect(maskApiKey("  ")).toBe("••••••••");
  });

  it("ignores surrounding whitespace when slicing", () => {
    expect(maskApiKey("  UPBIT-KEY-1234567890  ")).toBe("UPBI••••7890");
  });
});

describe("parseExchangeLinks", () => {
  it("returns nothing for missing or broken storage values", () => {
    expect(parseExchangeLinks(null)).toEqual([]);
    expect(parseExchangeLinks("not json")).toEqual([]);
    expect(parseExchangeLinks(JSON.stringify({ exchangeId: "upbit" }))).toEqual([]);
  });

  it("keeps valid entries even when a neighbouring entry is corrupt", () => {
    const raw = JSON.stringify([{ exchangeId: "upbit" }, link]);
    expect(parseExchangeLinks(raw)).toEqual([link]);
  });

  it("drops exchanges the catalog no longer knows", () => {
    const raw = JSON.stringify([{ ...link, exchangeId: "retired-exchange" }]);
    expect(parseExchangeLinks(raw)).toEqual([]);
  });

  it("drops duplicated exchanges so one exchange cannot appear twice", () => {
    const raw = JSON.stringify([link, { ...link, credentialLabel: "AAAA••••BBBB" }]);
    expect(parseExchangeLinks(raw)).toEqual([link]);
  });

  it("refuses a widened scope", () => {
    const raw = JSON.stringify([{ ...link, scope: "trade" }]);
    expect(parseExchangeLinks(raw)).toEqual([]);
  });
});

describe("exchange link storage", () => {
  it("round-trips through a storage implementation", () => {
    const storage = memoryStorage();
    saveExchangeLinks([link], storage);
    expect(storage.getItem(EXCHANGE_LINKS_STORAGE_KEY)).toBe(JSON.stringify([link]));
    expect(loadExchangeLinks(storage)).toEqual([link]);
  });

  it("treats a missing storage as no links instead of throwing", () => {
    expect(loadExchangeLinks(null)).toEqual([]);
    expect(() => saveExchangeLinks([link], null)).not.toThrow();
  });

  it("survives a storage that rejects reads and writes", () => {
    const blocked = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as Storage;
    expect(loadExchangeLinks(blocked)).toEqual([]);
    expect(() => saveExchangeLinks([link], blocked)).not.toThrow();
  });
});
