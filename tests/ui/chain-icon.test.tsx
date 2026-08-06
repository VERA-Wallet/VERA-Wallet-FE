import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChainIcon } from "@/components/ui/chain-icon";
import { chainLabel } from "@/lib/format";

/** `lib/format.ts`가 이름을 아는 체인. 이름과 표식이 갈리면 화면이 반쯤만 안다. */
const NAMED_CHAINS = [1, 10, 137, 8453, 42161];

function iconOf(chainId: number) {
  const { container } = render(<ChainIcon chainId={chainId} />);
  return container.querySelector(`[data-chain-icon="${chainId}"]`)!;
}

describe("체인 표식", () => {
  it("이름을 아는 체인은 모두 표식을 갖는다", () => {
    // 이름은 아는데 표식이 없으면 그 체인만 회색 점이 되어 사용자가 오류로 읽는다.
    for (const chainId of NAMED_CHAINS) {
      expect(chainLabel(chainId), String(chainId)).not.toMatch(/^chain /);
      expect(iconOf(chainId).querySelector("circle")?.getAttribute("fill"), String(chainId)).not.toBe("#A1A1AA");
    }
  });

  it("체인마다 색이 겹치지 않는다", () => {
    // 같은 색이 둘이면 목록에서 색으로 훑는다는 전제가 깨진다.
    const colors = NAMED_CHAINS.map((chainId) => iconOf(chainId).querySelector("circle")!.getAttribute("fill"));
    expect(new Set(colors).size).toBe(NAMED_CHAINS.length);
  });

  it("모르는 체인은 브랜드를 지어내지 않고 중립색으로 자리를 지킨다", () => {
    expect(iconOf(999_999).querySelector("circle")?.getAttribute("fill")).toBe("#A1A1AA");
  });

  it("스크린리더에서 숨긴다 — 체인 이름은 옆의 글자가 말한다", () => {
    // 아이콘이 이름을 대신하면 색맹·저해상도·미지원 체인에서 정보가 사라진다.
    expect(iconOf(1).getAttribute("aria-hidden")).toBe("true");
  });
});
