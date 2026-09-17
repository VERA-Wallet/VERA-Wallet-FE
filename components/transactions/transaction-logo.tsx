import { AssetLogo, SplitAssetLogo } from "@/components/ui/asset-logo";
import { ChainIcon } from "@/components/ui/chain-icon";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/** 토큰 로고 코너에 얹는 작은 체인 배지 — 배경 흰 링으로 로고와 분리한다. */
function ChainBadgeGlyph({ chainId, size = 18 }: { chainId: number; size?: number }) {
  return (
    <span className="inline-flex rounded-full shadow-[0_0_0_2px_#fff]">
      <ChainIcon chainId={chainId} size={size} />
    </span>
  );
}

/**
 * 목록 왼쪽의 **로고 클러스터**. 체인 이름은 텍스트로 쓰지 않고 로고만 코너 배지로 얹는다.
 * - 스왑: 보낸 자산·받은 자산 두 로고를 겹쳐 보인다(상대 자산은 표시 힌트 `swap_to_*`).
 * - 브릿지: 자산 로고 하나에 출발·도착 두 체인 배지를 나란히 얹는다.
 * - 그 밖: 자산 로고 하나에 체인 배지 하나.
 * 아이콘은 전부 `aria-hidden`이고, 무슨 거래인지는 옆의 타입·티커 텍스트가 말한다.
 */
export function TransactionLogo({ event, swapInLeg }: { event: NormalizedEvent; swapInLeg?: NormalizedEvent | null }) {
  // 스왑 페어(같은 tx의 IN 다리)가 있으면 실제 받은 자산의 마크를 겹쳐 그린다 — 표시 힌트보다 원장이 우선.
  if (swapInLeg) {
    // 자산이 바뀌는 브릿지(브릿지 스왑)는 체인도 둘이다 — 같은 자산 브릿지와 같은 방식으로
    // 출발·도착 체인 배지를 나란히 얹어, 체인 이름을 텍스트로 쓰지 않아도 어디서 어디로 건넜는지 보이게 한다.
    const destChainId = event.bridge_dest_chain_id;
    return (
      <span className="relative block h-10 w-10 shrink-0" aria-hidden="true">
        <SplitAssetLogo left={event} right={swapInLeg} size={40} />
        {destChainId !== null ? (
          <span className="absolute -bottom-1 -right-2 flex items-center">
            <ChainBadgeGlyph chainId={event.chain_id} size={16} />
            <span className="-ml-1.5">
              <ChainBadgeGlyph chainId={destChainId} size={16} />
            </span>
          </span>
        ) : (
          <span className="absolute -bottom-1 -right-1">
            <ChainBadgeGlyph chainId={event.chain_id} size={18} />
          </span>
        )}
      </span>
    );
  }

  if (event.swap_to_symbol !== null) {
    // 받은 자산은 원장이 알려준 표시 힌트다 — 컨트랙트가 없어 로고는 메타데이터 이미지나 대체 마크로 그린다.
    const toMark = {
      chain_id: event.chain_id,
      asset_type: "ERC20" as const,
      asset_contract: null,
      asset_symbol: event.swap_to_symbol,
      asset_icon_url: event.swap_to_icon_url,
      token_id: null,
    };
    return (
      <span className="relative block h-10 w-10 shrink-0" aria-hidden="true">
        <SplitAssetLogo left={event} right={toMark} size={40} />
        <span className="absolute -bottom-1 -right-1">
          <ChainBadgeGlyph chainId={event.chain_id} size={18} />
        </span>
      </span>
    );
  }

  if (event.bridge_dest_chain_id !== null) {
    return (
      <span className="relative block h-10 w-10 shrink-0" aria-hidden="true">
        <AssetLogo event={event} size={40} />
        <span className="absolute -bottom-1 -right-2 flex items-center">
          <ChainBadgeGlyph chainId={event.chain_id} size={16} />
          <span className="-ml-1.5">
            <ChainBadgeGlyph chainId={event.bridge_dest_chain_id} size={16} />
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className="relative block h-10 w-10 shrink-0" aria-hidden="true">
      <AssetLogo event={event} size={40} />
      <span className="absolute -bottom-1 -right-1">
        <ChainBadgeGlyph chainId={event.chain_id} size={18} />
      </span>
    </span>
  );
}
