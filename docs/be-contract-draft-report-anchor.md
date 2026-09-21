# BE 계약 초안 — 리포트 파일 해시 온체인 등록 (`report-anchor`)

> 상태: **초안**. `feat/export-anchor-gate` 계획(`.omc/plans/export-anchor-gate.md`, rev 4)에서 FE가 정의한 계약이며, BE(NestJS, `VERA-Wallet-BE`)와 합의되기 전까지 실제 구현은 없다. FE는 이 문서의 모양대로 mock 저장소·Route Handler로 OFF 모드 전 흐름을 먼저 완성한다.
> `docs/be-contract-draft-plan-receipts-snapshots.md`·`docs/be-contract-draft-pair-ignored-sublabel.md`와 같은 형식을 따른다.

## 1. 배경과 결정

`components/report/downloads.tsx`의 CSV·XLSX 내려받기 버튼을 "파일을 만들어 그 **바이트의 해시**를 등록하고, 등록이 확정된 뒤에만 내려받는" 하드 게이트로 바꾼다. 등록 대상은 `keccak256(bytes)` 하나뿐이다 — 금액·지갑 주소·파일 내용은 올리지 않는다.

새 계약을 기존 `tax-evidence`(계산 근거 온체인 봉인)에 얹지 않고 `/api/report-anchor`로 독립시켰다. 검토한 대안은 셋이다.

- **A. 새 `report-anchor` 계약 독립 (채택)** — `ReportAnchorProvider`·`/api/report-anchor`·mock 저장소를 `tax-evidence` 3종 세트와 같은 형태로 새로 만들되 타입·경로는 공유하지 않는다.
- **A′. `POST /api/tax-evidence/files` 하위 자원** — 기술적으로 성립한다. `proxy.ts`가 이미 `/api/tax-evidence/*`를 BE 소유로 잡아 allowlist·matcher 변경이 필요 없고, BE도 기존 `TaxEvidence` 모듈에 컨트롤러 하나만 더하면 된다. **그럼에도 고르지 않은 이유**: 두 등록(계산 근거 봉인 / 파일 해시 등록)은 서로 독립이라는 것이 스펙의 명시적 결론인데, 파일 등록을 계산 근거의 하위 자원으로 두면 URL 위계가 그 독립성과 반대로 말한다. `/api/tax-evidence/{merkleRoot}`와 `/api/tax-evidence/files/{fileHash}`가 같은 세그먼트 자리를 두고 경쟁하는 것도 BE 라우터에 암묵 가정("`files`라는 머클루트는 없다")을 지운다.
- **C. 파일 해시를 머클트리의 잎으로** — 순환이라 성립하지 않는다. 파일 내용이 estimate에서 나오고 estimate가 머클루트를 낳는데, 그 루트를 다시 파일에 넣을 수 없다. 멱등도 사라진다(파일을 두 번 만들면 루트가 같아 새 등록이 안 된다).

A를 고른 근거는 (1) 두 등록의 독립성을 URL이 정직하게 말해야 한다 (2) 기존 `/export/basis` 근거 카드·BE `TaxEvidence` 모듈·공유 벡터(`tests/fixtures/evidence-vector.json`)가 무변경으로 남는다 (3) BE가 `TaxEvidence` 디렉터리를 복사해 키만 바꾸는 작업으로 구현할 수 있다는 것이다. 비용은 `proxy.ts` allowlist·matcher 항목과 구성 루트 한 줄이며, 형태가 `tax-evidence`와 겹치는 만큼 구현 비용은 낮다.

## 2. 스키마

### `ReportAnchorInput` (등록 요청)

BE·온체인으로 나가는 것은 이 7개 필드뿐이다.

```ts
type ReportAnchorKind = "csv" | "xlsx";
type ReportAnchorAlgorithm = "keccak256" | "sha256"; // 지금 FE가 내는 값은 keccak256뿐. 컨트랙트 요구가 바뀔 때를 위해 태그로 싣는다.

type ReportAnchorInput = {
  version: 1;
  algorithm: ReportAnchorAlgorithm;
  fileHash: string;       // 0x + 64 hex(32바이트 다이제스트)
  kind: ReportAnchorKind;
  countryCode: string;
  taxYear: number;
  byteLength: number;
};
```

### `ReportAnchorRecord` (등록 기록)

필드명은 `EvidenceRecord`(`lib/ports/tax-evidence.ts:4`)와 맞췄다 — BE와 화면이 두 계약을 같은 모양으로 다루게 하려는 것이다. 값은 전부 서버가 확정한 사실이며 FE는 지어내지 않는다.

