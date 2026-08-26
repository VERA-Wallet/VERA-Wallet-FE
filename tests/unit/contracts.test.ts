import { describe, expect, it } from "vitest";

import { counterpartyLabel, knownContractName } from "@/lib/contracts";
import { shortHash } from "@/lib/format";

describe("알려진 컨트랙트 레지스트리", () => {
  it("등록된 주소는 이름으로 부른다 — 대소문자 무관", () => {
    expect(counterpartyLabel("0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2")).toBe("Aave");
    // checksum 표기(대문자 섞임)로 들어와도 같은 주소는 같은 이름이어야 한다.
    expect(counterpartyLabel("0x87870BCA3F3FD6335C3F4CE8392D69350B4FA4E2")).toBe("Aave");
    expect(knownContractName("0xAE7ab96520DE3A18E5e111B5EaAb095312D7fE84")).toBe("Lido");
  });

  it("모르는 주소는 이름을 지어내지 않고 축약 주소로 부른다", () => {
    const unknown = "0x1234567890abcdef1234567890abcdef12345678";
    expect(knownContractName(unknown)).toBeNull();
    expect(counterpartyLabel(unknown)).toBe(shortHash(unknown));
  });
});
