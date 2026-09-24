# Open DID 리포트 VC 계약 (제안)

> 상태: **BE 담당자와 조율할 제안 계약**이다. FE(`lib/report-vc/*`, `components/report-vc/*`)는 이 문서에 맞춰 타입과 클라이언트를 먼저 구현했고, BE(NestJS `VERA-Wallet-BE`), DB, Open DID Issuer/Verifier, 체인 검증은 아직 구현 전이다. 경로·필드·오류 코드는 BE 구현 과정에서 바뀔 수 있으며, 바뀌면 이 문서와 `lib/report-vc/types.ts`를 함께 고친다.
>
> 이 문서의 기존 계약 참조: 로그인 흐름은 `lib/opendid/client.ts`(`/api/auth/did/offer`, `/api/auth/did/present`), 계산 근거는 `lib/adapters/http/tax-evidence.http.ts`(`/api/tax-evidence`), 프록시는 `proxy.ts`.

## 0. 한눈에 보기

```
CX 로그인(기존)  →  증명서 지갑 연결  →  추정 세금 리포트 증명서(VC) 발급  →  제3자 검증 페이지에서 VP 제출·검증
   vw_access_token      /api/report-vc/wallet/*       /api/report-vc/issuances/*          /api/report-vc/verifications/*
```

| 구분 | 경로 | 메서드 | 인증 | 브라우저 바인딩 쿠키 |
|---|---|---|---|---|
| 기능 지원 여부 | `/api/report-vc/capabilities` | GET | 없음 | 없음 |
| 지갑 연결 상태 | `/api/report-vc/wallet` | GET | CX 세션 | 없음 |
| 지갑 연결 시도 생성 | `/api/report-vc/wallet/link-attempts` | POST | CX 세션 | `vw_vc_link_attempt` 발급 |
| 지갑 연결 시도 조회 | `/api/report-vc/wallet/link-attempts/{attemptId}` | GET | CX 세션 | `vw_vc_link_attempt` 필수 |
| 지갑 연결 시도 취소 | `/api/report-vc/wallet/link-attempts/{attemptId}/cancel` | POST | CX 세션 | `vw_vc_link_attempt` 필수 |
| 지갑 연결 해제 | `/api/report-vc/wallet` | DELETE | CX 세션 | 없음 |
| 근거별 발급 가능 상태 | `/api/report-vc/evidence/{evidenceId}/issuance` | GET | CX 세션 | 없음 |
| 발급 요청 | `/api/report-vc/issuances` | POST | CX 세션 | `vw_vc_issue_attempt` 발급 |
| 발급 상태 조회 | `/api/report-vc/issuances/{issuanceId}` | GET | CX 세션 | `vw_vc_issue_attempt` 필수 |
| 발급 취소 | `/api/report-vc/issuances/{issuanceId}/cancel` | POST | CX 세션 | `vw_vc_issue_attempt` 필수 |
| 공개 검증 시도 생성 | `/api/report-vc/verifications` | POST | 없음 | `vw_vc_verify_attempt` 발급 |
| 공개 검증 시도 조회 | `/api/report-vc/verifications/{verificationId}` | GET | 없음 | `vw_vc_verify_attempt` 필수 |
| 공개 검증 시도 취소 | `/api/report-vc/verifications/{verificationId}/cancel` | POST | 없음 | `vw_vc_verify_attempt` 필수 |
| 제출 파일 검증 | `/api/report-vc/verifications/{verificationId}/file-checks` | POST | 없음 | `vw_vc_verify_attempt` 필수 |

모든 경로는 FE same-origin 프록시(`proxy.ts`)를 거쳐 BE로 rewrite된다. 브라우저는 Issuer/Verifier 관리 API를 직접 호출하지 않는다.

## 1. 공통 규칙

### 1.1 응답 봉투

기존과 같다(`lib/http/envelope.ts`, `lib/http/error-codec.ts`).

```ts
// 성공
{ data: T, meta: { provenance: "mock" | "live", generatedAt: string } }
// 실패
{ error: { code: string, message: string, details?: unknown } }
```

