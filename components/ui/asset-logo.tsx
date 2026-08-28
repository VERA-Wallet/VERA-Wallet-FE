import { AssetMark } from "@/components/ui/asset-mark";
import { TokenIcon } from "@/components/ui/token-icon";
import { resolveTokenMark } from "@/lib/assets/token-logo";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 자산 로고 — 하나의 규칙으로 거래 목록·지갑 포트폴리오가 같은 마크를 그린다.
 *
 * 순서:
 * 1. **등록된 체인의 컨트랙트가 공식 인라인 마크에 매핑**되면(ETH·USDC·USDT) → 그 마크.
 *    조회는 `(chainId, 컨트랙트)`로만 한다 — 심볼은 위조 가능해 키로 쓰지 않는다.
 * 2. 그 밖 → `AssetMark`의 대체 마크(메타데이터 이미지 → 심볼 이니셜 / NFT 박스).
 *
 * 심볼을 사칭하는 스팸은 컨트랙트가 레지스트리에 없으므로 자연히 대체 마크로 떨어진다 —
 * 가짜 USDC가 진짜 USDC 로고를 빌리지 못한다.
 */
type AssetLogoEvent = Pick<
  NormalizedEvent,
  "chain_id" | "asset_type" | "asset_contract" | "asset_symbol" | "asset_icon_url" | "token_id"
>;

export function AssetLogo({ event, size = 40 }: { event: AssetLogoEvent; size?: number }) {
  const mark = resolveTokenMark(event);
  if (mark !== null) {
    return <TokenIcon symbol={mark} size={size} />;
  }
  return <AssetMark event={event} size={size} />;
}

/**
 * 스왑 자산 로고 — 두 자산을 **하나의 원**으로 합친다: 왼쪽 자산 로고의 왼쪽 절반과
 * 오른쪽 자산 로고의 오른쪽 절반을 세로선에서 잇는다(보낸 자산 → 받은 자산이 한 거래임을 한 마크로).
 * 각 절반은 전체 크기 로고를 반쪽만 보이도록 잘라 원의 곡률이 양쪽에서 이어진다.
 */
export function SplitAssetLogo({
  left,
  right,
  size = 40,
}: {
  left: AssetLogoEvent;
  right: AssetLogoEvent;
  size?: number;
}) {
  return (
    <span
      className="relative inline-flex shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* 왼쪽 절반: 왼쪽 정렬이라 로고의 왼쪽 반이 남는다. */}
      <span className="absolute inset-y-0 left-0 flex w-1/2 items-center justify-start overflow-hidden">
        <AssetLogo event={left} size={size} />
      </span>
      {/* 오른쪽 절반: 오른쪽 정렬이라 로고의 오른쪽 반이 남는다. */}
      <span className="absolute inset-y-0 right-0 flex w-1/2 items-center justify-end overflow-hidden">
        <AssetLogo event={right} size={size} />
      </span>
      {/* 가운데 흰 경계선 — 한 원에서 두 자산이 갈린다. */}
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white" />
    </span>
  );
}
