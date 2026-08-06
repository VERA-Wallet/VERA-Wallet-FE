import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assetLabel, explorerTxUrl, formatDate, formatFiat } from "@/lib/format";
import { isoDay } from "@/lib/period";
import { taxYearFor } from "@/lib/tax/engine";

describe("금액 표기는 값을 숨기지 않는다", () => {
  it("통화 관례 자릿수를 따른다", () => {
    expect(formatFiat("1015.44", "EUR")).toBe("€1,015.44");
    expect(formatFiat("58180", "KRW")).toBe("₩58,180");
  });

  it("관례보다 잔여 소수가 많으면 반올림해 숨기지 않는다", () => {
    // ₩13,130.5를 ₩13,131로 보이면 화면이 계산과 다른 말을 한다.
    expect(formatFiat("13130.5", "KRW")).toBe("₩13,130.5");
  });

  it("후행 0은 자릿수로 세지 않는다", () => {
    expect(formatFiat("58180.00", "KRW")).toBe("₩58,180");
    expect(formatFiat("1015.40", "EUR")).toBe("€1,015.40");
  });

  it("null은 —, 숫자가 아니면 원문을 그대로 보인다", () => {
    expect(formatFiat(null, "EUR")).toBe("—");
    expect(formatFiat("n/a", "EUR")).toBe("n/a EUR");
  });

  it("대시보드와 세금 탭이 같은 금액을 같게 그린다", () => {
    // 두 화면이 각자 포맷터를 들고 자릿수가 갈라졌던 회귀.
    // 통화 포맷터는 lib/format.ts 하나뿐이어야 한다. 두 번째가 생기면 자릿수가 갈라진다.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (full.endsWith(join("lib", "format.ts"))) continue;
        if (/style:\s*"currency"/.test(readFileSync(full, "utf8"))) offenders.push(full);
      }
    };
    for (const root of ["app", "components", "lib"]) walk(join(process.cwd(), root));
    expect(offenders).toEqual([]);
  });
});

