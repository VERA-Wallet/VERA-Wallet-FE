VeraWallet FE — Next.js 16 App Router 프론트엔드.

## 두 가지 실행 모드

이 앱은 **OFF(로컬 mock)** 와 **ON(BE 연동)** 두 모드로 돈다. 결정 기준은 환경변수다.

| | OFF | ON |
|---|---|---|
| 트리거 | `VERAWALLET_BACKEND_ORIGIN` 미설정 또는 `VERAWALLET_MOCK_MODE=true` | `VERAWALLET_BACKEND_ORIGIN` 설정 및 `VERAWALLET_MOCK_MODE` 미설정 |
| 세션 쿠키 | `vw_session` (FE 인메모리 저장소) | `vw_access_token` (BE JWT) |
| `/api/auth/*`, `/api/events*`, `/api/anchor-proof` | FE Route Handler | `proxy.ts`가 BE로 전달 |
| `/api/tax/*`, `/api/rulesets` | FE Route Handler | FE Route Handler (그대로) |
| `/api/auth/test-login` | dev 전용 헬퍼 | **404** |
`VERAWALLET_MOCK_MODE=true`는 백엔드 URL이 설정돼 있어도 FE mock을 강제하는 스위치다.

모드는 **요청 시점 판정**이다. 단, `sessionReader`는 모듈 로드 시점에 고정되고, `proxy`·`beFetch`·warm-up·`test-login`은 호출 시점에 판정된다 — 환경변수 변경은 반드시 프로세스를 재시작해야 한다. `next.config.ts`의 rewrite로 하지 않는 이유는 두 가지다.
rewrite는 원 요청 Cookie를 그대로 상류로 보내고, `.next/routes-manifest.json`에 빌드 시점으로 박혀
OFF로 빌드한 산출물에 env만 켜면 "인증은 ON, 브라우저 이벤트는 FE mock"인 혼합 모드가 된다.

## OFF 모드로 실행

```bash
pnpm install
pnpm dev -p 3100
```

포트는 OFF 모드에서도 `SIWE_TRUSTED_ORIGIN`과 맞춰야 한다. OFF의 SIWE nonce는 FE `lib/env.ts`가 그 값으로
`domain`/`uri`를 만들고 요청 host와 다르면 거절하므로, 3000에서 띄우고 `SIWE_TRUSTED_ORIGIN`이 3100이면 지갑 연결이 막힌다.

## ON 모드로 실행 (BE 연동)

### 1. Backend

`verawallet-be`를 형제 디렉터리에 두고:

```bash
cd ../verawallet-be
pnpm install
pnpm --filter @vera/interfaces build
pnpm --filter @vera/tax-engine build
cd apps/backend
rm -f tsconfig.build.tsbuildinfo   # composite + deleteOutDir 조합 때문에 stale이면 dist가 비어 기동이 실패한다
npx tsc -p tsconfig.build.json

MOCK_MODE=true PORT=3200 \
FRONTEND_ORIGIN=http://localhost:3100 \
SIWE_TRUSTED_ORIGIN=http://localhost:3100 \
JWT_SECRET=local-development-secret-at-least-32-characters \
node dist/main.js
```

`curl http://localhost:3200/health` 가 `"mockMode": true` 를 돌려주면 준비된 것이다.

### 2. Frontend

```bash
cp .env.example .env.local     # VERAWALLET_BACKEND_ORIGIN 확인
VERAWALLET_BACKEND_ORIGIN=http://localhost:3200 pnpm dev -p 3100
```

**포트를 3100으로 고정해야 한다.** BE는 `SIWE_TRUSTED_ORIGIN`에서 SIWE challenge의 `domain`/`uri`를 만들고
클라이언트는 그 값을 **그대로** 서명한다. 그래서 포트가 달라도 `challenge_mismatch`가 나지는 않는다 —
대신 사용자가 실제로 보고 있는 주소와 서명 메시지의 주소가 어긋나 SIWE의 origin 보장이 무의미해진다.
(`challenge_mismatch`는 클라이언트가 challenge 값을 재생성하거나 고쳤을 때 난다.)

### 3. 연동 확인

BE에는 요청별 stdout 로깅이 없다. 프록시 도달은 응답으로 확인한다.

```bash
curl -i -X POST -H 'content-type: application/json' -d '{"country":"KR"}' \
  http://localhost:3100/api/auth/did/present
```

`201` + `Set-Cookie: vw_access_token=…` 이면 BE에 도달한 것이다.
OFF 모드에서 같은 요청은 `201` + `Set-Cookie: vw_session=…` 을 준다(`204`는 `/api/auth/test-login` 쪽이다).

## 롤백

