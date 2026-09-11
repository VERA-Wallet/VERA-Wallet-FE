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


describe("서버가 준 상대 이름(counterparty_label)", () => {
  it("서버 라벨이 있으면 FE mock 매핑보다 우선한다", () => {
    const relay = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
    expect(knownContractName(relay)).toBeNull();
    expect(knownContractName(relay, "Relay: Depository")).toBe("Relay: Depository");
    expect(counterpartyLabel(relay, "Relay: Depository")).toBe("Relay: Depository");
    // mock 매핑에도 있는 주소에 서버 라벨이 오면 서버 쪽을 쓴다 — 체인까지 보고 확인한 값이다.
    expect(knownContractName("0x09aea4b2242abc8bb4bb78d537a67a245a7bec64", "Across: SpokePool")).toBe("Across: SpokePool");
  });
  it("서버 라벨이 null이면 종전 동작 그대로다", () => {
    expect(counterpartyLabel("0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", null)).toBe("Aave");
  });
});
