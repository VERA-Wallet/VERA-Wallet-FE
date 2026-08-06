"use client";

import { useState } from "react";

import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 자산 표식.
 *
 * 순서는 하나뿐이다: **메타데이터가 준 이미지가 있으면 그것**, 없으면 대체 마크.
 * `ChainIcon`·`ExchangeMark`와 같은 규칙으로 **로고를 기억으로 다시 그리지 않는다**(상표 왜곡).
 * 다만 이미지 자체는 오프라인·CSP·404에서 목록을 깨뜨리므로, 로드에 실패하면 조용히 대체 마크로 떨어진다.
 *
 * 대체 마크는 두 갈래다:
 * - NFT(토큰 번호가 있는 자산) → 이미지가 없다는 사실이 드러나는 **NFT 박스**
 * - 그 밖의 토큰 → 심볼 이니셜
 *
 * 색은 브랜드 색이라고 주장하지 않는다. 심볼에서 결정론적으로 고른 목록 구분색이다.
 * 마크만으로는 어느 자산인지 단정할 수 없으므로 `aria-hidden`이고, 호출부는 자산 이름을 함께 보인다.
 */
const PALETTE = ["#4F46E5", "#0891B2", "#059669", "#D97706", "#DB2777", "#7C3AED"];
/** 이름을 모르는 자산. 색으로 무엇인지 주장하지 않는다. */
const UNKNOWN_COLOR = "#A1A1AA";

function paletteColor(seed: string): string {
  if (seed === "") return UNKNOWN_COLOR;
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.codePointAt(0)!) % 997;
  return PALETTE[hash % PALETTE.length];
}

/** 16px에서 읽히는 길이는 두 글자까지다. */
function initials(symbol: string | null): string {
  return symbol === null ? "?" : symbol.slice(0, 2).toUpperCase();
}

type MarkEvent = Pick<NormalizedEvent, "asset_symbol" | "asset_icon_url" | "token_id" | "asset_type">;

export function AssetMark({ event, size = 32 }: { event: MarkEvent; size?: number }) {
  // 이미지가 죽었는데 깨진 아이콘을 계속 보이면 목록이 고장난 것처럼 읽힌다.
  const [imageFailed, setImageFailed] = useState(false);
  const icon = event.asset_icon_url;

  if (icon !== null && !imageFailed) {
    return (
      // next/image는 원격 도메인 허용 목록을 요구한다. 자산 로고는 어느 CDN에서 올지 알 수 없어
      // 목록이 도메인 설정에 묶이면 안 된다 — 실패는 아래 대체 마크가 받는다.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        aria-hidden="true"
        alt=""
        data-asset-mark="image"
        className="shrink-0 rounded-full bg-zinc-100 object-cover"
        width={size}
        height={size}
        src={icon}
        onError={() => setImageFailed(true)}
      />
    );
  }

  const color = paletteColor(event.asset_symbol ?? "");

  if (event.token_id !== null) {
    return (
      <svg aria-hidden="true" data-asset-mark="nft" className="shrink-0" width={size} height={size} viewBox="0 0 32 32">
        {/* 원이 아니라 박스다 — 개체 하나를 가리키는 자산임이 실루엣만으로 구분된다. */}
        <rect x="1" y="1" width="30" height="30" rx="8" fill="none" stroke={color} strokeWidth="2" />
        <text x="16" y="20.5" textAnchor="middle" fontSize="10" fontWeight="700" fill={color}>
          NFT
        </text>
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" data-asset-mark="symbol" className="shrink-0" width={size} height={size} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill={color} />
      <text x="16" y="20.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#ffffff">
        {initials(event.asset_symbol)}
      </text>
    </svg>
  );
}
