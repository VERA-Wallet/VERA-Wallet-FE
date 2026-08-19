# BE 계약 확장 초안 — `pair_id` · `ignored` · `sub_label`

> 상태: **초안**. 2026-08-19 결정된 1차 계약 묶음의 FE측 제안이며, BE(NestJS, `VERA-Wallet-BE`)와 합의되기 전까지 코드에 반영하지 않는다.
> 이 문서는 스키마·엔드포인트·롤아웃 순서를 미리 못박아 두어, 구현이 시작될 때 양쪽이 같은 칸 이름과 같은 불변식을 두고 출발하게 하는 것이 목적이다.

## 1. 배경과 결정

`NormalizedEvent`는 지금 "한 지갑에서 일어난 자산 이동 한 건"만 말한다. 이 모델로는 셋을 말할 수 없다.

- **교환은 한 건이 아니다.** 스왑은 나간 레그와 들어온 레그 두 개로 인덱싱되는데, 둘을 잇는 칸이 없다. 그래서 `deriveTaxEvents`는 교환을 피아트 처분으로 근사하고(`LIMITATION_MESSAGE.EXCHANGE_APPROXIMATION`) 화면은 그 근사를 한계로 고백한다. 상대 자산을 모르는 게 아니라, **알아도 이을 곳이 없다.**
- **스팸을 지울 방법이 없다.** 사칭 에어드랍은 `asset_verified: false`로 표시되지만 여전히 확인 필요 큐에 쌓이고 계산 대상 집합에 후보로 남는다. 사용자가 "이건 쓰레기다"라고 말할 칸이 없다.
- **소득 유형을 말할 수 없다.** 스테이킹 보상과 지인이 보내준 선물은 둘 다 `RECEIVE`다. 나라마다 이 둘의 세율이 다른데 화면은 구분해 물어볼 수조차 없다.

2026-08-19, **1차 계약 묶음을 `pair_id`·`ignored`·`sub_label` 3필드로 확정**했다. 셋 다 기존 5종 `classification`을 건드리지 않고 **축을 하나씩 더 세우는** 방식이라, 이미 굳은 판정 로직(`lib/review.ts`)을 다시 열지 않고 얹을 수 있다.

### 각 필드가 여는 기능

| 필드 | 여는 기능 | 이 필드 없이는 |
|---|---|---|
| `pair_id` | 교환 쌍 UI(한 줄에 "A → B"), 교환 근사 한계 제거, **거래소 연동의 전제** | 스왑이 두 줄로 흩어져 보이고, 원장은 상대 자산 없이 피아트 처분으로 근사한다 |
| `ignored` | 리뷰 큐 무시 액션, **과금 건수 셈법**(계산 대상 이벤트를 세되 스팸은 빼는) | 스팸 에어드랍 한 번에 확인 필요 카운트가 수백이 되고, 그 수를 과금 근거로 쓸 수 없다 |
| `sub_label` | 소득 유형 판정 연결(스테이킹·에어드랍·채굴·이자 vs 선물·분실) | `RECEIVE` 하나로 뭉개져, 나라별 소득 구분 규칙을 태울 입력이 없다 |

### 의존 관계: 과금 설계

과금은 **과세연도별 결제**로 확정됐다. 사용자는 정산하려는 과세연도를 골라 그 연도분을 결제한다. 이때 요금을 결정하는 건수는 **그 연도의 계산 대상 이벤트 수**이며, `ignored`가 그 셈법에서 빠진다.

곧 `ignored`는 표시 편의 기능이 아니라 **과금 산식의 입력**이다. 두 가지가 따라온다.

- 무시 판정은 되돌릴 수 있어야 하고(`ignored`를 `null`로), 되돌린 이력이 남아야 한다. 요금이 달라지는 조작이 흔적 없이 일어나면 나중에 어느 쪽도 증명할 수 없다.
- 무시는 **사용자 행위**와 **시스템 제안**을 구분해 기록해야 한다(`by`). 우리가 자동으로 빼준 건수와 사용자가 직접 뺀 건수는 분쟁 시 의미가 다르다.

## 2. 스키마 초안

