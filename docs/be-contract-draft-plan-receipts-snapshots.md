# BE 계약 초안 — 과세연도별 결제 영수증 · 스냅샷 보관

> 상태: **초안**. FE(`lib/plan/use-plan.ts`, `components/export/export-view.tsx`)가 이번 내보내기 화면 보강(2026-09-17, 요약·거래 탭 분리 계획 단계 5) 중 마주친 결측을 정리한 것이며, BE(NestJS, `VERA-Wallet-BE`)와 합의되기 전까지 코드에 반영하지 않는다.
> `docs/be-contract-draft-pair-ignored-sublabel.md`와 같은 형식을 따른다.

## 1. 배경과 결정

`lib/plan/use-plan.ts`가 스스로 밝히듯, 지금 플랜은 **브라우저 로컬 상태뿐**이다. `localStorage`에 `{ tier, taxYear, activatedAt }` 한 건만 있고, 결제 API는 없다. 결제는 과세연도 단위라 사용자가 두 해를 신고하면 결제도 두 번이어야 하는데, 저장소 키(`vw_plan`)가 한 값만 쥘 수 있어 **연도가 다른 플랜으로 바꾸는 순간 이전 연도 결제 사실이 사라진다.**

이번에 내보내기 화면(`ExportView`)에 구독 상태 카드(`data-surface="plan-status"`)와 "과세연도별 결제" 카드(`data-surface="plan-payments"`)를 추가하면서 세 가지가 없다는 게 분명해졌다.

- **영수증 조회.** "과세연도별 결제"라는 제목을 걸었지만 지금은 활성 플랜 한 줄만 실데이터로 그린다(다른 연도 결제 이력은 지어내지 않는다 — `docs/be-contract-draft-pair-ignored-sublabel.md`가 세운 "없는 이력을 지어내지 않는다" 원칙과 같다). 여러 해 결제 이력을 보여주려면 연도별 영수증을 조회할 엔드포인트가 필요하다.
- **연도 귀속 검증.** `exportEventAllowance`의 주석이 이미 이 결측을 밝힌다: "활성 플랜의 `taxYear`를 내보내기 기간의 과세연도와 맞춰 보지는 않는다… 나라별 과세기간 경계와 '이 결제가 어느 연도에 귀속되는가'를 확정하는 BE 계약이 필요하고, 없는 계약을 프런트에서 흉내 내면 사용자는 결제한 연도가 검증됐다고 오해한다." 지금 구독 상태 카드가 보이는 "활성 플랜은 {A}년 귀속입니다 — 지금 보는 연도는 {B}년" 문구는 **사실만 말할 뿐 검증하지 않는다.** 어느 쪽이 맞는지 판정하려면 결제 시점의 과세기간 경계를 BE가 확정해야 한다.
- **스냅샷 보관.** 내보내기 리포트는 매번 `events`·`estimate`를 다시 계산해 즉석에서 만든다(`createReportLedgerCsv`, `createReportXlsx`). 사용자가 재분류·금액 override를 나중에 바꾸면 다운로드했던 파일과 지금 다시 받는 파일이 달라진다 — 신고 후 "그때 낸 파일이 뭐였는지" 재확인할 방법이 없다. 결제 시점의 리포트를 스냅샷으로 남겨 재다운로드할 수 있어야 감사·분쟁에 대응할 수 있다.

세 결측은 서로 얽혀 있다: 영수증에 스냅샷을 매달아야 "이 결제로 이 파일을 받았다"가 성립하고, 스냅샷은 결제 시점의 연도 귀속이 검증돼 있어야 나중에 그 해 신고 근거로 인정된다.

## 2. 스키마 초안

### `PlanReceipt`

```ts
/**
 * 과세연도 하나에 대한 결제 한 건. `Plan`(현재 use-plan.ts)의 서버측 원본이 된다 —
 * BE 계약이 생기면 usePlan은 이 목록의 최신 유효 건을 `Plan`으로 매핑하는 어댑터가 된다.
 */
type PlanReceipt = {
  id: string;
  taxYear: number;
  tier: "plus" | "pro";
  priceLabel: string;              // 결제 시점 가격 표시(카탈로그가 바뀌어도 영수증은 그때 가격을 고정해야 한다)
  amountKrw: number;                // 실제 청구액. priceLabel과 분리하는 이유는 프로모션·환율 등 예외가 생기면 표시와 청구가 갈릴 수 있어서다
  status: "active" | "refunded";
  purchasedAt: string;              // ISO datetime
  /** 결제 시점 계산 대상 이벤트 수. 연도 귀속 검증과 분쟁 대응의 근거(§ '연도 귀속 검증' 참조). */
  billableEventCountAtPurchase: number;
  /** 결제대행사 응답 식별자. mock 결제인 동안은 null. */
  providerReceiptId: string | null;
};
```