- `meta.provenance`가 `"mock"`이면 FE는 그 응답을 **실제 검증·실제 발급으로 표시하지 않는다.** 화면에는 `mock 데이터` 출처 칩이 붙고, 검증 결과 머리글에 "실제 검증 아님"을 함께 적는다.
- 오류 응답이 봉투 형태가 아니면(예: Next 404 HTML, BE 미배포 501) FE는 `feature_unavailable`로 번역해 "기능 준비 중"으로 보인다. API 오류를 mock 성공으로 바꾸지 않는다.

### 1.2 인증과 쿠키

- "CX 세션"은 기존 로그인이 발급한 `vw_access_token`(HttpOnly)이다. 프록시가 이 쿠키 하나만 BE로 실어 보낸다.
- 이 기능은 **새 로그인 JWT를 발급하지 않고 현재 계정을 바꾸지 않는다.** BE는 지갑 연결 시 사용자 레코드에 DID를 붙일 뿐이다.
- 세션 만료·부재는 `401 { error: { code: "unauthorized" } }`다. FE는 진행 중인 폴링을 멈추고 "다시 로그인" 안내를 띄운다.

### 1.3 브라우저 바인딩 쿠키

시도(attempt)마다 BE가 HttpOnly 쿠키를 발급하고, 그 시도의 조회·취소·파일 검증은 **같은 쿠키를 가진 브라우저에서만** 허용한다. `attemptId`만 아는 다른 브라우저는 결과를 볼 수 없다(`403 attempt_not_bound`).

| 쿠키 | 발급 시점 | 형식 | 속성 |
|---|---|---|---|
| `vw_vc_link_attempt` | 지갑 연결 시도 생성 | `^[a-f0-9]{64}$` | HttpOnly; SameSite=Lax; Path=/api/report-vc/wallet; Max-Age=만료까지 |
| `vw_vc_issue_attempt` | 발급 요청 | `^[a-f0-9]{64}$` | HttpOnly; SameSite=Lax; Path=/api/report-vc/issuances; Max-Age=만료까지 |
| `vw_vc_verify_attempt` | 공개 검증 시도 생성 | `^[a-f0-9]{64}$` | HttpOnly; SameSite=Lax; Path=/api/report-vc/verifications; Max-Age=만료까지 |

- 지갑 연결 시도와 발급은 CX 계정에도 결합된다. BE는 `(userId, attemptId, 바인딩 쿠키)` 세 값이 모두 맞을 때만 상태를 돌려준다.
- 값은 시도 식별자와 다른 무작위 비밀이어야 한다(`attemptId`에서 유도하지 않는다).
- 프록시는 `/api/report-vc/` 아래 경로에서만 위 세 쿠키를 BE로 전달하고, 형식이 맞지 않는 값은 버린다(`proxy.ts`, `tests/unit/report-vc-proxy.test.ts`).

### 1.4 Origin과 CSRF

- 프록시는 `/api/report-vc/` 경로에서 브라우저의 `Origin` 헤더를 그대로 전달한다(로그인 경로와 같은 방식). BE는 상태를 바꾸는 요청(POST/DELETE)에서 `Origin`이 허용 목록(FE 공개 origin)과 다르면 `403 origin_rejected`로 거절한다.
- 모든 POST/DELETE는 `content-type: application/json`이다. 폼 인코딩은 받지 않는다(단순 요청 CSRF 차단).
- 공개 검증 경로는 로그인 쿠키가 없어도 되지만 `Origin` 검사와 바인딩 쿠키 검사는 그대로 적용한다.

### 1.5 캐시

- 모든 응답은 `Cache-Control: no-store`다. FE도 `cache: "no-store"`로 요청한다. DID·QR·검증 결과는 브라우저 캐시나 React Query 캐시에 넣지 않는다.

### 1.6 멱등성과 재시도