`lib/schema/normalized-event.ts`의 `normalizedEventSchema`에 3필드를 더한다. 전부 **`default` 폴백**을 갖는다.

### 왜 전부 `default`인가 — 버전 스큐 방어

이미 같은 이유로 `asset_symbol`·`asset_verified`·`asset_icon_url`이 `default`를 달고 있다. 그 주석이 근거를 그대로 말한다.

> `default`는 **버전 스큐 방어**다. 이 칸을 모르는 옛 응답(배포 중인 구버전 서버, 재시드되지 않은 dev 스토어)이 오면 목록 전체가 파싱에 실패해 "거래를 불러오지 못했습니다"가 된다. 칸 하나가 비었다고 이력 전부를 못 보여주는 건 균형이 맞지 않는다.

3필드도 같다. 새 칸을 필수로 두면 배포가 원자적이어야 하고, 원자적이지 않은 순간 사용자는 거래 이력 전체를 잃는다. 셋 다 "모른다"에 해당하는 값(`null`)을 기본으로 갖는다.

### `pair_id`

```ts
/**
 * 같은 트랜잭션의 상대 레그와 공유하는 식별자. 쌍이 아니면 null.
 *
 * 스왑은 나간 레그와 들어온 레그로 따로 인덱싱된다. 이 칸이 둘을 잇는 유일한 끈이며,
 * 없으면 교환은 상대 자산을 모르는 피아트 처분으로 근사된다(`LIMITATION_MESSAGE.EXCHANGE_APPROXIMATION`).
 *
 * 생성 규칙은 BE 소유다. 제안: `${tx_hash}:${swapIndex}` — 한 트랜잭션에 스왑이 여러 번
 * 들어가는 경우(라우터 경유 멀티홉)를 인덱스로 가른다. FE는 이 문자열을 파싱하지 않고 동등성만 본다.
 */
pair_id: z.string().min(1).nullable().default(null),
```

**불변식** (쌍 단위이므로 단일 이벤트 스키마로는 검증할 수 없다 — 아래 `superRefine` 항 참조)

1. 같은 `pair_id`를 가진 이벤트는 정확히 **2건**이다.
2. 같은 `pair_id`는 같은 `tx_hash`를 갖는다.
3. 두 레그의 `direction`은 서로 반대다(`IN` 하나, `OUT` 하나).
4. `pair_id`가 붙은 이벤트의 `classification`은 `EXCHANGE`다.

### `ignored`

```ts
/**
 * 사용자(또는 제안)가 이 이벤트를 셈에서 뺐다. 빼지 않았으면 null.
 *
 * 계산 대상·확인 필요 집계에서 모두 빠지고, 과금 건수에서도 빠진다.
 * 값을 null로 되돌리면 복원되며, 무시했던 사실은 `override_history`에 남는다 —
 * 요금이 달라지는 조작이므로 흔적 없이 사라지면 안 된다.
 *
 * `reason`은 왜 뺐는지다. 화면은 이 사유를 그대로 보여주고 지어내지 않는다.
 * `by`는 누가 뺐는지다. 우리가 제안해 빠진 건과 사용자가 직접 뺀 건은 분쟁 시 의미가 다르다.
 */
ignored: z
  .object({
    reason: z.enum(["spam", "duplicate", "user"]),
    ignored_at: z.string().datetime(),
    by: z.enum(["user", "suggestion"]),
  })
  .nullable()
  .default(null),
```

`reason`을 자유 문자열이 아니라 열거로 두는 이유: 화면이 사유별로 다른 말을 해야 하고(스팸은 "사칭 의심", 중복은 "같은 거래가 두 번 들어왔습니다"), 과금 감사에서 사유별 건수를 세야 한다. 자유 문자열이면 둘 다 정규식으로 산문을 뜯게 된다 — `lib/tax/limitations.ts`가 이미 같은 이유로 문구를 종류로 분류한다.

### `sub_label`