describe("금액 표기가 값을 바꾸지 않는다", () => {
  it("2^53을 넘는 금액도 원래 자릿수 그대로 보인다", () => {
    // Number(value)를 태우면 9007199254740993 → 9007199254740992로 바뀐다.
    expect(formatFiat("9007199254740993", "KRW")).toBe("₩9,007,199,254,740,993");
    expect(formatFiat("9007199254740992", "KRW")).toBe("₩9,007,199,254,740,992");
    expect(formatFiat("9007199254740993", "KRW")).not.toBe(formatFiat("9007199254740992", "KRW"));
  });

  it("소수 셋째 자리는 반올림하되 자리올림을 흘리지 않는다", () => {
    expect(formatFiat("1.005", "EUR")).toBe("€1.01");
    expect(formatFiat("9.999", "EUR")).toBe("€10.00");
    expect(formatFiat("0.994", "EUR")).toBe("€0.99");
    expect(formatFiat("999999999999999999.999", "EUR")).toBe("€1,000,000,000,000,000,000.00");
  });

  it("소수 없는 통화도 잔여 소수가 있으면 최대 2자리까지 보인다", () => {
    // KRW 관례는 0자리다. 그렇다고 0.005를 ₩0으로 지우면 값을 숨긴 것이다.
    expect(formatFiat("0.005", "KRW")).toBe("₩0.01");
    expect(formatFiat("0.004", "KRW")).toBe("₩0.00");
    expect(formatFiat("13130.5", "KRW")).toBe("₩13,130.5");
  });

  it("음수와 0을 정확히 그린다", () => {
    expect(formatFiat("-39000", "KRW")).toBe("-₩39,000");
    expect(formatFiat("-1015.44", "EUR")).toBe("-€1,015.44");
    expect(formatFiat("0", "EUR")).toBe("€0.00");
    expect(formatFiat("0", "KRW")).toBe("₩0");
    expect(formatFiat("-0.00", "EUR")).toBe("-€0.00");
  });

  it("천 단위 구분이 자릿수와 무관하게 일정하다", () => {
    expect(formatFiat("100", "KRW")).toBe("₩100");
    expect(formatFiat("1000", "KRW")).toBe("₩1,000");
    expect(formatFiat("1234567890", "KRW")).toBe("₩1,234,567,890");
    expect(formatFiat("007", "KRW")).toBe("₩7");
  });

  it("금액 포매터에 Number 변환이 남아 있지 않다", () => {
    // 한 자리라도 Number를 태우면 다음 사람이 그 패턴을 넓힌다. 계약을 소스로 못 박는다.
    const source = readFileSync(join(process.cwd(), "lib/format.ts"), "utf8");
    expect(source).not.toMatch(/\bNumber\s*\(/);
    expect(source).not.toMatch(/parseFloat|parseInt/);
  });

  it("십진 문자열이 아니면 원문을 보인다", () => {
    for (const bad of ["", "1e5", "abc", "1.2.3", "--1", " 1 2 "]) {
      expect(formatFiat(bad, "EUR"), bad).toBe(`${bad} EUR`);
    }
    // 앞뒤 공백은 정상 값으로 받는다.
    expect(formatFiat(" 1015.44 ", "EUR")).toBe("€1,015.44");
  });
});

describe("자산 이름은 아는 만큼만 말한다", () => {
  const base = { chain_id: 1, asset_type: "ERC20" as const, token_id: null, asset_symbol: null };

  it("심볼을 알면 그것으로 부른다", () => {
    expect(assetLabel({ ...base, asset_symbol: "USDC" })).toBe("USDC");
    expect(assetLabel({ ...base, asset_type: "NATIVE", asset_symbol: "ETH" })).toBe("ETH");
  });

  it("NFT는 컬렉션 심볼과 토큰 번호를 함께 둔다", () => {
    // 심볼만 두면 같은 컬렉션의 다른 개체가 화면에서 구분되지 않는다.
    expect(assetLabel({ ...base, asset_type: "ERC721", token_id: "102", asset_symbol: "BAYC" })).toBe("BAYC #102");
  });

  it("모르면 지어내지 않고 모른다는 표시를 쓴다", () => {
    expect(assetLabel(base)).toBe("ERC20");
    expect(assetLabel({ ...base, asset_type: "ERC721", token_id: "102" })).toBe("#102");
    // 네이티브는 심볼이 없어도 체인으로 결정된다.
    expect(assetLabel({ ...base, asset_type: "NATIVE" })).toBe("ETH");
    expect(assetLabel({ ...base, asset_type: "NATIVE", chain_id: 137 })).toBe("POL");
  });
});

describe("날짜 표기는 계산과 같은 시간대를 쓴다", () => {
  // 계산은 전부 UTC다. 표시만 로컬이면 KST(UTC+9) 사용자는 12/31 밤 거래를 다음 해로 읽는다.
  const boundary = "2025-12-31T20:00:00.000Z";

  it("과세연도 경계 거래를 엔진과 같은 날로 찍는다", () => {
    // UTC를 못 박았으므로 어느 시간대에서 돌려도 같은 답이 나와야 한다.
    expect(formatDate(boundary)).toBe("2025. 12. 31.");
    expect(isoDay(boundary)).toBe("2025-12-31");
    // 화면이 "2026. 1. 1."이라 하는데 엔진이 2025년으로 계산하면 두 이야기가 된다.
    expect(taxYearFor("KR", boundary)).toBe(2025);
  });

  it("자정 직후도 같은 규칙을 따른다", () => {
    expect(formatDate("2026-01-01T00:30:00.000Z")).toBe("2026. 1. 1.");
    expect(taxYearFor("KR", "2026-01-01T00:30:00.000Z")).toBe(2026);
  });
});

describe("트랜잭션 해시는 원본을 확인할 수 있어야 한다", () => {
  it("아는 체인은 익스플로러로 연결한다", () => {
    expect(explorerTxUrl(1, "0xabc")).toBe("https://etherscan.io/tx/0xabc");
    expect(explorerTxUrl(42161, "0xabc")).toBe("https://arbiscan.io/tx/0xabc");
  });

  it("모르는 체인은 죽은 링크 대신 null을 준다", () => {
    // 링크를 걸어두고 404로 보내면 "확인시켜준다"는 약속만 하고 지키지 않는 것이다.
    expect(explorerTxUrl(999999, "0xabc")).toBeNull();
  });
});