- `POST /api/report-vc/issuances`는 `Idempotency-Key` 헤더(UUID)를 **필수**로 받는다. 같은 사용자가 같은 키로 다시 보내면 기존 발급을 그대로 돌려준다(24시간). FE는 사용자의 "발급 요청" 한 번에 키 하나를 만들고, 네트워크 실패로 응답을 못 받은 재전송에는 같은 키를 쓴다. 만료·실패 뒤 "다시 시도"는 새 키다.
- `POST /api/report-vc/wallet/link-attempts`, `POST /api/report-vc/verifications`도 같은 헤더를 **선택**으로 받는다.
- 취소·해제는 멱등이다. 이미 끝난 시도를 취소하면 `204`다.
- 상태 조회는 읽기 전용이라 재시도해도 부작용이 없다. `429`·`503`에는 `Retry-After`(초)를 실어 보내고 FE는 그 값을 따른다(최대 60초).

### 1.7 폴링 규칙(FE)

- 시도 생성 응답의 `pollAfterMs`(1000~60000) 뒤 첫 조회를 시작하고, 이후는 응답의 `retryAfterMs`를 따른다.
- 종료 조건: 종결 상태 도착, `expiresAt` 경과(로컬 시계 기준으로도 멈춘다), 사용자 취소, 화면 이탈, `401`, 종결 오류(`410`, `409`, `403`, `4xx`), 연속 조회 상한(120회). 상한을 넘기면 "시간 안에 확인하지 못했습니다"로 끝낸다. 무한 폴링하지 않는다.
- `429`·`503`은 종결이 아니다. `Retry-After` 뒤 다시 묻는다.
- 시도마다 세대 번호를 붙여, 이전 시도의 늦은 응답이 새 시도 화면을 덮어쓰지 않게 한다.

## 2. 기능 지원 여부

### `GET /api/report-vc/capabilities`

인증 없음. FE는 설정 화면과 근거 화면, 공개 검증 페이지가 열릴 때 한 번 묻는다.

```ts
type ReportVcCapabilities = {
  enabled: boolean;                       // false면 모든 화면이 "기능 준비 중"
  walletLink: boolean;
  issuance: boolean;
  verification: boolean;
  /** 실제로 지원하는 공개 범위. 화면의 선택지는 이 목록으로 제한한다. */
  disclosures: ("basic" | "with_amounts")[];
  /** 파일 검증을 지원하는 형식. PDF는 브라우저 인쇄물이라 바이트가 없으므로 지원 목록에 들어가지 않는다. */
  fileFormats: ("csv" | "xlsx")[];
};
```

| 상태 | 응답 |
|---|---|
| 지원 | `200 { data: ReportVcCapabilities }` |
| BE 미배포 | 봉투가 아닌 404/501 → FE `feature_unavailable` |

## 3. 증명서 지갑 연결

암호화폐 지갑(SIWE)과 다른 **Open DID 증명서 지갑**이다. 사용자 레코드당 DID 하나를 연결한다.

### `GET /api/report-vc/wallet`

```ts
type WalletLinkState =
  | { status: "unlinked" }
  | { status: "linked"; did: string; linkedAt: string; walletName?: string };
```

| 코드 | 의미 |
|---|---|
| 200 | 위 상태 |
| 401 `unauthorized` | 세션 없음/만료 |

### `POST /api/report-vc/wallet/link-attempts`

요청 본문은 `{}`다(사용자 신원은 세션이 정한다). 응답에 `Set-Cookie: vw_vc_link_attempt`가 실린다.

```ts
type LinkAttempt = {
  attemptId: string;
  /** QR로 그릴 문자열. Open DID 지갑이 읽는 봉투(payloadType 등)는 BE가 완성한다. FE는 그대로 그린다. */
  qr: { text: string };
  expiresAt: string;      // RFC3339, 생성 후 3분 권장
  pollAfterMs: number;    // 1000~60000
};
```

| 코드 | 의미 |
|---|---|
| 201 | 시도 생성 |
| 401 `unauthorized` | 세션 없음/만료 |
| 409 `wallet_already_linked` | 이미 연결된 계정. 해제 뒤 다시 연결해야 한다 |
| 429 `rate_limited` | `Retry-After` |
| 503 `verifier_unavailable` | Open DID Verifier/Issuer 연결 실패. `Retry-After` |