```ts
/**
 * 소득 유형. `classification`과는 **별개 축**이다.
 *
 * classification 5종(RECEIVE·SEND·EXCHANGE·INTERNAL_TRANSFER·UNKNOWN)은 불변이다.
 * 스테이킹 보상과 지인의 선물은 둘 다 RECEIVE지만 나라마다 세율이 다르다 —
 * classification에 값을 더하면 이미 굳은 판정·파생 전부가 열린다. 축을 하나 더 세운다.
 *
 * 모르면 null이고, 화면은 추측하지 않는다.
 */
sub_label: z
  .enum([
    "staking", "airdrop", "mining", "interest",   // 유입 소득
    "gift_in", "gift_out",                        // 무상 이전
    "lost",                                       // 분실·소각
    "bridge",                                     // 체인 간 이동
    "liquidity", "wrap",                          // LP·랩핑
  ])
  .nullable()
  .default(null),
```

**`sub_label`은 `classification`을 바꾸지 않는다.** `sub_label: "staking"`이 붙어도 그 이벤트는 여전히 `RECEIVE`이고, `effectiveClassification`·`assetFlow`·`deriveTaxEvents`의 갈래는 그대로다. 세율 판정에서만 추가 입력으로 쓴다. 이 경계를 흐리면 "선물로 표시했더니 원장에서 사라졌다" 같은 일이 생긴다.

### `superRefine` 추가 제안

기존 `superRefine`은 가격 상태와 심볼 검증의 정합성을 지킨다. 여기에 단일 이벤트로 판정 가능한 것만 더한다.

```ts
// pair는 교환에만 붙는다. 송금 한쪽에 pair_id가 붙으면 쌍 UI가 상대를 영원히 찾는다.
if (event.pair_id !== null && event.classification !== "EXCHANGE") { … }

// 제안으로 무시된 건의 사유는 "user"일 수 없다. 사용자가 말하지 않은 것을 사용자 뜻이라 하지 않는다.
if (event.ignored?.by === "suggestion" && event.ignored.reason === "user") { … }
```

`pair_id`의 나머지 불변식(2건·같은 tx_hash·반대 direction)은 **집합 단위**라 여기서 검증할 수 없다. `lib/collect/bounded-event-collector.ts`가 모은 스냅샷 위에서, 또는 `deriveTaxEvents` 진입에서 확인하고 어긋나면 쌍을 풀어 개별 이벤트로 취급한다(계산을 멈추지 않는다 — 짝이 안 맞는 게 이력 전체를 못 보여줄 이유는 아니다).

### transport 경계

`lib/schema/be-event-transport.ts`의 `toCanonical`은 BE의 `symbol` 키를 canonical `asset_symbol`로 옮긴다. **BE가 3필드를 같은 snake_case 이름으로 내보내면 transport 변환은 필요 없다.** BE `event.presenter.ts`의 `publicEvent`가 `_`로 시작하는 내부 키만 걷어내고 나머지 payload를 통과시키므로, payload에 칸을 더하면 presenter 수정 없이 FE까지 흐른다.

이름이 갈리면(`pairId` 등) `toCanonical`에 매핑을 더해야 한다. zod object는 미지 키를 결과에 남기지 않으므로 **디코딩 후 후처리로는 복구할 수 없다.** 같은 이름을 쓰는 편이 싸다.

## 3. 엔드포인트 초안

### `PATCH /api/events/{id}` 확장

지금 이 경로는 재분류 하나만 받는다. FE `reclassifyRequestSchema`와 BE `ReclassifyDto` 모두 `classification`을 **필수**로 요구한다.

> **BE측 선행 작업.** BE `ReclassifyDto`는 `@IsIn([...]) classification!: string`으로 classification을 필수로 검증한다. 무시 처리만 보내는 요청은 지금 400으로 거절된다. classification을 optional로 내리든 본문을 분기하든, **BE DTO 수정 없이는 FE만으로 이 기능을 낼 수 없다.**

제안: 한 경로가 세 가지 부분 수정을 받는다. 셋 다 기존 재분류의 패턴을 그대로 따른다 — `expectedVersion` 낙관적 잠금, `override_history` 이력 축적, 409에 최신 상태 동봉.

```ts
// FE 제안 (app/api/events/[id]/route.ts)
const patchRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().optional(),
  classification: classificationSchema.optional(),
  ignored: z.object({ reason: z.enum(["spam", "duplicate", "user"]) }).nullable().optional(),
  sub_label: subLabelSchema.nullable().optional(),
}).refine(
  // 아무것도 바꾸지 않는 PATCH는 version만 올리는 무의미한 쓰기다.
  (body) => body.classification !== undefined || body.ignored !== undefined || body.sub_label !== undefined,
);
```

