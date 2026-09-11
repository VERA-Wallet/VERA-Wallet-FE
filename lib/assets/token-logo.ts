import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 자산 로고 해석 — **컨트랙트 기준**으로 등록된 체인의 토큰만 인라인 마크에 매핑한다.
 *
 * 규칙:
 * - 조회 키는 `(chainId, 컨트랙트 소문자)`다. **심볼은 절대 키로 쓰지 않는다** — 심볼은 위조 가능해
 *   스팸이 "USDC"를 사칭할 수 있지만, 컨트랙트 주소(온체인 상수)는 훔칠 수 없다.
 * - NATIVE 자산은 컨트랙트가 없으니 체인으로 키를 잡는다(그 체인의 네이티브 코인).
 * - **현재 등록된 체인 목록**(아래 `REGISTERED_CHAIN_IDS`)에 없는 체인은 조회하지 않는다.
 * - NFT(토큰 번호가 있는 자산)는 티커가 아닌 개체라 조회하지 않는다.
 * - 마크가 없으면 `null` → 호출부는 대체 마크(심볼 이니셜 · NFT 박스)로 그린다.
 *
 * 마크 자체는 `TokenIcon`이 인라인한다 — CC0 원본 벡터(JSX) 또는 데이터 URI(`token-mark-data.ts`). 런타임 외부
 * 요청은 없다. 그래서 이 표는 "어느 컨트랙트가 어느 인라인 마크인가"만 정하고, 이미지 fetch·CDN은 이 앱의 책임이 아니다.
 */

/** 인라인 마크가 존재하는 티커 식별자. 표시 심볼이 아니라 `TokenIcon`이 아는 표식 키다. */
export type TokenMarkKey = "ETH" | "USDT" | "USDC" | "DAI" | "LINK" | "POL" | "OP" | "ARB" | "ATH" | "AGI" | "CARV" | "XAI" | "P";

/** 현재 등록된 체인(Ethereum·Optimism·Polygon·Base·Arbitrum). format·explorer 레지스트리와 같은 집합이다. */
export const REGISTERED_CHAIN_IDS: ReadonlySet<number> = new Set([1, 10, 137, 8453, 42161]);

/** 등록된 체인의 네이티브 코인 로고. */
const NATIVE_MARK: Record<number, TokenMarkKey> = {
  1: "ETH", // Ethereum
  137: "POL", // Polygon — 네이티브 POL
  10: "ETH", // Optimism — 네이티브 ETH
  8453: "ETH", // Base — 네이티브 ETH
  42161: "ETH", // Arbitrum One — 네이티브 ETH
};

/**
 * 등록된 체인의 ERC20 로고 — `chainId:컨트랙트(소문자)` 키.
 * 컨트랙트 주소는 각 체인의 캐노니컬(네이티브 발행) USDC·USDT 온체인 상수다.
 */
const ERC20_MARK: Record<string, TokenMarkKey> = {
  // USDC (Circle, 네이티브 발행)
  "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC", // Ethereum
  "10:0x0b2c639c533813f4aa9d7837caf62653d097ff85": "USDC", // Optimism
  "137:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "USDC", // Polygon
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC", // Base
  "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC", // Arbitrum
  // USDT (Tether)
  "1:0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT", // Ethereum
  "10:0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": "USDT", // Optimism
  "137:0xc2132d05d31c914a87c6611c10748aeb04b58e8f": "USDT", // Polygon
  "8453:0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": "USDT", // Base
  "42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": "USDT", // Arbitrum
  // DAI (MakerDAO/Sky) — Ethereum 캐노니컬
  "1:0x6b175474e89094c44da98b954eedeac495271d0f": "DAI",
  // Chainlink — Ethereum 캐노니컬
  "1:0x514910771af9ca656af840dff83e8264ecf986ca": "LINK",
  // L2 거버넌스 토큰
  "10:0x4200000000000000000000000000000000000042": "OP", // Optimism
  "42161:0x912ce59144191c1204e64559fe8253a0e49e6548": "ARB", // Arbitrum
  // 2026-09-11 실지갑(0xe6de…)에서 확인한 배포 — Summ 포트폴리오와 같은 로고를 쓴다
  "1:0xbe0ed4138121ecfc5c0e56b40517da27e6c5226b": "ATH", // Aethir, Ethereum
  "42161:0xc87b37a581ec3257b734886d9d3a581f5a9d056c": "ATH", // Aethir, Arbitrum
  "1:0x7da2641000cbb407c329310c461b2cb9c70c3046": "AGI", // Delysium, Ethereum
  "8453:0xc08cd26474722ce93f4d0c34d16201461c10aa8c": "CARV", // CARV, Base
  "42161:0xc08cd26474722ce93f4d0c34d16201461c10aa8c": "CARV", // CARV, Arbitrum
  "42161:0x4cb9a7ae498cedcbb5eae9f25736ae7d428c9d66": "XAI", // Xai, Arbitrum
  "8453:0x25e1c298f100d7c600e9e44d46788c1ebbd4f69b": "P", // Pike Finance, Base
};

type ResolvableAsset = Pick<NormalizedEvent, "chain_id" | "asset_type" | "asset_contract" | "token_id">;

/**
 * 자산의 인라인 마크 키를 (체인·컨트랙트)로 해석한다. 없으면 `null`.
 * 등록되지 않은 체인·NFT·미등록 컨트랙트는 모두 `null`이라 호출부가 대체 마크로 그린다.
 */
export function resolveTokenMark(asset: ResolvableAsset): TokenMarkKey | null {
  if (!REGISTERED_CHAIN_IDS.has(asset.chain_id)) return null;
  if (asset.token_id !== null) return null;
  if (asset.asset_type === "NATIVE") return NATIVE_MARK[asset.chain_id] ?? null;
  const contract = asset.asset_contract?.toLowerCase();
  if (contract === undefined || contract === null) return null;
  return ERC20_MARK[`${asset.chain_id}:${contract}`] ?? null;
}