지갑 측 흐름: 사용자가 폰의 Open DID 지갑으로 QR을 스캔하고 PIN/BIO로 DID 소유 증명(VP)을 제출한다. BE Verifier가 검증한 뒤 사용자 레코드에 DID를 붙인다. **QR 문자열을 입력하거나 화면에 그린 것만으로 연결 성공이 되지 않는다.** 성공은 아래 상태 조회가 `linked`를 돌려줄 때만이다.

### `GET /api/report-vc/wallet/link-attempts/{attemptId}`

```ts
type LinkAttemptStatus =
  | { status: "pending"; retryAfterMs: number }                           // HTTP 202
  | { status: "linked"; did: string; linkedAt: string; walletName?: string } // HTTP 200
```

| 코드 | 의미 | FE 처리 |
|---|---|---|
| 202 `pending` | 아직 제출 없음 | 계속 폴링 |
| 200 `linked` | 연결 완료 | 종결(성공) |
| 401 `unauthorized` | 세션 만료 | 종결, 재로그인 안내 |
| 403 `attempt_not_bound` | 바인딩 쿠키 불일치 | 종결(실패) |
| 404 `attempt_not_found` | 없는 시도 | 종결(실패) |
| 409 `attempt_cancelled` | 취소된 시도 | 종결(취소) |
| 409 `did_linked_to_other_account` | 그 DID는 다른 계정에 연결돼 있다 | 종결(실패), 문구 그대로 안내 |
| 409 `presentation_rejected` | Verifier가 VP를 거절 | 종결(실패) |
| 410 `attempt_expired` | 만료 | 종결(만료), 새 QR 안내 |
| 429/503 | 일시 오류 | `Retry-After` 뒤 재시도 |

### `POST /api/report-vc/wallet/link-attempts/{attemptId}/cancel`

`204`. 멱등.

### `DELETE /api/report-vc/wallet`

`204`. 멱등. 사용자 레코드의 DID 연결만 지운다. **이미 발급된 VC의 폐기 여부는 이 API가 정하지 않는다.** FE 문구도 "해제하면 이미 받은 증명서가 폐기된다"고 말하지 않는다. VC 폐기 정책은 BE·Issuer 쪽에서 별도로 정한다(열린 질문 §8).

## 4. 추정 세금 리포트 증명서 발급

### 4.1 근거 식별자

발급 대상은 이미 체인에 기록된 계산 근거(`/api/tax-evidence`)다. 현재 BE `evidence` 모듈은 기록을 `(userId, merkleRoot)`로 식별하므로, 이 계약의 `evidenceId`는 **그 기록의 `merkleRoot` 문자열을 조회 키로** 쓴다. 중요한 것은 역할이다.

- FE는 `evidenceId`를 **식별자로만** 보낸다. BE는 DB에서 `(userId, evidenceId)`로 기록을 찾고, **저장된 잎·루트·귀속연도·금액**으로 VC를 만든다. 요청에 실린 값은 검증 대상이지 권위 있는 값이 아니다.
- FE가 계산한 금액·DID·머클 루트는 발급 요청 본문에 넣지 않는다. 지갑 DID는 세션의 사용자 레코드에서, 금액은 기록의 헤더 잎에서 BE가 읽는다.

### `GET /api/report-vc/evidence/{evidenceId}/issuance`

발급 가능 상태와 가장 최근 발급 한 건.

```ts
type IssuanceEligibility =
  | "ready"               // 발급 요청 가능
  | "wallet_unlinked"     // 증명서 지갑 미연결
  | "anchor_pending"      // 체인 기록 대기
  | "anchor_failed"       // 체인 기록 실패
  | "anchor_missing"      // 기록 없음(내 기록이 아니거나 삭제)
  | "disabled";           // 기능 꺼짐

type IssuanceView = {
  issuanceId: string;
  status: "offer_ready" | "issuing" | "issued" | "expired" | "failed" | "cancelled";
  createdAt: string;
  expiresAt: string;
  issuedAt?: string;
  /** 발급된 VC 식별자. VC 원문은 내려주지 않는다. */
  credentialId?: string;
  /** 리포트 버전. 같은 근거를 다시 발급하면 1씩 오른다. */
  version?: number;
  failureCode?: string;
};

type EvidenceIssuanceState = {
  evidenceId: string;
  eligibility: IssuanceEligibility;
  /** 서버가 읽은 근거 요약. 화면 표시용이며 FE 계산값을 덮어쓴다. */
  evidence: { merkleRoot: string; countryCode: string; taxYear: number; anchorStatus: string } | null;
  latest: IssuanceView | null;
};
```