```ts
type ReportAnchorRecord = {
  fileHash: string;
  algorithm: ReportAnchorAlgorithm;
  kind: ReportAnchorKind;
  countryCode: string;
  taxYear: number;
  byteLength: number;
  recordedAt: string;              // ISO-8601 UTC, 밀리초 포함 `Z`
  anchorStatus: string;            // pending | anchored | failed — §4 참조. literal union으로 굳히지 않는다(EvidenceRecord와 같은 이유 — BE가 전이 상태를 하나 더 만드는 순간 전 요청이 계약 위반으로 거절되면 안 된다)
  attempt: number;                 // 몇 번째 시도인가. 첫 등록이 1. 재제출마다 오른다
  txHash: string | null;
  blockNumber: string | null;
  anchoredAt: string | null;
  explorerUrl: string | null;      // OmniOne 스테이지에는 블록 탐색기가 없다 — null이 정상(tax-evidence.ts:28과 같은 사실)
  failureReason: string | null;    // 마지막 실패 사유. pending으로 되돌아간 뒤에도 남는다(재시도 중에도 "왜 한 번 실패했는지"는 사실이다)
  lastFailureAt: string | null;
};
```

합성 샘플(실제 값 아님, 형태만 참고):

```json
{
  "fileHash": "0x4a1f...c9", "algorithm": "keccak256", "kind": "csv",
  "countryCode": "KR", "taxYear": 2027, "byteLength": 48213,
  "recordedAt": "2027-05-01T00:00:00.000Z",
  "anchorStatus": "anchored", "attempt": 1,
  "txHash": "0x9be3...07", "blockNumber": "1284",
  "anchoredAt": "2027-05-01T00:00:01.200Z",
  "explorerUrl": null, "failureReason": null, "lastFailureAt": null
}
```

## 3. 엔드포인트

| 메서드·경로 | 설명 |
|---|---|
| `POST /api/report-anchor` | 해시를 등록한다. body는 `ReportAnchorInput` 그대로. 응답은 `ReportAnchorRecord`. |
| `GET /api/report-anchor/{fileHash}?kind=&countryCode=&taxYear=` | 그 키의 **내** 기록을 조회한다. 세 쿼리 파라미터는 **전부 필수**다 — §6의 이유로 기본값을 두면 다른 레코드를 조용히 집어 온다. |
| `GET /api/report-anchor/{fileHash}/chain` (예약, 이번 범위 밖) | `EvidenceChainCheck`와 같은 모양. 파일을 올려 체인과 직접 대조하는 검증 화면이 생기면 이 경로에 붙인다. 지금은 경로만 예약하고 구현하지 않는다. |

## 4. 상태 전이

```
            POST 등록                     내부 재시도/사용자 재제출
pending  ────────────────▶ anchored (종착)
   │
   └──────────────────────▶ failed ────────────────────▶ pending (새 시도, attempt++)
```

- `anchored`만 **종착**이다. `failed`는 종착이 아니다 — 같은 키로 다시 `POST`하면 새 시도가 열린다(`attempt++`, `pending`으로 되돌림). 실패를 종착으로 두면 사용자는 같은 파일을 영원히 못 받는다.
- BE 내부 재시도(가스 부족 등으로 체인 제출을 스스로 다시 시도하는 것)와 사용자 재제출(FE가 같은 키로 다시 `POST`하는 것)은 별개 트리거이며, **둘 다 `attempt`를 올린다** — 화면이 "N번째 시도"를 말할 수 있고 BE 로그와 맞춰볼 수 있다.
- 같은 키가 `anchored`면 새 트랜잭션 없이 그 기록을 그대로 돌려준다(멱등). `pending`이면 진행 중인 시도를 그대로 돌려준다(중복 트랜잭션 금지).

## 5. 기록 소유

레코드는 **세션 사용자 범위**다.

- `GET`은 내 기록만 답한다. 남의 해시로 조회하면 `404`다 — 다른 응답을 주면 이 엔드포인트가 "그 파일이 세상에 존재하는가"를 묻는 오라클이 된다.
- 같은 파일을 두 사용자가 각각 등록하면 레코드는 **둘**이다. 그 둘이 체인 트랜잭션을 공유할지(해시가 이미 체인에 있으면 재사용)는 **BE 재량**이다. 재사용하더라도 두 레코드가 같은 `txHash`를 들고 있으면 계약상 문제가 없다 — FE는 `txHash`가 다른 레코드 사이에서 유일하다고 가정하지 않는다.