| 요청 | 효과 |
|---|---|
| `{ ignored: { reason: "spam" }, expectedVersion }` | 서버가 `ignored_at`을 찍고 `by: "user"`로 기록. 클라이언트 시계를 신뢰하지 않는다 |
| `{ ignored: null, expectedVersion }` | 복원. `override_history`에 무시 해제 전이가 남는다 |
| `{ sub_label: "staking", expectedVersion }` | 소득 유형 설정. `classification`은 건드리지 않는다 |
| `{ classification: "SEND", expectedVersion }` | 기존 재분류. 동작 변화 없음 |

`ignored_at`·`by`를 요청 본문에서 받지 않는 이유: 둘 다 과금 감사의 근거다. 클라이언트가 보내는 값을 그대로 저장하면 감사 기록을 클라이언트가 쓰는 셈이 된다.

`override_history`(현재 `OverrideTransition`)는 classification 전이만 담는 모양이다. 세 종류 전이를 함께 담으려면 `field: "classification" | "ignored" | "sub_label"`을 붙인 판별 합집합으로 넓혀야 한다. **기존 항목에 `field: "classification"` 기본값을 주면 옛 이력도 그대로 읽힌다** — 스키마 확장과 같은 폴백 전략이다.

### 목록·요약에서 `ignored` 취급

**목록(`GET /api/events`)은 `ignored` 이벤트를 계속 내려보낸다.** 응답에서 빼면 사용자가 잘못 무시한 건을 되돌릴 방법이 사라지고, `nextCursor`가 깨진다 — BE `EventQueryService.list`와 FE `MockEventStore.list`는 둘 다 `findIndex`로 커서 id의 위치를 찾아 페이지를 자른다. 커서가 가리키는 이벤트가 필터로 사라지면 `findIndex`는 `-1`을 주고 페이지가 처음으로 되감긴다. 필터가 필요하면 별도 질의 파라미터(`?ignored=exclude`)로 열고, **기본값은 포함**이다.

**요약(`GET /api/events/summary`)의 카운트에서는 빠진다.**

| 카운트 | `ignored` 취급 |
|---|---|
| `computableEventCount` | 제외 (과금 건수의 기준) |
| `taxableEventCount` | 제외 |
| `pendingReviewCount` | 제외 (무시의 목적이 큐에서 빼는 것이다) |
| `periodPnl` | 제외 (계산 대상이 아니면 손익에도 없다) |

> **`lib/review.ts`의 불변식이 다시 쓰여야 한다.** 그 파일은 지금 **계산 제외 ⊆ 확인 필요**를 지킨다 — 세금 화면에서 제외 배너를 누른 사용자는 대시보드 확인 필요 탭에서 그 거래를 반드시 찾을 수 있어야 한다. `ignored`는 계산에서 빠지면서 확인 필요에서도 빠지므로 이 포함 관계를 정면으로 깬다.
>
> 불변식을 **"무시되지 않은 이벤트 안에서 계산 제외 ⊆ 확인 필요"** 로 좁히고, 무시된 건은 **세 번째 통("제외됨")** 으로 따로 센다. 그 수를 어디에도 표시하지 않으면 사용자 입장에서 거래가 조용히 사라진다 — 무시는 삭제가 아니고, 화면은 "N건을 제외했습니다"라고 말하고 되돌릴 길을 줘야 한다.

또한 BE `EventQueryService.summary`는 FE `lib/review.ts`를 쓰지 않고 **같은 판정을 손으로 다시 쓴다**(`price_status !== "UNKNOWN" && classification !== "UNKNOWN" …`). `ignored` 제외 규칙을 한쪽에만 넣으면 대시보드 카드 숫자와 세금 화면이 서로 다른 말을 한다. 양쪽에 동시에 넣고, 계약 테스트로 두 구현이 같은 수를 내는지 고정한다.

### 판정 엔진의 `pair_id` 사용