| 코드 | 의미 |
|---|---|
| 200 | 위 상태 |
| 401 `unauthorized` | 세션 만료 |

### `POST /api/report-vc/issuances`

헤더 `Idempotency-Key: <uuid>` 필수. 응답에 `Set-Cookie: vw_vc_issue_attempt`.

```ts
type IssuanceRequest = { evidenceId: string };

type IssuanceOffer = IssuanceView & {
  status: "offer_ready";
  qr: { text: string };
  pollAfterMs: number;
};
```

| 코드 | 의미 |
|---|---|
| 201 | 발급 제안 생성. 폰에서 QR을 스캔해 VC를 받는다 |
| 200 | 같은 `Idempotency-Key`의 기존 발급 |
| 400 `invalid_request` | evidenceId 형식 오류 |
| 401 `unauthorized` | 세션 만료 |
| 409 `wallet_unlinked` | 지갑 미연결 |
| 409 `evidence_not_anchored` | 기록이 `anchored`가 아님(`details.anchorStatus`) |
| 409 `issuance_in_progress` | 같은 근거의 다른 발급이 진행 중(`details.issuanceId`). FE는 그 발급 상태를 조회한다 |
| 404 `evidence_not_found` | 내 기록이 아님 |
| 429/503 | `Retry-After` |

### `GET /api/report-vc/issuances/{issuanceId}`

```ts
type IssuanceStatus =
  | { status: "offer_ready"; retryAfterMs: number }   // 202, 폰 제출 대기
  | { status: "issuing"; retryAfterMs: number }       // 202, Issuer 처리 중
  | (IssuanceView & { status: "issued" })             // 200, 완료
  | (IssuanceView & { status: "expired" | "failed" | "cancelled" }); // 200, 종결
```

**QR 생성만으로 "발급 완료"가 되지 않는다.** 완료는 서버가 `issued`를 돌려줄 때다. `issued`는 Issuer가 VC를 지갑에 실제로 전달한 뒤에만 세운다.

| 코드 | 의미 |
|---|---|
| 202 | 대기 |
| 200 | 종결 상태 |
| 401 `unauthorized` | 세션 만료 |
| 403 `attempt_not_bound` | 바인딩 쿠키 불일치 |
| 404 `issuance_not_found` | 없는 발급 |
| 429/503 | `Retry-After` |

### `POST /api/report-vc/issuances/{issuanceId}/cancel`

`204`. 멱등. `issued` 뒤에는 취소가 아니라 무시(`204`)다.

### 4.2 VC 내용(참고)

BE가 만드는 VC의 클레임은 아래를 넘지 않는 것을 제안한다. 이름·CI·지갑 주소·거래 목록은 넣지 않는다.

```ts
type EstimatedTaxReportCredentialSubject = {
  reportId: string;          // BE 발급 식별자
  version: number;
  countryCode: string;
  taxYear: number;
  currency: "KRW";
  evidenceRoot: string;      // tax-evidence merkleRoot
  anchor: { chain: string; txHash: string; blockNumber: string };
  /** 선택 공개 대상. 검증 시 "금액 포함"을 고른 경우에만 열린다. */
  totals: { estimatedCharge: string; taxableGains: string; incomeTotal: string };
  /** 리포트 파일 잎. 제3자가 받은 CSV/XLSX가 이 근거로 만든 파일인지 대조할 때 쓴다. */
  files: { format: "csv" | "xlsx"; algorithm: "keccak256"; hash: string; byteLength: number }[];
  disclaimer: "estimated_tax_report";  // 추정치이며 공식 문서가 아님을 나타내는 고정 값
};
```