## 6. 레코드 키는 복합이다

레코드 키는 `(사용자, fileHash, kind, countryCode, taxYear)`다. **`fileHash` 하나로 키를 잡으면 안 된다.**

이유: `buildLedgerDetail`은 귀속연도를 `estimate?.taxYear ?? ""`로 쓴다(`lib/export/report.ts:328`). estimate가 없으면 빈 문자열이다. 그리고 `lib/export/report.ts` 전체에 `countryCode`가 0회 등장한다 — 국가가 파일에 나타나는 유일한 자리는 XLSX 요약 시트의 `estimate.countryLabel`인데, estimate가 null이면 그 시트 자체가 빈다. **즉 estimate가 없는 기간(빈 지갑·계산 실패)에서는 CSV도 XLSX도 국가·연도와 무관하게 같은 바이트를 낸다.** 2027년 한국 빈 기간과 2028년 독일 빈 기간의 파일이 글자 하나까지 같다.

해시만으로 키를 잡으면 두 번째 등록이 첫 번째의 메타를 가진 레코드로 흡수된다. 그래서 **같은 해시가 다른 메타(kind·countryCode·taxYear)로 오는 것은 충돌이 아니라 별개 레코드다.** 앞선 초안에 있던 `409 anchor_metadata_conflict`는 이 이유로 삭제했다 — 전제("해시가 같으면 메타도 같아야 한다")가 실제로 도달 가능한 경로(빈 기간의 내려받기, `tests/ui/export-empty-period.test.tsx`가 이미 다루는 경로)에서 정상 사용자를 막았다.

**온체인 페이로드는 여전히 `keccak256(bytes)` 하나다.** 복합 키는 저장소의 레코드 식별자일 뿐 체인에 올리는 값이 아니다. 같은 해시가 두 레코드로 존재할 때 체인 트랜잭션을 재사용할지는 §5와 같은 이유로 BE 재량이다.

멱등 판정도 이 다섯 값 전부로 한다(§4의 `pending`/`anchored`/`failed` 분기 판정 기준).

## 7. 오류 코드

### `POST /api/report-anchor` — 400

| 조건 | 메시지 |
|---|---|
| body가 JSON이 아님 | "Body must be JSON." |
| `version !== 1` | "version must be 1." |
| `algorithm`이 `keccak256`/`sha256`이 아님 | — |
| `fileHash`가 `/^0x[0-9a-f]{64}$/i`에 안 맞음 | "fileHash must be a 32-byte hex digest." |
| `kind`가 `csv`/`xlsx`가 아님 | — |
| `countryCode` 빈 값 / `taxYear` 비정수 / `byteLength` 음수·비정수 | — |

앞선 초안에 있던 검증 둘을 **의도적으로 삭제했다** — 계약에 도달 불가능한 검증이나 정상 사용자를 막는 검증을 적으면 BE가 그 코드를 그대로 구현하게 된다.

- "같은 해시인데 `byteLength`가 다르면 400" — `keccak256`이 바이트 전체를 덮으므로 해시 충돌을 전제해야만 성립하는, 도달 불가능한 분기다.
- "같은 해시에 다른 메타면 409 `anchor_metadata_conflict`" — §6에서 설명한 대로 전제가 틀렸다. 해시가 같고 메타가 다른 것은 별개 레코드이지 충돌이 아니다.

### `GET /api/report-anchor/{fileHash}` — 400

`kind`·`countryCode`·`taxYear` 세 쿼리 파라미터는 **원본 문자열 기준으로** 검증한다. `Number(query.get("taxYear"))`처럼 먼저 숫자로 바꾸면 파라미터가 빠졌을 때(`null`)나 빈 문자열일 때 그 변환값이 `0`이 되어 `Number.isInteger` 검사를 통과해 버린다(raw-string guard). 그러면 "연도를 안 보낸 조회"가 조용히 `taxYear: 0`인 다른 레코드를 집어 오거나, 있는 레코드에 대해 잘못된 404를 낸다.

| 조건 | 메시지 |
|---|---|
| `kind`가 `csv`/`xlsx`가 아님(원본 문자열 그대로 비교) | "kind, countryCode and taxYear are required." |
| `countryCode` 원본 문자열이 빈 값이거나 없음 | 〃 |
| `taxYear` 원본 문자열이 없거나 `/^\d{4}$/`에 안 맞음(선先 숫자 변환 금지) | 〃 |

### 공통

