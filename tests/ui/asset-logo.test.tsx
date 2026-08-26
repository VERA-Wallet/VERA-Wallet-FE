import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssetLogo } from "@/components/ui/asset-logo";

const base = { asset_symbol: "USDC", asset_icon_url: null, token_id: null, asset_type: "ERC20" as const };

describe("자산 로고", () => {
  it("검증된 데다 공식 인라인 마크가 있는 티커는 진짜 로고를 그린다", () => {
    const { container } = render(<AssetLogo event={{ ...base, asset_verified: true }} />);
    expect(container.querySelector('[data-token-icon="USDC"]')).not.toBeNull();
    expect(container.querySelector('[data-asset-mark="symbol"]')).toBeNull();
  });

  it("검증 여부가 없으면(undefined) 아는 티커는 진짜 로고로 그린다", () => {
    // 지갑 포트폴리오처럼 검증 필드 없이 넘어오는 자리는 검증된 것으로 본다.
    const { container } = render(<AssetLogo event={base} />);
    expect(container.querySelector('[data-token-icon="USDC"]')).not.toBeNull();
  });

  it("심볼을 사칭하는 미검증 스팸에는 진짜 로고를 빌려주지 않는다", () => {
    const { container } = render(<AssetLogo event={{ ...base, asset_verified: false }} />);
    expect(container.querySelector("[data-token-icon]")).toBeNull();
    // 대체 마크(심볼 이니셜)로 떨어진다 — 목록이 이 자산을 USDC라고 보증하지 않는다.
    expect(container.querySelector('[data-asset-mark="symbol"]')!.textContent).toBe("US");
  });

  it("공식 벡터가 없는 티커는 대체 마크로 그린다", () => {
    const { container } = render(<AssetLogo event={{ ...base, asset_symbol: "ARB", asset_verified: true }} />);
    expect(container.querySelector("[data-token-icon]")).toBeNull();
    expect(container.querySelector('[data-asset-mark="symbol"]')!.textContent).toBe("AR");
  });

  it("아는 티커여도 개체(NFT)면 인라인 마크를 쓰지 않고 NFT 박스로 그린다", () => {
    const { container } = render(
      <AssetLogo event={{ ...base, asset_type: "ERC721", token_id: "42", asset_verified: true }} />,
    );
    expect(container.querySelector("[data-token-icon]")).toBeNull();
    expect(container.querySelector('[data-asset-mark="nft"]')!.textContent).toBe("NFT");
  });
});
