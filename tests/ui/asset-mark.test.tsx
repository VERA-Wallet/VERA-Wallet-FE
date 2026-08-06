import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssetMark } from "@/components/ui/asset-mark";
import { createNormalizedEventFixtures } from "@/lib/mock/fixtures";

const [nativeEvent] = createNormalizedEventFixtures();
const nft = createNormalizedEventFixtures().find((event) => event.token_id !== null)!;

describe("자산 표식", () => {
  it("메타데이터가 준 이미지가 있으면 그것을 쓴다", () => {
    const { container } = render(<AssetMark event={{ ...nativeEvent, asset_icon_url: "/tokens/eth.svg" }} />);
    const image = container.querySelector('[data-asset-mark="image"]')!;

    expect(image.getAttribute("src")).toBe("/tokens/eth.svg");
    // 마크는 자산을 단정하지 못한다. 이름은 호출부가 텍스트로 함께 보인다.
    expect(image.getAttribute("aria-hidden")).toBe("true");
  });

  it("이미지가 죽으면 깨진 아이콘을 남기지 않고 대체 마크로 떨어진다", () => {
    const { container } = render(<AssetMark event={{ ...nativeEvent, asset_icon_url: "https://dead.example/x.png" }} />);
    fireEvent.error(container.querySelector('[data-asset-mark="image"]')!);

    expect(container.querySelector('[data-asset-mark="image"]')).toBeNull();
    expect(container.querySelector('[data-asset-mark="symbol"]')).not.toBeNull();
  });

  it("이미지가 없는 NFT는 NFT 박스로 그린다", () => {
    const { container } = render(<AssetMark event={nft} />);
    const mark = container.querySelector('[data-asset-mark="nft"]')!;

    expect(mark).not.toBeNull();
    expect(mark.textContent).toBe("NFT");
    // 원이 아니라 박스다 — 실루엣만으로 개체 자산임이 구분된다.
    expect(mark.querySelector("rect")).not.toBeNull();
    expect(mark.querySelector("circle")).toBeNull();
  });

  it("이미지가 없는 토큰은 심볼 이니셜로 그린다", () => {
    const { container } = render(<AssetMark event={{ ...nativeEvent, asset_symbol: "USDC" }} />);
    expect(container.querySelector('[data-asset-mark="symbol"]')!.textContent).toBe("US");
  });

  it("심볼도 이미지도 없으면 무엇인지 주장하지 않는다", () => {
    const { container } = render(<AssetMark event={{ ...nativeEvent, asset_symbol: null }} />);
    const mark = container.querySelector('[data-asset-mark="symbol"]')!;

    expect(mark.textContent).toBe("?");
    // 이름을 모르는 자산에 브랜드처럼 보이는 색을 주지 않는다.
    expect(mark.querySelector("circle")!.getAttribute("fill")).toBe("#A1A1AA");
  });
});
