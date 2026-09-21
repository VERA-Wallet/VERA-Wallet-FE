/** 등록 대상 파일의 종류. 화면의 두 버튼과 1:1이다(PDF는 바이트를 못 얻어 범위 밖). */
export type ReportAnchorKind = "csv" | "xlsx";
/** 해시 알고리즘 태그. 지금 FE가 내는 값은 keccak256뿐이고, 컨트랙트 요구가 바뀔 때를 위해 계약에 싣는다. */
export type ReportAnchorAlgorithm = "keccak256" | "sha256";

/** 등록 요청. 온체인·BE로 나가는 것은 이 7개뿐이다 — 금액·지갑 주소·파일 내용은 올리지 않는다. */
export type ReportAnchorInput = {
  version: 1;
  algorithm: ReportAnchorAlgorithm;
  fileHash: string;
  kind: ReportAnchorKind;
  countryCode: string;
  taxYear: number;
  byteLength: number;
};

/**
 * 파일 하나의 등록 기록. 값은 전부 서버가 확정한 사실이다 — FE가 지어내지 않는다.
 * 필드명은 `EvidenceRecord`(lib/ports/tax-evidence.ts:4)와 맞춘다. BE와 화면이 두 계약을 같은 모양으로 다루게 하려는 것이다.
 */
export type ReportAnchorRecord = {
  fileHash: string;
  algorithm: ReportAnchorAlgorithm;
  kind: ReportAnchorKind;
  countryCode: string;
  taxYear: number;
  byteLength: number;
  recordedAt: string;
  /** pending = 시도 중, anchored = 체인에 실림, failed = 이번 시도가 소진됨(종착이 아니다 — 재제출로 새 시도가 열린다). */
  anchorStatus: string;
  /** 몇 번째 시도인가. 첫 등록이 1. 재제출할 때마다 오른다 — 화면이 "N번째 시도"를 말할 수 있고 BE 로그와 맞춰볼 수 있다. */
  attempt: number;
  txHash: string | null;
  blockNumber: string | null;
  anchoredAt: string | null;
  /** OmniOne 스테이지에는 블록 탐색기가 없다 — null이 정상이다(`lib/ports/tax-evidence.ts:28` 주석과 같은 사실). */
  explorerUrl: string | null;
  /** 마지막 실패 사유. `pending`으로 되돌아간 뒤에도 남는다 — 재시도 중에도 "왜 한 번 실패했는지"는 사실이다. */
  failureReason: string | null;
  /** 마지막 실패 시각. failureReason과 짝이다. */
  lastFailureAt: string | null;
};

/**
 * 레코드 하나를 가리키는 키. `fileHash` 하나로는 부족하다 — estimate가 없는 기간에서는 국가·연도가 달라도
 * 파일 바이트가 같아서 해시가 겹친다(계획 §0-F6). 조회도 등록의 멱등 판정도 이 다섯 값 전부로 한다.
 */
export type ReportAnchorKey = {
  fileHash: string;
  kind: ReportAnchorKind;
  countryCode: string;
  taxYear: number;
};

export interface ReportAnchorProvider {
  /**
   * 해시를 등록한다. 멱등 판정은 `(fileHash, kind, countryCode, taxYear)` 전부로 한다(사용자 범위는 서버가 세션에서 잡는다).
   * - 같은 키가 `anchored`면 새 트랜잭션 없이 그 기록을 돌려준다(멱등).
   * - 같은 키가 `failed`면 **새 시도를 연다**(attempt++, pending). 실패한 파일을 영영 못 받는 상태를 만들지 않는다.
   * - 같은 키가 `pending`이면 진행 중인 시도를 그대로 돌려준다(중복 트랜잭션 금지).
   * - 해시는 같고 메타가 다르면 **별개 레코드**다. 충돌이 아니다.
   */
  register(input: ReportAnchorInput): Promise<ReportAnchorRecord>;
  /** 그 키의 **내** 기록. 없거나 남의 것이면 null — 화면이 "아직 등록 안 함"을 말할 근거이자 폴링의 읽기 경로다. */
  get(key: ReportAnchorKey): Promise<ReportAnchorRecord | null>;
}

// 예약(이번 범위 밖): `GET /api/report-anchor/{fileHash}/chain` → `EvidenceChainCheck`와 같은 모양.
// 파일을 올려 체인과 대조하는 검증 화면이 생길 때 여기에 `checkChain(fileHash)`을 더한다.