`deriveTaxEvents`(`lib/tax/derive.ts`)는 지금 `EXCHANGE`를 이렇게 처리한다.

```ts
// 교환 상대 자산 메타데이터가 없어 피아트 처분으로 근사한다(비과세 교환 국가에서는 과대계상 가능).
assumptions.add(LIMITATION_MESSAGE.EXCHANGE_APPROXIMATION);
derived.push({ kind: "DISPOSE", ...base, proceeds: fiatValue, fee: ZERO, trigger: "FIAT" });
```

`pair_id`가 있으면 두 레그를 묶어 **처분 + 취득 한 쌍**으로 파생할 수 있다. 나간 레그가 `DISPOSE`, 들어온 레그가 `ACQUIRE`이고 취득 원가는 처분 대가에서 온다. 그러면 `EXCHANGE_APPROXIMATION` 한계 문구가 그 쌍에 대해 사라진다 — 근사를 없앤 게 아니라 **근사할 필요가 없어진** 것이므로, 한계 문구는 조건부로 남는다(짝이 안 맞는 교환에는 여전히 붙는다).

셈이 한 번만 되도록 지키는 규칙:

- 쌍의 두 레그가 **같은 기간 스냅샷 안에 있을 때만** 쌍으로 파생한다. 한쪽이 페이지 경계·기간 경계 밖이면 쌍을 풀고 기존 근사로 되돌린다.
- 쌍으로 파생한 이벤트 id는 `excludedEventIds`에 넣지 않는다. `deriveTaxEvents`는 이미 같은 id를 `judgments`와 `excludedEventIds` 양쪽에 내보내지 않는 계약을 지키고 있다.
- 한쪽 레그가 `ignored`면 **쌍 전체를 무시**한다. 한 레그만 빠지면 처분은 있는데 취득이 없는 원장이 된다.

## 4. 마이그레이션·롤아웃 노트

**배포 순서는 무관하다.** 이것이 `default` 폴백을 두는 값이다.

| 순서 | 결과 |
|---|---|
| BE가 먼저 필드를 내보낸다 | FE 스키마가 미지 키를 결과에 남기지 않으므로 그냥 무시된다. 화면 변화 없음 |
| FE가 먼저 배포된다 | 3필드가 `default`로 채워져 `null`이 된다. 쌍 없음·무시 없음·유형 모름 = 지금 동작과 같다 |
| 둘 다 배포됐다 | 기능이 켜진다 |

앞뒤가 섞여도 사용자는 "거래를 불러오지 못했습니다"를 보지 않는다. 새 칸을 필수로 두는 순간 이 성질이 사라진다.

**mock 스토어에 같은 필드를 동시에 추가한다.** `lib/mock/fixtures.ts`의 `createNormalizedEventFixtures`와 `lib/mock/store.ts`의 `MockEventStore`가 대상이다. OFF 모드가 3필드를 모르면 mock으로 도는 e2e·UI 테스트가 새 화면을 전혀 덮지 못하고, `docs/deployment-constraints.md`가 세운 **OFF/ON 패리티**가 깨진다. 픽스처에는 최소한 이만큼을 넣는다.

- 교환 쌍 1개(같은 `pair_id`, 같은 `tx_hash`, 반대 `direction`) — 쌍 UI와 쌍 파생의 유일한 입력
- 짝이 안 맞는 `pair_id` 1건 — 쌍을 풀고 근사로 되돌리는 경로
- `ignored` 1건(`reason: "spam"`, `by: "suggestion"`) — 제외 카운트와 복원 경로
- `sub_label`이 붙은 `RECEIVE` 1건 — 소득 유형이 classification을 바꾸지 않음을 고정

픽스처 시각은 `lib/mock/demo-calendar.ts`가 쥔 공통 창 안에 둔다. 창을 벗어나면 12개 룰셋이 서로 다른 거래 집합을 보고도 같은 해라고 말한다(`tests/unit/demo-fixture-window.test.ts`가 이 불변식을 지킨다).

