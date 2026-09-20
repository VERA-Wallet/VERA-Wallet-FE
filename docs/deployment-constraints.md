# 배포 제약 (v1 mock 단계)

이 저장소의 v1은 **mock 데이터 단계**다. 실제 백엔드·인덱서·OmniOne SDK·온체인 앵커링이 연결되지 않는 제약은 **OFF(mock) 모드에 한정**된다. ON 모드에서는 `proxy.ts`를 통해 BE에 연동한다.

## in-memory mock 저장소

`lib/composition-root.server.ts`는 `MockEventStore`와 `MockAuthStore`를 `globalThis`에 고정한다.

- **이유**: Route Handler와 RSC는 서로 다른 모듈 그래프로 번들될 수 있어 모듈 스코프 싱글턴이 분리된다.
  분리되면 Route Handler가 만든 세션을 페이지 가드가 보지 못한다.
- **HMR**: `??=`는 기존 인스턴스를 유지한다. 저장소 클래스나 fixture를 수정해도 dev 서버를 재시작하기 전까지
  기존 객체·데이터가 남는다(핫리로드로 초기화되지 않는다).
- **다중 프로세스/인스턴스**: 프로세스마다 별도 메모리를 갖는다. 서버리스·다중 워커·스케일아웃 환경에서는
  세션과 이벤트 상태가 요청 간에 공유되지 않는다.

따라서 현재 구성은 **로컬/테스트 단일 프로세스 전용**이다. 실제 배포에서는 다음으로 교체해야 한다.

| mock | 교체 대상 |
|---|---|
| `MockAuthStore`(챌린지/세션) | 공유 durable 저장소(Redis·DB)의 원자적 nonce consume + 세션 |
| `MockEventStore`(이벤트/요약) | 백엔드 인덱싱·분류·로트 원장 API |
| `anchorProofProvider` mock | 실제 앵커링 컨트랙트 조회 |
| `/api/auth/did/present` mock | OmniOne SDK(CX vs 디지털아이디는 스펙 §14.2 미결) 연동 |

## 픽스처 시각 (mock 데이터)

픽스처에 절대 연도를 박으면 해가 바뀌는 순간 모든 화면이 조용히 "계산할 거래 없음"이 된다.
2025년 픽스처는 2026년이 되자 어느 룰셋의 2026년 과세기간에도 걸리지 않았고, 12개 나라가 전부 0원을 말했다.

`lib/mock/demo-calendar.ts`가 이 시계를 혼자 쥔다.

- **데모 과세연도**: 공통 창이 이미 끝난 가장 최근 해(= 작년). 아직 안 끝난 해를 쓰면 미래 거래를 만든다.
- **공통 창 `[Y-07-01, Y+1-01-01)`**: 과세기간은 나라마다 다르다(역년 / 영국 4/6~ / 호주 7/1~).
  세 기간의 교집합 안에 과세 대상 거래를 넣어야 같은 연도를 골랐을 때 12개 룰셋이 **같은 거래 집합**을 본다.
  창을 벗어나면 호주만 5건·영국만 8건을 보고도 화면은 같은 해라고 말한다.
- **불변식은 `tests/unit/demo-fixture-window.test.ts`가 지킨다.** 픽스처를 옮기려면 이 테스트부터 본다.
- **기대값을 락인하는 테스트는 `tests/fixtures/tax-year.ts`의 `FIXTURE_TAX_YEAR`를 픽스처 생성과 `taxYear`에 함께 넘긴다.**
  프랑스 PFU·이탈리아 대체세처럼 연도에 따라 세율이 바뀌는 룰셋이 있어, 둘이 따로 흐르면 어느 날 이유 없이 빨개진다.

`/tax`는 "올해"가 아니라 **마지막 거래가 속한 과세연도**로 연다(`app/tax/page.tsx`).
백엔드로 교체할 때도 이 진입 규칙을 유지해야 한다 — 올해 거래가 없는 지갑에게 빈 비교 화면을 첫 답으로 주면 안 된다.

## dev 전용 라우트

`app/api/auth/test-login/route.ts`는 완료 세션을 즉시 발급하는 **e2e 전용** 경로이며
`NODE_ENV=production`에서 404를 반환한다. 실제 배포 전 제거하거나 빌드에서 제외한다.

## 온보딩 순서

서버 가드(`lib/dal.ts`)가 DID → 지갑 → 대시보드 순서를 강제한다.
FE mock(`app/api/auth/did/present/route.ts`)과 BE(`FrontendAuthController.present`)는 DID 제시 시 기존 지갑 클레임을 보존한다.
역순(SIWE→DID) 차단은 nonce·verify의 DID 가드와 challenge 세션 귀속이 담당한다.
(`tests/integration/be-siwe-contract.test.ts`가 이 계약을 고정한다).

## 하이브리드 프록시 경로 소유권

ON 모드(`VERAWALLET_BACKEND_ORIGIN` 설정)에서 어떤 경로가 어디로 가는지는 `proxy.ts`의 allowlist가 유일한 기준이다.
"가릴 것을 빼는" negative 방식을 쓰지 않는다 — 규칙을 하나 빠뜨리면 조용히 BE로 새어 나가고,
번들된 path-to-regexp는 `?`로 시작하는 그룹(negative lookahead)을 거부한다.

| 경로 | 소유 | 이유 |
|---|---|---|
| `POST /api/auth/did/present` | BE | DID 제시와 JWT 발급은 BE 계약 |
| `POST /api/auth/nonce` | BE | SIWE challenge는 BE의 `SIWE_TRUSTED_ORIGIN`으로 만들어진다 |
| `POST /api/auth/verify` | BE | 서명 검증과 지갑 바인딩 |
| `GET /api/auth/session` | BE | 세션 판정의 단일 진실 소스 |
| `POST /api/auth/logout` | BE | 쿠키 만료를 BE가 발급해야 실제로 끊긴다 |
| `DELETE /api/auth/wallets/:address` | BE | 지갑 등록 해제. 바인딩과 그 거래·동기화 커서를 BE가 함께 지우고 원장 캐시를 비운다 |
| `/api/events` (+ 하위 전체, `GET`·`PATCH`) | BE | 목록·요약·상세와 `PATCH /api/events/:id` 재분류까지 |
| `GET /api/anchor-proof` | BE | 앵커 증명 |
| `POST /api/tax/estimate` | **FE** | BE 세금 계층은 역년 고정·단일 세율·KR 무조건 UNDETERMINED로 FE 12개국 엔진보다 충실도가 낮다 |
| `GET /api/tax/rulesets`, `GET /api/rulesets` | **FE** | 위와 같은 이유. FE는 12개국, BE도 12개국이지만 계산 계층이 다르다 |
| `POST /api/auth/test-login` | **FE (ON에서 404)** | `vw_session`만 발급해 BE 세션이 되지 않는다. 열려 있으면 무의미한 가짜 세션을 만드는 함정 |

FE에 남는 세금 경로도 계산 **입력**은 BE 이벤트를 쓴다(`lib/adapters/http/event-repository.server.ts`).
그래야 대시보드·내보내기·세금이 같은 거래 집합을 본다. 이 연결이 끊기면 화면마다 다른 숫자를 말하게 된다.

프록시는 요청 헤더를 통째로 넘기지 않는다. BE `JwtStrategy`가 `Authorization`을 쿠키보다 먼저 읽으므로
호출자가 심은 bearer가 쿠키 신원을 덮어쓸 수 있고, 쿠키는 `vw_access_token` 하나로 다시 만들어 보낸다.
