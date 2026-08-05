# 배포 제약 (v1 mock 단계)

이 저장소의 v1은 **mock 데이터 단계**다. 실제 백엔드·인덱서·OmniOne SDK·온체인 앵커링은 연결되어 있지 않다.

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

## dev 전용 라우트

`app/api/auth/test-login/route.ts`는 완료 세션을 즉시 발급하는 **e2e 전용** 경로이며
`NODE_ENV=production`에서 404를 반환한다. 실제 배포 전 제거하거나 빌드에서 제외한다.

## 온보딩 순서

서버 가드(`lib/dal.ts`)가 DID → 지갑 → 대시보드 순서를 강제한다.
`/api/auth/did/present`는 DID 제시 시 기존 지갑 클레임을 초기화해 역순(SIWE→DID) 우회를 차단한다.
백엔드 교체 시에도 이 불변식을 유지해야 한다.
