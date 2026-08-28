import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssetLogo } from "@/components/ui/asset-logo";

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const erc20 = {
  chain_id: 8453,
  asset_type: "ERC20" as const,
  asset_contract: BASE_USDC,
  asset_symbol: "USDC",
  asset_icon_url: null,
  token_id: null,
};

describe("자산 로고", () => {
  it("등록된 체인의 캐노니컬 컨트랙트는 공식 인라인 로고로 그린다", () => {
    const { container } = render(<AssetLogo event={erc20} />);
    expect(container.querySelector('[data-token-icon="USDC"]')).not.toBeNull();
    expect(container.querySelector('[data-asset-mark="symbol"]')).toBeNull();
  });

  it("네이티브 코인은 컨트랙트 없이 체인으로 로고를 정한다", () => {
    const { container } = render(
      <AssetLogo event={{ ...erc20, chain_id: 1, asset_type: "NATIVE", asset_contract: null, asset_symbol: "ETH" }} />,
    );
    expect(container.querySelector('[data-token-icon="ETH"]')).not.toBeNull();
  });

  it("심볼을 사칭하는 스팸(미등록 컨트랙트)에는 진짜 로고를 빌려주지 않는다", () => {
    const { container } = render(
      <AssetLogo
        event={{ ...erc20, chain_id: 1, asset_contract: "0x0000000000000000000000000000000000000bad", asset_symbol: "USDC" }}
      />,
    );
    expect(container.querySelector("[data-token-icon]")).toBeNull();
    // 대체 마크(심볼 이니셜)로 떨어진다 — 목록이 이 자산을 USDC라고 보증하지 않는다.
    expect(container.querySelector('[data-asset-mark="symbol"]')!.textContent).toBe("US");
  });

  it("레지스트리에 없는 티커는 대체 마크로 그린다", () => {
    const { container } = render(
      <AssetLogo
        event={{ ...erc20, chain_id: 42161, asset_contract: "0x912ce59144191c1204e64559fe8253a0e49e6548", asset_symbol: "ARB" }}
      />,
    );
    expect(container.querySelector("[data-token-icon]")).toBeNull();
    expect(container.querySelector('[data-asset-mark="symbol"]')!.textContent).toBe("AR");
  });

  it("등록되지 않은 체인은 컨트랙트가 있어도 조회하지 않는다", () => {
    const { container } = render(<AssetLogo event={{ ...erc20, chain_id: 56 }} />);
    expect(container.querySelector("[data-token-icon]")).toBeNull();
    expect(container.querySelector('[data-asset-mark="symbol"]')).not.toBeNull();
  });

  it("개체(NFT)면 컨트랙트가 있어도 인라인 마크를 쓰지 않고 NFT 박스로 그린다", () => {
    const { container } = render(
      <AssetLogo event={{ ...erc20, asset_type: "ERC721", token_id: "42" }} />,
    );
    expect(container.querySelector("[data-token-icon]")).toBeNull();
    expect(container.querySelector('[data-asset-mark="nft"]')!.textContent).toBe("NFT");
  });
});