선택 공개는 **BE·Verifier가 정책으로 강제**해야 한다(예: `totals`를 별도 클레임으로 분리하거나 SD 방식 사용). 클라이언트가 금액을 숨기는 것만으로 선택 공개를 구현했다고 보지 않는다.

## 5. 제3자 공개 검증

로그인 없이 `/verify/report` 페이지에서 쓴다.

### `POST /api/report-vc/verifications`

```ts
type VerificationRequest = { disclosure: "basic" | "with_amounts" };

type VerificationAttempt = {
  verificationId: string;
  disclosure: "basic" | "with_amounts";
  qr: { text: string };
  expiresAt: string;
  pollAfterMs: number;
};
```

응답에 `Set-Cookie: vw_vc_verify_attempt`.

| 코드 | 의미 |
|---|---|
| 201 | 시도 생성 |
| 400 `disclosure_unsupported` | 그 공개 범위를 지원하지 않음 |
| 403 `origin_rejected` | Origin 불일치 |
| 429/503 | `Retry-After` |

### `GET /api/report-vc/verifications/{verificationId}`

```ts
type CheckOutcome = "passed" | "failed" | "unknown" | "unsupported";

type VerificationResult = {
  verificationId: string;
  disclosure: "basic" | "with_amounts";
  status: "verified" | "rejected";
  checkedAt: string;
  checks: {
    /** 신뢰된 발급자(등록된 Issuer DID)의 서명과 제출 증명(VP 서명·nonce) 검증 */
    issuerAndPresentation: CheckOutcome;
    /** 폐기 상태. active = 폐기되지 않음 */
    revocation: "active" | "revoked" | "unknown" | "unsupported";
    /** 같은 근거의 더 새로운 버전이 있는가. latest = 최신 */
    version: "latest" | "superseded" | "unknown" | "unsupported";
    /** 체인 기록의 해시와 VC의 evidenceRoot 일치 여부 */
    chainAnchor: CheckOutcome;
  };
  /** 공개가 허용된 클레임만. 이름·CI·VP 원문·지갑 주소는 절대 넣지 않는다. */
  claims: {
    reportId: string;
    version: number;
    countryCode: string;
    taxYear: number;
    evidenceRoot: string;
    issuedAt: string;
    anchor: { chain: string; txHash: string | null; blockNumber: string | null } | null;
    /** with_amounts에서만. basic이면 null */
    totals: { currency: "KRW"; estimatedCharge: string; taxableGains: string; incomeTotal: string } | null;
  } | null;
  /**
   * 리포트 보유자가 모바일 신분증(CX)으로 확인된 계정과 연결돼 있는가.
   * BE가 발급 시 사용자 레코드의 CX 확인 사실을 VC에 남긴 경우에만 "verified"다. 없으면 "not_provided".
   */
  accountLink: "verified" | "not_provided" | "unsupported";
};

type VerificationStatus =
  | { status: "pending"; retryAfterMs: number }   // 202
  | VerificationResult;                            // 200
```

- `status: "verified"`는 `issuerAndPresentation === "passed"`일 때만 가능하다. 나머지 항목은 각자 표시하며, `unknown`·`unsupported`·`failed`는 어느 것도 성공으로 표시하지 않는다.
- "폐기되지 않음"(`revocation: active`)과 "최신 버전"(`version: latest`)은 별개 항목이다.
- `rejected`도 `checks`를 채워 어디서 걸렸는지 보인다.

| 코드 | 의미 |
|---|---|
| 202 | 제출 대기 |
| 200 | 결과 |
| 403 `attempt_not_bound` | 바인딩 쿠키 불일치 |
| 404 `verification_not_found` | 없는 시도 |
| 409 `attempt_cancelled` | 취소됨 |
| 410 `attempt_expired` | 만료 |
| 429/503 | `Retry-After` |

### `POST /api/report-vc/verifications/{verificationId}/cancel`

`204`. 멱등.

### `POST /api/report-vc/verifications/{verificationId}/file-checks`