**자동 failover가 아니다.** `VERAWALLET_BACKEND_ORIGIN`을 지우거나 `VERAWALLET_MOCK_MODE=true`로 설정하고 **FE 프로세스를 재시작**해야 OFF로 돌아간다.
이때 `SIWE_TRUSTED_ORIGIN`도 실제 FE origin과 맞는지 확인한다 — ON에서는 무시되던 값이 OFF에서는 다시 유효해진다.
BE가 실행 중 죽어도 앱이 알아서 mock으로 넘어가지 않는다 — 장애를 로그인 화면으로 위장하지 않기 위한 의도된 동작이며,
보호 페이지는 오류 화면을 보여준다. FE가 계속 소유하는 API(`/api/tax/*`, `/api/rulesets`)는
**access token을 실은 요청**에 한해 502 `upstream_unavailable`을 돌려준다 — 쿠키가 없으면 BE를 부르지 않고 401이다.
프록시가 BE로 넘기는 경로(auth·events·anchor-proof)는 BE가 없으면 Next의 프록시 오류가 그대로 드러난다 — FE 계약이 아니다.

## 알려진 모드 차이 (`MOCK_MODE=true` 기준)

아래는 위 절차대로 BE를 `MOCK_MODE=true`로 띄웠을 때의 관측이다.
`MOCK_MODE=false`는 Prisma 저장소와 실 어댑터를 쓰므로 재시작 지속성·앵커 동작이 달라진다(그 모드는 아직 검증 범위 밖이다).

- **BE 재시작 시 세션이 반쪽만 살아남는다.** BE 인메모리 저장소(user·binding·transaction·challenge)가 전부 사라지지만
  JWT 서명은 그대로 유효하다. `/api/auth/session`은 `didVerified: true, walletAddress: null`을 주는데
  `/api/events`는 401을 준다. 화면은 `/connect-wallet`으로 가고 API는 거절하는 상태이므로 **재로그인**해야 한다.
- **ON 모드 최초 진입 시 기존 FE demo 데이터는 보존되지 않는다.** 재분류 이력을 포함한 mock 저장소 상태는
  FE 프로세스 메모리에만 있었고 BE로 옮기지 않는다.
- **DID 재제시가 지갑 바인딩을 지우지 않는다.** FE mock과 BE 모두 지갑 클레임을 보존한다. 역순(SIWE→DID) 차단은 nonce·verify의 DID 가드와 challenge 세션 귀속이 담당한다.
- **`/api/auth/session`에는 `chainId`가 없다.** EVM 주소는 체인 불문 동일하므로 세션은 체인 클레임을 내려주지 않고, 활동 체인은 이벤트 데이터(`chain_id`)나 `POST /api/events/resync` 응답의 `chains`에서 파생한다.
- **앵커 제출은 멱등이 아니다.** 같은 이벤트를 다시 sync하면 `tx_hash`/`anchored_at`이 바뀔 수 있다.
- **리포트 내보내기(CSV·XLSX)의 파일 해시 등록(`report-anchor`)은 아직 BE 계약이 없다.** 계약 초안은 `docs/be-contract-draft-report-anchor.md`. 서버 env `REPORT_ANCHOR_GATE`(기본 on, fail-closed)로 게이트를 켜고 끈다.
  - OFF(`REPORT_ANCHOR_GATE=off`): 내려받기가 해시·등록·폴링 없이 예전처럼 즉시 저장된다. mock 저장소는 등록 후 일정 시간이 지나야 `pending → anchored`로 전이하고, `POST /api/mock/report-anchor-failure`로 실패를 강제할 수 있다(e2e 전용, ON이거나 production이면 404).
  - ON(미설정 포함, 기본값): 내려받기 전에 파일 바이트를 `keccak256`으로 해시해 `/api/report-anchor`에 등록하고, `anchored` 확정까지 최대 60초 폴링한다. **BE가 이 계약을 구현하기 전에 ON 모드로 배포하면 등록이 항상 실패해 내려받기가 전부 막힌다** — BE 구현 전 ON 모드 배포는 `REPORT_ANCHOR_GATE=off`를 반드시 넣는다.

## SIWE 설정이 사는 곳

| 모드 | SIWE domain/uri 출처 |
|---|---|
| OFF | FE `lib/env.ts` (`SIWE_TRUSTED_ORIGIN`) |
| ON | BE `ConfigService`의 `SIWE_TRUSTED_ORIGIN` — FE 설정은 이 모드에서 쓰이지 않는다 |

## 테스트

```bash
pnpm test                                                  # unit/UI (jsdom)
pnpm test:integration                                      # BE·FE를 하네스가 직접 기동 (직렬)
pnpm test:e2e                                              # OFF 모드 e2e
VERAWALLET_BACKEND_ORIGIN=http://localhost:3200 pnpm test:e2e   # ON 모드 e2e
pnpm lint
pnpm build
```

ON 모드 e2e는 스펙 파일마다 BE를 재기동한다(OFF에는 재기동할 BE가 없다). BE mock identity가 모든 DID 제시를 같은 사용자로 매핑하기 때문에
지갑 프라이빗키를 바꿔도 격리되지 않고, 프로세스 재기동만이 인메모리 상태를 초기화한다.

모드 전용 스펙은 반대 모드에서 skip한다(`g001-session-gate-redteam`·`g002-wallet-siwe`는 OFF 전용,
`g002-cutover-redteam`은 ON 전용). 각 모드의 등가 계약은 `tests/integration/route-table.test.ts`와
`be-siwe-contract.test.ts`가 실제 BE로 검증한다.
