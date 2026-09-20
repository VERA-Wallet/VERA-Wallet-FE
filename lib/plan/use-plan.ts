import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * 내보내기 플랜 — **mock 결제 상태**다.
 *
 * 실제 과금은 결제대행사 연동과 BE 계약(영수증·환불·과세연도 귀속)을 요구하고, 그 계약은 아직 없다.
 * 여기 있는 것은 브라우저 로컬 상태뿐이다 — 결제 API를 부르지 않고, 청구도 일어나지 않는다.
 * BE 계약이 생기면 이 훅은 서버 플랜을 읽는 어댑터로 대체된다(호출부가 보는 모양은 그대로 둔다).
 * 화면은 이 사실을 mock 배지와 "실제 결제 아님" 문구로 함께 말한다 — 활성 배지만 보이면 거짓이 된다.
 */

export type PlanTier = "plus" | "pro";

/** 결제 단위는 과세연도 하나다. 연도가 바뀌면 같은 tier라도 다른 결제다. */
export type Plan = { tier: PlanTier; taxYear: number; activatedAt: string };

/** 무료로 내려받을 수 있는 계산 대상 이벤트 수. 조회·판정·시뮬레이터는 이 한도와 무관하다. */
export const FREE_EXPORT_EVENT_LIMIT = 100;

export type PlanDefinition = {
  /** "free"는 결제 대상이 아니다 — 카드로만 존재하고 저장소에 들어가지 않는다. */
  id: PlanTier | "free";
  name: string;
  priceLabel: string;
  /** 한 과세연도에 내보낼 수 있는 계산 대상 이벤트 수. */
  exportLimit: number;
  /** 카드 본문. 무엇이 무료이고 무엇이 잠기는지를 카드마다 다시 말한다. */
  summary: string;
};

export const PLANS: readonly PlanDefinition[] = [
  {
    id: "free",
    name: "무료",
    priceLabel: "₩0",
    exportLimit: FREE_EXPORT_EVENT_LIMIT,
    summary: "조회·판정·시뮬레이터 전부. 내보내기는 100건까지.",
  },
  {
    id: "plus",
    name: "플러스",
    priceLabel: "₩9,900",
    exportLimit: 1_000,
    summary: "내보내기 1,000건까지. 무료로 쓰던 화면은 그대로입니다.",
  },
  {
    id: "pro",
    name: "프로",
    priceLabel: "₩19,900",
    exportLimit: 10_000,
    summary: "내보내기 10,000건까지. 거래가 많은 해에 고릅니다.",
  },
];

export function planDefinition(tier: PlanTier): PlanDefinition {
  // 카탈로그에 없는 tier는 저장소 파서가 이미 걸러 낸다. 여기까지 왔으면 반드시 있다.
  return PLANS.find((plan) => plan.id === tier)!;
}

/**
 * 지금 내려받을 수 있는 계산 대상 이벤트 수.
 *
 * 플랜이 광고한 한도는 실제로 문을 여는 한도와 같아야 한다 — 1,000건이라고 적어 두고
 * 무제한으로 열어 주면 카드가 거짓말을 한다.
 *
 * 활성 플랜의 `taxYear`를 내보내기 기간의 과세연도와 맞춰 보지는 않는다. 그 대조에는
 * 나라별 과세기간 경계와 "이 결제가 어느 연도에 귀속되는가"를 확정하는 BE 계약이 필요하고,
 * 없는 계약을 프런트에서 흉내 내면 사용자는 결제한 연도가 검증됐다고 오해한다.
 */
export function exportEventAllowance(plan: Plan | null): number {
  return plan === null ? FREE_EXPORT_EVENT_LIMIT : planDefinition(plan.tier).exportLimit;
}

export const PLAN_STORAGE_KEY = "vw_plan";

const planSchema: z.ZodType<Plan> = z.object({
  tier: z.union([z.literal("plus"), z.literal("pro")]),
  taxYear: z.number().int().min(2000).max(2200),
  activatedAt: z.string().min(1),
});

/**
 * 저장소 문자열 → 플랜.
 * 저장소는 사용자가 직접 고칠 수 있는 공간이다. 모양이 깨진 값은 "플랜 없음"으로 본다 —
 * 알 수 없는 tier를 활성으로 읽으면 화면이 한도를 지어내야 한다.
 */
export function parsePlan(raw: string | null): Plan | null {
  if (!raw) return null;
  try {
    const parsed = planSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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

export function loadPlan(storage: Storage | null = browserStorage()): Plan | null {
  if (!storage) return null;
  try {
    return parsePlan(storage.getItem(PLAN_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePlan(plan: Plan | null, storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    if (plan === null) storage.removeItem(PLAN_STORAGE_KEY);
    else storage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // 저장 실패는 시연 화면을 멈출 이유가 아니다. 이번 세션 동안 화면 상태로만 남는다.
  }
}

type PlanStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Plan | null;
  getServerSnapshot: () => null;
  write: (plan: Plan | null) => void;
};

function createPlanStore(storage?: Storage | null): PlanStore {
  const listeners = new Set<() => void>();
  // 저장소를 읽었는지 여부를 값과 구분해야 한다 — "플랜 없음"도 정상 상태(null)이기 때문이다.
  let read = false;
  let snapshot: Plan | null = null;

  // 메서드가 아니라 클로저다. 호출부가 함수만 떼어 들고 다녀도 동작해야 한다.
  const getSnapshot = () => {
    if (!read) {
      snapshot = loadPlan(storage);
      read = true;
    }
    return snapshot;
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot,
    getServerSnapshot: () => null,
    write: (plan) => {
      snapshot = plan;
      read = true;
      savePlan(plan, storage);
      for (const listener of listeners) listener();
    },
  };
}

/**
 * 브라우저에 남아 있는 mock 플랜.
 *
 * 저장소는 React 밖의 시스템이라 `useSyncExternalStore`로 읽는다. 마운트 후 `setState`로 채우면
 * 하이드레이션 시점에 서버 결과와 다른 화면이 나오고, 이 프로젝트의 lint 규칙
 * (`react-hooks/set-state-in-effect`)도 그것을 막는다. 서버 스냅샷을 "플랜 없음"으로 고정해 두면
 * 하이드레이션은 서버와 같은 화면에서 시작하고, 그 직후 클라이언트 스냅샷으로 한 번만 갱신된다.
 */
export function usePlan(storage?: Storage | null) {
  const store = useMemo(() => createPlanStore(storage), [storage]);
  const plan = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const actions = useMemo(
    () => ({
      activate: (tier: PlanTier, taxYear: number) =>
        store.write({ tier, taxYear, activatedAt: new Date().toISOString() }),
      deactivate: () => store.write(null),
    }),
    [store],
  );
  return { plan, ...actions };
}