`priceLabel`을 카탈로그(`PLANS` in `lib/plan/use-plan.ts`)에서 다시 찾지 않고 영수증에 고정하는 이유는 `docs/be-contract-draft-pair-ignored-sublabel.md`의 `reason` 열거형과 같은 근거다 — 나중에 화면이 그때 가격을 보여줘야 하는데, 카탈로그가 바뀌면 옛 결제도 새 가격으로 보이는 거짓말을 하게 된다.

### `ExportSnapshot`

```ts
/**
 * 특정 결제(PlanReceipt)로 실제 내려받은 리포트 파일의 고정 사본.
 * 사용자가 나중에 재분류·override로 events를 바꿔도 이 스냅샷은 결제 시점 그대로 남는다.
 */
type ExportSnapshot = {
  id: string;
  receiptId: string;                // 이 스냅샷을 연 결제. PlanReceipt.id
  taxYear: number;
  format: "csv" | "xlsx";
  kind: "ledger" | "advisor";        // 직접 신고용(CSV) · 세무사 전달용(XLSX) — export-view.tsx의 두 카드와 대응
  createdAt: string;
  countryCode: string;
  billableEventCount: number;        // 스냅샷 생성 시점 건수(청구 건수와 같아야 하지만 분쟁 대비로 별도 기록)
  /** 재다운로드 경로. 파일 자체를 이 칸에 넣지 않는다 — 목록 응답이 무거워진다. */
  downloadUrl: string;
};
```

**둘 다 `default` 폴백을 두지 않는다.** `pair_id`·`ignored`·`sub_label`은 기존 이벤트 스키마에 칸을 더하는 것이라 버전 스큐 방어가 필요했지만, 이 둘은 **새 리소스**(신규 엔드포인트의 응답)라 그 문제가 없다 — 엔드포인트가 없던 시절의 기존 사용자를 깨뜨릴 기존 페이로드가 없다.

## 3. 엔드포인트 초안

### `GET /api/plan/receipts`

과세연도별 결제 목록. 응답은 `{ items: PlanReceipt[] }`. `status: "refunded"`도 포함한다 — 감춰서 "결제했는데 내역이 없다"는 오해를 만들지 않는다(화면에서 흐리게 표시하는 것은 FE 몫).

```ts
// FE가 usePlan()을 대체할 때의 파생 규칙(제안):
// 활성 플랜 = items 중 status === "active"이고 taxYear가 가장 최근인 것.
// 없으면 plan === null(무료)과 같다.
```

### `GET /api/plan/receipts/{taxYear}/attribution`

**연도 귀속 검증.** 결제 시점 과세기간 경계와 지금 보는 연도의 과세기간 경계를 대조해 `{ valid: boolean, reason?: string }`을 낸다. `exportEventAllowance`의 결측 주석이 요구한 바로 그 계약이다. `valid: false`가 오면 그제서야 화면이 "이 결제는 {taxYear}년 귀속이 아닙니다"처럼 **검증된** 문구로 바꿀 수 있다 — 지금의 "사실만 말하는" 한 줄(§1)은 이 엔드포인트가 생기기 전까지의 임시 조치다.

### `POST /api/export/snapshots`

리포트를 실제로 내려받는 순간 호출한다(현재 `download()` 함수가 브라우저에서 즉석 생성·다운로드하는 지점). 요청: `{ receiptId, taxYear, format, kind, countryCode }`. 응답: 위 `ExportSnapshot`. **파일 생성은 BE 책임으로 옮긴다** — 지금처럼 FE가 `createReportLedgerCsv`/`createReportXlsx`로 매번 즉석 생성하면, 같은 스냅샷을 재다운로드할 때도 그 시점 events로 다시 만들어 스냅샷의 의미(고정된 사본)가 깨진다.

### `GET /api/export/snapshots?taxYear=...`

과거 스냅샷 목록. 없으면(BE 계약 전) 빈 배열로 취급하고 화면은 "지난 내보내기 기록·스냅샷 보관은 아직 제공하지 않습니다"라고 말한다(지금 export-view.tsx의 `plan-payments` 카드 하단 문구).

### `GET /api/export/snapshots/{id}/download`

고정된 파일 그대로 재다운로드.

## 4. 마이그레이션·롤아웃 노트

