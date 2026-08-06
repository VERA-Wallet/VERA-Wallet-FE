import type { ReactElement } from "react";

/**
 * 체인 표식.
 *
 * **브랜드 로고 원본을 쓰지 않는다.** 외부 이미지는 오프라인·CSP·404에서 목록을 깨뜨리고,
 * 기억으로 다시 그린 로고는 상표를 왜곡한다. 대신 각 체인이 공표한 브랜드 색 위에
 * 서로 다른 기하 도형을 얹는다 — 16px에서 색과 실루엣 두 축으로 구분된다.
 *
 * 아이콘만으로는 어느 체인인지 단정할 수 없다(색맹·저해상도·미지원 체인).
 * 그래서 이 컴포넌트는 `aria-hidden`이고, 호출부는 반드시 `chainLabel`을 함께 보인다.
 */
const CHAIN_MARK: Record<number, { color: string; glyph: ReactElement }> = {
  // Ethereum — 팔면체를 정면에서 본 마름모.
  1: { color: "#627EEA", glyph: <path fill="#fff" d="M8 2.6 12.9 8 8 13.4 3.1 8Z" /> },
  // Optimism — 고리.
  10: { color: "#FF0420", glyph: <circle cx="8" cy="8" r="3.5" fill="none" stroke="#fff" strokeWidth="2.2" /> },
  // Polygon — 이름 그대로 다각형.
  137: { color: "#8247E5", glyph: <path fill="#fff" d="M8 2.4 12.9 5.2 12.9 10.8 8 13.6 3.1 10.8 3.1 5.2Z" /> },
  // Base — 정사각형.
  8453: { color: "#0052FF", glyph: <rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.6" fill="#fff" /> },
  // Arbitrum — 삼각형.
  42161: { color: "#12AAFF", glyph: <path fill="#fff" d="M8 3 13.4 12.6 2.6 12.6Z" /> },
};

/** 모르는 체인은 브랜드를 지어내지 않는다. 중립 회색 점으로 자리만 지킨다. */
const UNKNOWN_MARK = { color: "#A1A1AA", glyph: <circle cx="8" cy="8" r="3" fill="#fff" /> };

export function ChainIcon({ chainId, size = 16 }: { chainId: number; size?: number }) {
  const { color, glyph } = CHAIN_MARK[chainId] ?? UNKNOWN_MARK;

  return (
    <svg
      aria-hidden="true"
      data-chain-icon={chainId}
      className="shrink-0"
      width={size}
      height={size}
      viewBox="0 0 16 16"
    >
      <circle cx="8" cy="8" r="8" fill={color} />
      {glyph}
    </svg>
  );
}