| 상태 | 코드 | 조건 |
|---|---|---|
| 401 | `unauthorized` | 세션 없음 |
| 404 | `not_found` | `GET`이 내 기록이 아니거나 없는 키를 조회 |
| 502 | `upstream_unavailable` | 체인 노드 장애 |

**`409`는 없다.** §6에서 설명한 이유로, 해시가 같고 메타가 다른 상황은 충돌이 아니라 별개 레코드이므로 충돌을 알리는 상태 코드 자체가 필요 없다.

## 8. 온체인에 올라가는 것

`bytes32 fileHash` 하나뿐이다 — `keccak256(bytes)`. 국가·연도·종류·바이트 길이 등 나머지 메타는 BE 저장소에만 있고 체인에는 올리지 않는다.

## 9. FE가 지키는 계약

- **결정적 파일 생성.** 같은 estimate·같은 종류면 언제 만들어도 같은 바이트가 나와야 한다. CSV는 BOM + CRLF + 고정 열 순서로 인코딩하고, XLSX는 `Workbook.Props`를 세우지 않는다 — 세우는 순간 생성 시각이 파일에 박혀 해시가 매번 달라진다. FE는 이 불변식을 체크인된 digest fixture(`tests/fixtures/report-file-digest.json`)로 고정해 라이브러리 업그레이드나 열 변경이 만드는 드리프트를 잡는다.
- **해시 알고리즘은 `keccak256`.** 나가는 바이트가 해시한 바이트다 — 파일을 두 번 만들지 않고, `buildReportFile()`이 만든 바이트를 그대로 해시하고 그대로 내려받기에 넘긴다.
- **폴링은 1.5초 간격, 상한 60초.** `pending` 상태에서 화면은 1.5초마다 `GET`으로 재확인하고, 60초를 넘기면 클라이언트가 스스로 `failed`로 전환한다(재시도는 사용자의 재제출로 연다). BE가 그보다 오래 걸리는 경우를 상수화할 계획이면 이 값을 먼저 상의한다.
- FE는 체인에 쓰지 않는다. 서명·가스는 BE 서비스 키가 맡는다.

## 10. 롤아웃

게이트는 서버 env `REPORT_ANCHOR_GATE`로 되돌릴 수 있다.

- 값이 `"off"`면 게이트가 해제된다. 내려받기가 해시·등록·폴링 없이 예전처럼 즉시 저장된다.
- 그 외(미설정 포함)는 **on**이다. 기본이 on인 이유는 fail-closed다 — env 오타로 게이트가 조용히 풀리면 안 된다.
- **BE가 이 계약을 구현하기 전에 ON 모드(`VERAWALLET_BACKEND_ORIGIN` 설정)로 배포하면, 등록이 항상 실패해 내려받기가 전부 막힌다.** 그것이 하드 게이트의 정의이며, 기본값을 뒤집어 그 사실을 감추지 않는다. BE 구현 전 ON 모드 배포(스테이징·시연 포함)는 `REPORT_ANCHOR_GATE=off`를 **반드시** 넣는다. `.env.example`의 `REPORT_ANCHOR_GATE` 항목과 `README.md`의 "알려진 모드 차이"가 같은 경고를 적어 둔다.
- CI의 `.github/workflows/ci.yml`(E2E step)·`playwright.config.ts`(`webServer.env`)에도 `REPORT_ANCHOR_GATE: "off"`가 들어가 있다 — BE가 이 계약을 구현하기 전까지 ON 모드 e2e(`g002-cutover-redteam.spec.ts`·`g003-dashboard-export.spec.ts`의 다운로드 케이스)가 등록 실패로 타임아웃하기 때문이다. **이 두 줄은 부채다.** BE가 `/api/report-anchor`를 구현하면 함께 지우고, 두 e2e 스펙이 게이트가 켜진 상태로 통과하는지 확인한다.

> **YAML 참고**: `REPORT_ANCHOR_GATE`처럼 `off`/`on`/`yes`/`no` 같은 값을 GitHub Actions YAML의 `env:`에 쓸 때는 반드시 따옴표로 감싼다. 따옴표 없는 `off`는 YAML 1.1 boolean 리터럴이라 파서가 `false`로 읽고, Actions가 그것을 env 값으로 직렬화하면서 문자열 `"false"`를 넘긴다. `reportAnchorGateEnabled()`의 `!== "off"` 비교는 그 값을 참으로 읽어 **게이트가 켜진 채로 e2e가 돈다** — 끄려고 넣은 줄이 정확히 반대로 작동하고, 증상은 "다운로드 타임아웃"이라 원인을 스위치에서 찾기 어렵다.