**프록시 소유권은 그대로다.** ON 모드에서 `/api/events` 하위 전체(`GET`·`PATCH`)는 BE 소유다(`proxy.ts` allowlist). `PATCH` 확장은 BE 구현이며, FE 라우트 핸들러는 OFF 모드 경로에서만 탄다. 세금 경로는 FE에 남지만 계산 **입력**은 BE 이벤트를 쓰므로, 3필드는 `lib/adapters/http/event-repository.server.ts`를 통해 세금 화면까지 자동으로 흐른다.

## 5. 비범위

이 묶음에 넣지 않는다. 별도 트랙이며, 여기서 미리 칸을 잡아두지도 않는다 — 쓰지 않을 칸을 계약에 넣으면 양쪽이 그 칸의 의미를 각자 상상한다.

| 항목 | 트랙 | 왜 나중인가 |
|---|---|---|
| 다중 지갑 세션 | G5 | 세션·바인딩 계약을 함께 열어야 한다. 이벤트 스키마만으로 끝나지 않는다 |
| 수수료 환산(`fee_*`) | D2 | 지금 `gas_fee_native`는 네이티브 수량이라 법정통화 환산 없이는 원가에 못 넣는다(`LIMITATION_MESSAGE.GAS_FEE`). 가격 계층 변경이 선행이다 |
| `reference_price` | D6 | 가격 출처·시각 정책이 먼저 정해져야 한다. `price_status` 3종의 의미와 겹친다 |

## 6. BE에 물을 것

| # | 질문 | 왜 답이 필요한가 |
|---|---|---|
| 1 | 쌍 감지는 인덱서에서 하는가, 저장 후 후처리인가? | 인덱서(`indexer.adapters.ts`)는 이미 `eventType: "swap"`을 판별한다. 쌍 결정을 여기서 하면 `pair_id`가 payload에 처음부터 들어오고, 후처리면 기존 레코드 백필 계획이 따로 필요하다 |
| 2 | `pair_id` 생성 규칙과 멀티홉 처리 — 한 트랜잭션의 스왑 여러 건을 어떻게 가르는가? | FE는 문자열을 파싱하지 않지만, "쌍은 정확히 2건" 불변식이 멀티홉에서 성립하는지는 규칙에 달렸다 |
| 3 | 실제 인덱서(Alchemy)로 갈 때도 쌍 정보가 오는가? | `AlchemyAdapter`는 아직 `ServiceUnavailableException`이다. 실 어댑터가 상대 레그를 못 주면 `pair_id`는 mock에서만 채워진다 |
| 4 | 스팸 판정의 출처는? 토큰 목록·휴리스틱·외부 서비스 중 어느 것인가? | `by: "suggestion"`으로 무시를 제안하려면 판정 주체가 있어야 한다. BE에는 지금 토큰 화이트리스트 개념이 없어 `asset_verified`가 항상 `false`다 |
| 5 | `sub_label` 자동 추론 범위 — BE가 추론해 채우는가, 사용자 입력만 받는가? | 자동 추론이 있으면 확정 여부를 표시할 칸(신뢰도 또는 `by`)이 `sub_label`에도 필요하다. 이 초안은 사용자 입력만 가정한다 |
| 6 | `ReclassifyDto`를 확장하는가, 별도 엔드포인트를 여는가? | 지금 DTO는 `classification`을 필수로 검증한다. 무시만 보내는 PATCH는 400이다 — BE 결정 없이는 FE가 부를 곳이 없다 |
| 7 | `override_history` 항목에 `field` 판별자를 넣는 데 합의하는가? | 세 종류 전이를 한 배열에 담을지, 배열을 나눌지가 상세 화면 이력 UI를 가른다 |
| 8 | `_version`은 세 필드 수정 모두에서 오르는가? | 오른다고 가정했다. 무시 처리만 version을 올리지 않으면 낙관적 잠금에 구멍이 난다 |
| 9 | 무시 처리에 상한이나 감사 로그가 필요한가? | `ignored`가 과금 건수를 줄이므로 회피 유인이 생긴다. 정책이 필요하면 계약에 칸이 더 붙는다 |
| 10 | 요약 카운트의 `ignored` 제외를 계약 테스트로 고정하는 데 합의하는가? | BE `summary`와 FE `lib/review.ts`는 이미 같은 판정을 각자 구현하고 있다. 한쪽만 고치면 화면이 모순된다 |
