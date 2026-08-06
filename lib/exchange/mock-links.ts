import { z } from "zod";

/**
 * 거래소 계정 연동 — **화면 시연용 목업**.
 *
 * 실제 연동은 서버가 조회 전용 키를 보관하고, 체결·입출금 내역을 지갑 이벤트와 같은
 * 스키마로 정규화해 내려주는 별도 파이프라인을 요구한다. 그 파이프라인은 아직 없다.
 * 여기 있는 것은 **연결 흐름만** 보여주는 브라우저 로컬 상태다.
 *
 * 그래서 두 가지를 코드 수준에서 못 박는다.
 * 1) 거래소 API를 부르지 않는다 — 네트워크 호출이 이 모듈에 들어오면 시연이 아니라 반쪽 구현이다.
 * 2) 입력한 비밀값을 통째로 들고 있지 않는다 — 저장하는 것은 `maskApiKey`를 거친 표시용 문자열뿐이다.
 * 화면은 이 사실을 mock 배지와 문구로 함께 말한다(연동됐다고만 말하면 거짓이 된다).
 */

/** 거래소가 요구하는 인증 방식. 화면이 보여줄 입력 폼이 갈린다. */
export type ExchangeAuthMethod = "api-key" | "oauth";

export type ExchangeDefinition = {
  id: string;
  /** 화면에 그대로 노출되는 이름. 마크만으로는 어느 거래소인지 단정할 수 없어 항상 함께 보인다. */
  name: string;
  /** 마크에 넣는 두 글자. 로고 원본을 쓰지 않기 위한 대체 표기다. */
  initials: string;
  /** 목록에서 행을 구분하는 색. **브랜드 색이 아니다** — 상표를 흉내 내지 않는다. */
  color: string;
  region: "국내" | "해외";
  method: ExchangeAuthMethod;
  /** OKX처럼 키 발급 시 정한 패스프레이즈를 함께 요구하는 거래소. */
  requiresPassphrase: boolean;
  /** 키를 만들 때 사용자가 실제로 마주치는 조건. 없는 조건을 지어내지 않는다. */
  hint: string;
};

export const EXCHANGES: readonly ExchangeDefinition[] = [
  {
    id: "upbit",
    name: "업비트",
    initials: "UP",
    color: "#1F5FBF",
    region: "국내",
    method: "api-key",
    requiresPassphrase: false,
    hint: "자산·주문 조회 권한만 켜고, 허용 IP에 접속 주소를 등록해야 키가 동작합니다.",
  },
  {
    id: "bithumb",
    name: "빗썸",
    initials: "BI",
    color: "#D9662B",
    region: "국내",
    method: "api-key",
    requiresPassphrase: false,
    hint: "API 키 권한에서 조회 항목만 켭니다. 출금 권한은 켜지 마세요.",
  },
  {
    id: "coinone",
    name: "코인원",
    initials: "CO",
    color: "#2C7A5B",
    region: "국내",
    method: "api-key",
    requiresPassphrase: false,
    hint: "조회 전용 키를 발급한 뒤 시크릿은 발급 화면에서 한 번만 확인할 수 있습니다.",
  },
  {
    id: "binance",
    name: "바이낸스",
    initials: "BN",
    color: "#B08419",
    region: "해외",
    method: "api-key",
    requiresPassphrase: false,
    hint: "키 권한은 읽기(Enable Reading)만 남기고 출금·거래 권한은 끕니다.",
  },
  {
    id: "coinbase",
    name: "코인베이스",
    initials: "CB",
    color: "#2D5BD0",
    region: "해외",
    method: "oauth",
    requiresPassphrase: false,
    // 시트 본문이 이미 "조회 권한만 승인한다"를 말한다. 힌트는 같은 문장을 되풀이하지 않고 그다음을 말한다.
    hint: "승인한 권한은 코인베이스 계정의 연결된 앱 설정에서 언제든 해제할 수 있습니다.",
  },
  {
    id: "okx",
    name: "OKX",
    initials: "OK",
    color: "#3F3F46",
    region: "해외",
    method: "api-key",
    requiresPassphrase: true,
    hint: "키 발급 때 직접 정한 패스프레이즈가 API 키·시크릿과 함께 필요합니다.",
  },
];

