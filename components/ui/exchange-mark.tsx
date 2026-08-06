import type { ExchangeDefinition } from "@/lib/exchange/mock-links";

/**
 * 거래소 표식.
 *
 * `ChainIcon`과 같은 규칙이다. **브랜드 로고 원본을 쓰지 않는다** — 외부 이미지는
 * 오프라인·CSP·404에서 목록을 깨뜨리고, 기억으로 다시 그린 로고는 상표를 왜곡한다.
 * 여기서는 한 발 더 물러서서 색조차 브랜드 색으로 주장하지 않는다(목록 안에서 행을 구분하는 색이다).
 *
 * 마크만으로는 어느 거래소인지 단정할 수 없으므로 `aria-hidden`이고,
 * 호출부는 반드시 거래소 이름을 텍스트로 함께 보인다.
 */
export function ExchangeMark({ exchange, size = 32 }: { exchange: ExchangeDefinition; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      data-exchange-mark={exchange.id}
      className="shrink-0"
      width={size}
      height={size}
      viewBox="0 0 32 32"
    >
      <rect width="32" height="32" rx="10" fill={exchange.color} />
      <text x="16" y="21" textAnchor="middle" fontSize="12" fontWeight="700" fill="#ffffff">
        {exchange.initials}
      </text>
    </svg>
  );
}