**순서가 무관하지 않다** — `pair_id`·`ignored`·`sub_label`과 달리 이번 셋은 기존 필드에 얹는 게 아니라 **결제 자체의 원본 소유권**을 FE 로컬 상태에서 BE로 옮기는 일이다.

| 단계 | FE 동작 |
|---|---|
| BE 엔드포인트 없음(지금) | `usePlan()`이 `localStorage`를 원본으로 쓴다. 내보내기 화면은 활성 플랜 1행만 그리고, 연도 귀속은 사실만 말하고 검증하지 않는다 |
| `GET /api/plan/receipts`만 생김 | `usePlan()`을 어댑터로 바꿔 서버 목록의 최신 활성 건을 `Plan`으로 매핑한다. 과세연도별 결제 카드는 여러 행을 그릴 수 있게 된다 |
| `attribution` 엔드포인트까지 생김 | 연도 불일치 문구가 "사실"에서 "검증됨"으로 바뀐다 |
| 스냅샷 엔드포인트까지 생김 | 다운로드 버튼이 BE 생성을 거치고, "지난 내보내기 기록" 섹션이 실데이터를 받는다 |

각 단계에서 **이전 단계로 되돌려도 화면이 깨지지 않아야 한다** — 엔드포인트가 404거나 아직 안 열렸으면 지금의 로컬 전용 동작으로 폴백한다(신고를 막을 이유가 아니다).

**mock 결제와의 관계.** `usePlan()`의 mock 배지·"실제 결제 아님" 문구는 이 계약이 생겨도 결제대행사(PortOne 등) 연동이 별도로 붙기 전까지는 유지된다 — 영수증 스키마가 생기는 것과 실제 청구가 도는 것은 별개다.

## 5. 비범위

| 항목 | 왜 나중인가 |
|---|---|
| 실제 결제대행사(PortOne) 연동 | 이 문서는 영수증·스냅샷의 **모양**만 잡는다. 실제 청구·웹훅·환불 처리는 결제 연동 트랙에서 따로 연다 |
| 환불 상세 흐름(부분 환불, 사유 코드) | `status: "refunded"` 하나로 시작하고, 세분화는 실제 환불 정책이 정해진 뒤에 |
| 스냅샷 파일의 장기 보관 정책(만료·삭제) | 보관 기간·용량 정책은 이 문서 밖의 인프라 결정이다. 스키마에 `expiresAt` 같은 칸을 지금 넣지 않는다 — 쓰지 않을 칸을 계약에 넣으면 양쪽이 의미를 각자 상상한다(같은 원칙을 `be-contract-draft-pair-ignored-sublabel.md` §5가 말한다) |

## 6. BE에 물을 것

| # | 질문 | 왜 답이 필요한가 |
|---|---|---|
| 1 | 과세연도 결제의 원자성 — 한 연도에 동시에 두 결제(예: plus 결제 후 pro로 업그레이드)가 가능한가? | `PlanReceipt` 목록에서 "그 해의 활성 건"을 고르는 규칙이 여기에 달렸다 |
| 2 | `billableEventCountAtPurchase`는 결제 시점 값을 서버가 스냅샷하는가, 아니면 매 조회 시 재계산하는가? | 재계산이면 결제 후 사용자가 거래를 더 받아와도 그 값이 바뀌어 분쟁 근거로서 의미가 흔들린다 |
| 3 | 연도 귀속 검증(§3 `attribution`)의 판정 기준은 무엇인가 — 룰셋의 과세기간 시작·끝인가, 결제 시각의 달력 연도인가? | 한국처럼 과세기간이 달력 연도와 같은 나라도 있지만, 다른 나라 룰셋이 붙으면 갈릴 수 있다 |
| 4 | 스냅샷 파일은 어디에 저장되는가(S3 등) — `downloadUrl`은 만료되는 서명 URL인가, 영구 경로인가? | 프런트가 캐시해도 되는지, 매번 새로 요청해야 하는지가 갈린다 |
| 5 | 재분류·override로 events가 바뀐 뒤 만든 스냅샷과, 그 전에 만든 스냅샷이 같은 결제(`receiptId`)에 여러 개 있을 수 있는가? | 있다면 "과세연도별 결제" 카드가 결제당 스냅샷 여러 개를 목록으로 보여줘야 한다 |
| 6 | 환불(`status: "refunded"`)이 되면 그 결제로 만든 스냅샷 다운로드도 막는가? | 막지 않으면 환불 후에도 신고 근거자료를 계속 쓸 수 있다는 뜻이 되어 정책 결정이 필요하다 |