export function exchangeById(id: string): ExchangeDefinition | null {
  return EXCHANGES.find((exchange) => exchange.id === id) ?? null;
}

/**
 * 연동 기록. **비밀값이 들어오지 않는 모양**이라는 것이 이 타입의 요점이다.
 * `credentialLabel`은 화면에 그대로 찍히는 문자열이라 원문 키가 여기 들어오면 그대로 노출된다.
 */
export type ExchangeLink = {
  exchangeId: string;
  credentialLabel: string;
  connectedAt: string;
  /** 이 화면이 요구하는 유일한 권한. 넓힐 일이 생기면 타입부터 바뀌어야 한다. */
  scope: "read-only";
};

/** OAuth 승인에는 사용자가 붙여 넣는 키가 없다. 가릴 것이 없으니 방식 자체를 이름으로 쓴다. */
export const OAUTH_CREDENTIAL_LABEL = "OAuth 조회 권한";

export const EXCHANGE_LINKS_STORAGE_KEY = "verawallet.mock-exchange-links";

/**
 * 표시용으로 가린 키.
 * 앞뒤 네 자리만 남긴다 — 사용자가 "내가 넣은 그 키"를 알아볼 만큼은 남기고,
 * 어깨너머로 재사용될 만큼은 남기지 않는다. 짧은 입력은 통째로 가린다.
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "•".repeat(8);
  return `${trimmed.slice(0, 4)}${"•".repeat(4)}${trimmed.slice(-4)}`;
}

const exchangeLinkSchema: z.ZodType<ExchangeLink> = z.object({
  exchangeId: z.string().min(1),
  credentialLabel: z.string().min(1),
  connectedAt: z.string().min(1),
  scope: z.literal("read-only"),
});

/**
 * 저장소 문자열 → 연동 기록.
 *
 * 저장소는 사용자가 직접 고칠 수 있는 공간이고, 카탈로그는 배포마다 바뀐다.
 * 그래서 항목 단위로 걸러 낸다 — 한 줄이 깨졌다고 나머지 연동까지 사라지면
 * 화면은 "연동한 적 없다"는 거짓말을 하게 된다. 모르는 거래소 id는 이름을 지어낼 수 없으니 버린다.
 */
export function parseExchangeLinks(raw: string | null): ExchangeLink[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  const links: ExchangeLink[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const parsed = exchangeLinkSchema.safeParse(item);
    if (!parsed.success) continue;
    if (!exchangeById(parsed.data.exchangeId) || seen.has(parsed.data.exchangeId)) continue;
    seen.add(parsed.data.exchangeId);
    links.push(parsed.data);
  }
  return links;
}

function browserStorage(): Storage | null {
  // 서버 렌더 · Safari 프라이빗 모드처럼 저장소가 없거나 막힌 환경에서도 화면은 떠야 한다.
  try {
    if (typeof window === "undefined") return null;
    const storage = window.localStorage;
    // 껍데기만 노출하는 런타임도 있다(테스트 러너·임베디드 웹뷰). 있는 척하는 저장소는 없는 것으로 본다.
    return typeof storage?.getItem === "function" && typeof storage?.setItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

export function loadExchangeLinks(storage: Storage | null = browserStorage()): ExchangeLink[] {
  if (!storage) return [];
  try {
    return parseExchangeLinks(storage.getItem(EXCHANGE_LINKS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveExchangeLinks(links: ExchangeLink[], storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(EXCHANGE_LINKS_STORAGE_KEY, JSON.stringify(links));
  } catch {
    // 저장 실패는 시연 화면을 멈출 이유가 아니다. 이번 세션 동안 화면 상태로만 남는다.
  }
}
