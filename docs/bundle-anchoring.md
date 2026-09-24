# 리포트 한 벌 온체인 등록 — 묶음 문서

내려받기(CSV·XLSX)를 누르면 계산 근거와 두 파일의 해시를 **한 루트**로 묶어 기존 `tax-evidence`
계약에 올린다. 독립된 `report-anchor` 계약(파일마다 따로 등록)은 걷어냈다 — 이 문서가 그 자리를
대신한다. 배경·조사 근거는 `.omc/plans/export-anchor-gate.md`(§1·§11 ADR)에 있다.

## 왜 BE 무변경인가

BE(`VERA-Wallet-BE`, `evidence` 모듈)는 잎의 **종류**를 검사하지 않는다.

- `RecordEvidenceDto.leaves`는 `Record<string, unknown>[]`이고 `@ArrayMinSize(1)`만 건다.
- 서비스는 `leaves[0].kind === "header"`와 헤더의 `country`·`taxYear`만 확인하고, 나머지 잎은
  그대로 `merkleRoot(dto.leaves)`에 넣는다.
- 루트는 서버가 다시 계산해 FE가 보낸 값과 대조한다. FE·BE가 같은 머클 규칙을 쓰면 통과한다.
- `EVIDENCE_MAX_LEAVES = 50_000` — 잎 2개를 더 보내는 것은 한도에 무의미하다.

그래서 FE는 계산 근거 잎 뒤에 파일 잎 두 개를 덧붙여 보내는 것만으로 파일 해시를 같은 루트 안에
봉인할 수 있다. 새 모듈·새 엔드포인트·새 컨트랙트가 필요 없다.

## 잎 스키마

`lib/tax/evidence.ts`의 `EvidenceLeaf` 유니온에 `EvidenceFileLeaf`가 추가됐다.

```ts
export type EvidenceFileLeaf = {
  kind: "file";
  /** 어떤 내려받기인가. 화면의 두 행(직접 신고용·세무사 전달용)과 1:1이다. */
  file: "csv" | "xlsx";
  algorithm: "keccak256";
  hash: string;
  byteLength: number;
};
```

`byteLength`는 정수라 `canonicalJson`의 "수는 정수만" 규칙에 그대로 맞는다.

## 잎 순서

`lib/export/report-bundle.ts`의 `buildReportBundle(estimate, events)`가 문서를 만든다. 잎 순서는

```
[header, ...judgments, file:csv, file:xlsx]
```

로 **고정**이다. 머클루트는 순서에 의존하고 BE는 받은 배열 그대로 다시 계산하므로, 두 구현이
같은 순서를 내야 한다. 파일 잎을 판정 뒤에 두는 이유는 헤더가 0번이어야 한다는 BE 계약
(`leaves[0].kind === "header"`)을 지키면서, 기존 `buildEvidenceDocument`의 잎 배열을 그대로 앞에
두어 계산 근거 부분의 루트 규칙을 한 글자도 건드리지 않기 위해서다. 판정 잎 정렬
(`compareJudgmentLeaves`)은 그대로이고, 파일 잎은 정렬에 참여하지 않는다.

`version`은 1 그대로다 — 잎 종류가 느는 것은 문서 구조의 확장이지 규칙 변경이 아니고, BE는
`@IsIn([1])`로 1만 받는다.

파일 바이트는 `lib/export/report-hash.ts`의 `buildReportFile(kind, events, estimate)`가 만든다.
해시한 바이트와 저장할 바이트가 같은 것이 원칙이다 — `buildReportBundle`이 그 `ReportFile`을
함께 돌려주므로 훅은 같은 바이트를 해시에도, 저장에도 쓴다.

## 루트 규칙이 바뀌었다는 것

파일 잎이 늘어난 만큼, 같은 계산이라도 `buildReportBundle`의 루트는 `buildEvidenceDocument`
단독의 루트와 **다르다**. 이미 등록돼 있던 (파일 잎 없는) 기존 기록은 자동으로 stale 취급되고,
다음 내려받기가 새 루트로 새로 등록한다. 공유 벡터 `tests/fixtures/evidence-vector.json`은
`buildEvidenceDocument`만 쓰므로 영향이 없다. 묶음 루트는 별도 고정 벡터
(`tests/fixtures/report-bundle-vector.json`)로 회귀를 잡는다.

## 조회는 루트 기준이다 — `latest()`로 폴링하면 안 된다

등록 확인·폴링은 반드시 `taxEvidenceProvider.document(root)`(`GET /api/tax-evidence/{root}`)를
쓴다. `latest(country, taxYear)`는 그 해의 **최신 1건**을 주는데, BE `save`는 같은
`(userId, merkleRoot)`면 기존 기록을 그대로 돌려주고 `createdAt`을 갱신하지 않는다. 계산을
고쳤다 되돌리는 것만으로 `latest()`가 실제 등록 상태와 다른 루트를 계속 가리킬 수 있고, 그러면
폴링이 영원히 "내 루트와 다르다"만 보다가 타임아웃한다. `document(root)`는 정확히 그 루트를
집으므로 이 함정이 없다.

`latest()`는 복원 화면의 "최근 등록" 표시(루트를 대조하지 않은, 참고용 한 줄)에만 쓴다.

## 폴링 일정과 유예 창

- 간격은 `POLL_INTERVALS_MS = [1500, 3000, 5000]`(마지막 값 반복), 60초 예산.
  `document(root)`는 잎 전체를 실어 오므로 간격을 점증시켜 요청 수를 줄인다.
- `FAILED_GRACE_MS = 5000` — 등록(`record()`) 직후 이 시간 안에 본 `failed`는 "아직 옛 라벨"로
  보고 계속 기다린다. BE에서 `failed`는 `attempts >= 5` 뒤에 붙는 라벨이고, 재POST는 큐에 다시
  넣을 뿐 라벨을 즉시 되돌리지 않기 때문이다. 유예가 지난 뒤의 `failed`이거나 60초 예산을
  넘기면 실패로 처리한다.

## 남는 한계

- **`EvidenceView`에 `attempt`·`failureReason`이 없다.** 화면이 지어낼 수 없으므로 실패 사유는
  고정 문구("체인에 등록하지 못했어요. 다시 시도하면 새로 등록해요.")를 쓴다.
- **앵커 라벨이 `"rule_version"`으로 하드코딩돼 있다.** 체인에는 파일 해시를 포함한 루트가 이
  라벨로 올라간다. `anchorType` 라벨링(`"report_bundle"`)은 이번 범위 밖이다.
- PDF 보고서(`/export/report`)는 인쇄라 바이트가 없어 등록 대상이 아니다.

## 게이트 스위치

`REPORT_ANCHOR_GATE`(기본 on, fail-closed) — 변수 이름은 파일별 등록 시절 그대로 유지한다.
끄면 CSV·XLSX 내려받기가 해시·등록·폴링 없이 즉시 저장된다. BE `origin/main`이 이미
tax-evidence를 구현하고 있어 ON도 시도해 볼 수 있지만, CI는 아직 이 레인을 정기 검증하지
않으므로 배포에는 `off`를 유지한다.
