import { shortHash } from "@/lib/format";

/**
 * 알려진 컨트랙트 주소 → 표시 이름.
 *
 * 거래 상세가 상대(counterparty)를 부를 때 쓴다 — 주소가 알려진 프로토콜이면 이름(Aave·Lido 등)으로,
 * 모르면 축약 주소로 보인다. 이름을 지어내지 않는다: 여기 없는 주소는 항상 축약 주소다.
 * 목록에는 싣지 않는다 — 한 줄 레이아웃의 티커 줄이 붐비고, 상대는 상세에서 확인하는 정보다.
 *
 * **mock 레지스트리다.** 실제 서비스에서는 BE/토큰리스트·주소 라벨 소스가 이 매핑을 준다.
 * 키는 소문자 hex 주소 — 조회는 대소문자 무관(checksum 표기가 섞여 들어와도 같은 주소는 같은 이름).
 */
const KNOWN_CONTRACTS: Record<string, string> = {
  // Aave v3 Pool (Ethereum)
  "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2": "Aave",
  // Lido stETH
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": "Lido",
  // KyberSwap 라우터
  "0x6131b5fae19ea4f9d964eac0408e4408b66337b5": "KyberSwap",
  // Across SpokePool (Base)
  "0x09aea4b2242abc8bb4bb78d537a67a245a7bec64": "Across",
  // Uniswap Universal Router
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": "Uniswap",
};

/** 알려진 컨트랙트면 이름, 아니면 null. 표시 분기("이름 (축약)" vs "축약만")가 이걸로 갈린다. */
/**
 * `serverLabel`은 BE가 이벤트에 실어 준 이름(`counterparty_label`) — 브릿지·애그리게이터 레지스트리로 체인까지
 * 확인한 주소에만 붙는다. 서버가 아는 이름이 FE mock 매핑보다 우선한다.
 */
export function knownContractName(address: string, serverLabel: string | null = null): string | null {
  return serverLabel ?? KNOWN_CONTRACTS[address.toLowerCase()] ?? null;
}

/** 상대 표시 라벨 — 알려진 컨트랙트면 이름, 모르면 축약 주소(지어내지 않는다). */
export function counterpartyLabel(address: string, serverLabel: string | null = null): string {
  return knownContractName(address, serverLabel) ?? shortHash(address);
}