제3자가 받은 리포트 파일이 검증된 VC의 근거에 포함된 파일인지 확인한다. **파일은 서버로 보내지 않는다.** 브라우저가 파일 바이트의 keccak256을 계산해 해시만 보낸다(`lib/export/report-hash.ts`와 같은 알고리즘). 검증이 `verified`로 끝난 시도에서만 허용한다.

```ts
type FileCheckRequest = {
  format: "csv" | "xlsx";
  algorithm: "keccak256";
  hash: string;          // 0x + 64 hex
  byteLength: number;
};

type FileCheckResult = {
  format: "csv" | "xlsx";
  hash: string;
  /**
   * included    = 파일 잎이 VC의 evidenceRoot에 포함됨(서버가 머클 증명으로 확인)
   * not_included = 해시가 근거 잎에 없음
   * unsupported = 이 형식은 검증 불가
   * unavailable = 잎 정보를 읽을 수 없어 판단 불가
   */
  status: "included" | "not_included" | "unsupported" | "unavailable";
  /** included일 때 FE가 다시 검증할 수 있도록 잎과 증명 경로를 준다(`lib/tax/evidence.ts#verifyProof`). */
  leaf?: { kind: "file"; file: "csv" | "xlsx"; algorithm: "keccak256"; hash: string; byteLength: number };
  proof?: { side: "left" | "right"; hash: string }[];
  evidenceRoot: string;
};
```

- 성공 표시 조건: `status === "included"` **그리고** `proof`가 있으면 브라우저 재검증(`verifyProof(leaf, proof, evidenceRoot)`)도 통과. VC 루트와 체인 값이 일치하는 것만으로 파일 검증 성공이라고 표시하지 않는다.
- PDF(`/export/report` 인쇄물)는 근거에 바이트 해시가 없어 검증할 수 없다. FE는 형식을 보고 서버에 묻지 않고 `unsupported`로 표시한다. `capabilities.fileFormats`가 늘어나면 그때 연다.

| 코드 | 의미 |
|---|---|
| 200 | 결과 |
| 400 `invalid_request` | 형식·해시 오류 |
| 403 `attempt_not_bound` | 바인딩 쿠키 불일치 |
| 409 `verification_not_completed` | 아직 `verified`가 아님 |
| 429/503 | `Retry-After` |

## 6. 오류 코드 모음

| 코드 | HTTP | 어디서 |
|---|---|---|
| `unauthorized` | 401 | 인증 필요 경로 전부 |
| `origin_rejected` | 403 | 상태 변경 요청 |
| `attempt_not_bound` | 403 | 시도 조회·취소·파일 검증 |
| `attempt_not_found` / `issuance_not_found` / `verification_not_found` / `evidence_not_found` | 404 | 조회 |
| `wallet_already_linked` / `wallet_unlinked` | 409 | 연결 생성 / 발급 |
| `did_linked_to_other_account` | 409 | 연결 조회 |
| `presentation_rejected` | 409 | 연결 조회 |
| `attempt_cancelled` | 409 | 조회 |
| `evidence_not_anchored` | 409 | 발급 |
| `issuance_in_progress` | 409 | 발급 |
| `verification_not_completed` | 409 | 파일 검증 |
| `attempt_expired` | 410 | 조회 |
| `disclosure_unsupported` | 400 | 검증 생성 |
| `invalid_request` | 400 | 본문 검증 |
| `rate_limited` | 429 | 전부(`Retry-After`) |
| `verifier_unavailable` / `issuer_unavailable` | 503 | 시도 생성·조회(`Retry-After`) |
| `feature_unavailable` | (FE 번역) | 봉투가 아닌 404/501, 네트워크 실패 |

## 7. 프록시 변경(FE)

`proxy.ts`에 아래를 더했다.

- allowlist: `/api/report-vc/capabilities`, `/api/report-vc/wallet`, `/api/report-vc/wallet/link-attempts`, `/api/report-vc/issuances`, `/api/report-vc/verifications`와 접두 `/api/report-vc/`.
- matcher: 같은 경로와 `/api/report-vc/:path*`.
- `/api/report-vc/` 경로에서만 `Origin`을 전달하고 `vw_vc_link_attempt`·`vw_vc_issue_attempt`·`vw_vc_verify_attempt`를 형식 검사 뒤 전달한다. 다른 경로로는 새지 않는다.
- `vw_access_token`은 기존과 같이 전부에 실린다. 공개 검증 경로에는 토큰이 없어도 된다.

## 8. BE 담당자가 정해야 할 것(열린 질문)

1. **DID 해제와 VC 폐기.** `DELETE /api/report-vc/wallet`이 기존 VC를 폐기하는가. FE는 어느 쪽도 단정하지 않는다.
2. **선택 공개 방식.** `with_amounts`를 별도 VC/클레임으로 낼지, SD-JWT 같은 선택 공개를 쓸지. `capabilities.disclosures`가 실제 지원 범위를 말한다.
3. **버전 판정.** 같은 근거를 다시 발급했을 때 이전 VC를 자동 폐기할지, `version: superseded`만 표시할지.
4. **계정 연결 표시.** `accountLink: "verified"`의 근거를 VC 클레임에 어떻게 남길지(CX 확인 시각 등). 이름·CI는 절대 넣지 않는다.
5. **Verifier 세션.** 공개 검증 시도의 nonce·VP 저장 기간과 결과 보존 기간(제안: 시도 만료 후 10분).
6. **파일 검증 잎 접근.** 검증 결과에서 잎을 읽으려면 Verifier가 `evidenceRoot`로 BE 기록에 접근해야 한다. 소유자와 무관한 조회이므로 잎 전체가 아니라 파일 잎과 증명 경로만 노출한다.
7. **레이트 리밋.** 공개 검증 시도 생성은 IP·바인딩 쿠키 기준 제한이 필요하다.

## 9. FE에서 쓰는 문구 규칙

- 증명서 이름은 **"추정 세금 리포트 증명서"**다.
- 증명서를 공식 문서, 납부가 끝난 사실, 계산 정확성의 보증으로 표현하지 않는다(`tests/unit/terminology-guard.test.ts`, `tests/unit/report-vc-terminology.test.ts`가 문구를 고정한다).
- 금액은 KRW로만 표시한다(`formatFiat(value, "KRW")`).
- 검증 결과에서 미확인(`unknown`)·미지원(`unsupported`)·실패(`failed`)는 어느 것도 성공 아이콘을 쓰지 않는다.

## 2026-09-24 BE 구현 반영 사항

BE `feat/opendid-report-vc`에서 이 계약의 API를 구현했다. 개발 환경에서 실폰 발급·제출 검증과 실제 체인/CSV 무결성 대조를 확인했다. 운영 환경은 별도 DB이므로 새 로그인·지갑 연결·발급으로 확인한다.

- 발급 POST의 동일 멱등 키 재요청은 `IssuanceOffer | IssuanceSettled`를 반환할 수 있다. 이미 끝난 발급을 새 QR로 표시하지 않는다.
- v1은 `basic`, CSV/XLSX만 지원한다. 금액 선택 공개와 PDF 대조는 지원하지 않는다.
- 지갑 연결은 최근 15분 이내 실제 CX 본인인증이 필요하다. `cx_verification_required`, `cx_reauthentication_required`를 처리한다.
- `claims.version`은 v1 근거 문서 형식 번호다. 최신 여부는 같은 계정·국가·연도의 최신 저장된 근거 루트로 비교한다. 과거 VC는 새 리포트 때문에 자동 폐기되지 않는다.
- `verified`는 VP 검증뿐 아니라 현재 활성 상태와 실제 체인 앵커 대조까지 성공한 경우에만 반환한다.
- 파일 대조는 응답 자체의 루트뿐 아니라 직전에 검증한 VC 루트와 같아야 한다. mock 출처는 실제 파일 검증 성공으로 표시하지 않는다.
- 시도 보관 및 멱등 키 유지 기간은 만료 후 24시간이다. 공개 검증 완료 후 파일 대조는 QR 만료 시점부터 추가 10분 동안 가능하다.
