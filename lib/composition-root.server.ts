import "server-only";

import { MockAuthStore } from "@/lib/mock/auth-store";
import { getMockRuleset } from "@/lib/mock/rulesets";
import { MockEventStore } from "@/lib/mock/store";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import { FixedFxRateProvider } from "@/lib/adapters/fx/fixed-fx-rate";
import { FrankfurterFxRateProvider } from "@/lib/adapters/fx/frankfurter-fx-rate.server";
import type { FxRateProvider } from "@/lib/ports/fx-rate";
import { BeSessionReader } from "@/lib/adapters/session/be-session-reader.server";
import { MockSessionReader } from "@/lib/adapters/session/mock-session-reader.server";
import type { AnchorProofProvider } from "@/lib/ports/anchor-proof-provider";
import type { EventRepository } from "@/lib/ports/event-repository";
import type { RuleSetRepository } from "@/lib/ports/ruleset-repository";
import type { SummaryProvider } from "@/lib/ports/summary-provider";
import type { TaxEnginePort } from "@/lib/ports/tax-engine";
import type { SessionReader } from "@/lib/ports/session-reader";
import { backendOrigin, isMockApiMode } from "@/lib/api-mode";

// mock 저장소 수명주기(로컬/테스트 단일 프로세스 전용):
// - Route Handler와 RSC는 서로 다른 모듈 그래프로 번들될 수 있어 모듈 스코프 싱글턴이 분리된다.
//   globalThis에 고정해 두 그래프가 같은 상태를 보게 한다.
// - HMR: `??=`는 기존 인스턴스를 유지하므로 저장소 클래스나 fixture를 수정해도 dev 서버를 재시작하기 전까지
//   기존 객체/데이터가 남는다(핫리로드로 초기화되지 않는다).
// - 다중 프로세스/인스턴스: 프로세스마다 별도 메모리를 갖는다. 실제 배포에서는 이 in-memory 구성 대신
//   공유 durable 저장소(백엔드/DB)로 교체해야 하며, v1 mock 단계 범위에서만 사용한다.
const globalStores = globalThis as typeof globalThis & {
  __verawalletEventStore?: MockEventStore;
  __verawalletAuthStore?: MockAuthStore;
};
const store = (globalStores.__verawalletEventStore ??= new MockEventStore());
const authStore = (globalStores.__verawalletAuthStore ??= new MockAuthStore());
// 모드는 모듈 로드 때 한 번만 정해진다. 환경 변수를 바꾸면 서버를 재시작해야 하며 자동 failover는 하지 않는다.
export const sessionReader: SessionReader = backendOrigin()
  ? new BeSessionReader()
  : new MockSessionReader(authStore);

export const eventRepository: EventRepository = {
  list: async (input) => store.list(input),
  getById: async (id) => store.getById(id),
  reclassify: async (id, input) => store.reclassify(id, input),
  setValueOverride: async (id, input) => store.setValueOverride(id, input),
};

export const summaryProvider: SummaryProvider = {
  getSummary: async (input) => store.summary(input),
};

export const ruleSetRepository: RuleSetRepository = {
  getByCountry: async (country) => getMockRuleset(country),
};

// 세금 계산의 지갑 이벤트 출처를 모드로 고른다.
// ON에서 FE mock store를 그대로 쓰면 대시보드(BE 25건)와 세금 화면(FE fixture)이 서로 다른 우주를 말한다.
// dal ↔ composition-root 순환을 피하려고 ON 경로만 지연 import한다.
// 환율 소스. 룰셋 통화가 이벤트 통화(BE는 KRW)와 다를 때 거래일 환율로 환산한다.
// `VERAWALLET_FX_SOURCE=fixed`는 결정적 테스트·CI 전용 고정표다 — 운영에서 켜면 취득·양도 시점의 환율 차이가 사라진다.
const fxRateProvider: FxRateProvider = process.env.VERAWALLET_FX_SOURCE === "fixed" ? new FixedFxRateProvider() : new FrankfurterFxRateProvider();

export const taxEngine: TaxEnginePort = new TaxEngineService(async () => {
  if (isMockApiMode()) return { events: store.list({ limit: 100 }).items.map((item) => item.event), provenance: "mock" as const };
  const { getSessionCookieHeaderForEventReader } = await import("@/lib/dal");
  const { readBeWalletEventsWithProvenance } = await import("@/lib/adapters/http/event-repository.server");
  // BE 응답의 provenance를 그대로 잇는다. BE가 MOCK_MODE면 mock, 실어댑터면 live — 세금 화면의 배지는 이 값을 따른다.
  return readBeWalletEventsWithProvenance(await getSessionCookieHeaderForEventReader());
}, fxRateProvider);

export const anchorProofProvider: AnchorProofProvider = {
  getProof: async (eventId) => {
    const event = store.getById(eventId)?.event;
    return event
      ? {
          tx_hash: event.tx_hash,
          merkle_root: `0x${event.id.replace("event-", "").padStart(64, "0")}`,
          anchored_at: event.block_timestamp,
          explorer_url: `https://etherscan.io/tx/${event.tx_hash}`,
        }
      : null;
  },
};

export { store as mockEventStore };
export { authStore };
