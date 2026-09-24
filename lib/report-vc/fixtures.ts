import type {
  EvidenceIssuanceState,
  FileCheckResult,
  IssuanceOffer,
  IssuanceSettled,
  LinkAttempt,
  LinkedWallet,
  ReportVcCapabilities,
  VerificationAttempt,
  VerificationResult,
} from "@/lib/report-vc/types";

/**
 * 테스트와 명시적 로컬 미리보기(`lib/report-vc/mock.ts`)가 쓰는 고정 데이터.
 *
 * 전부 지어낸 값이다. 실제 본인 확인이나 실제 체인 검증을 완료했다고 말하지 않는다:
 * mock 어댑터는 이 값을 `provenance: "mock"`으로만 돌려주고, 화면은 그 출처를 그대로 보인다.
 */

export const FIXTURE_DID = "did:omn:vera-preview-000000000000000000000000000000000000";
export const FIXTURE_ROOT = `0x${"5a".repeat(32)}`;
export const FIXTURE_TX = `0x${"c3".repeat(32)}`;

export const FIXTURE_CAPABILITIES: ReportVcCapabilities = {
  enabled: true,
  walletLink: true,
  issuance: true,
  verification: true,
  disclosures: ["basic", "with_amounts"],
  fileFormats: ["csv", "xlsx"],
};

export const FIXTURE_LINKED: LinkedWallet = {
  status: "linked",
  did: FIXTURE_DID,
  linkedAt: "2027-05-01T00:00:00.000Z",
  walletName: "Open DID 지갑(미리보기)",
};

/** QR 문자열은 BE가 완성한다. 미리보기 값은 지갑이 읽을 수 있는 형식이 아니다. */
export function fixtureLinkAttempt(now = Date.now(), ttlMs = 180_000): LinkAttempt {
  return {
    attemptId: "link-preview-1",
    qr: { text: JSON.stringify({ payloadType: "PREVIEW_ONLY", note: "mock 지갑 연결 QR" }) },
    expiresAt: new Date(now + ttlMs).toISOString(),
    pollAfterMs: 2000,
  };
}

export function fixtureIssuanceState(over: Partial<EvidenceIssuanceState> = {}): EvidenceIssuanceState {
  return {
    evidenceId: FIXTURE_ROOT,
    eligibility: "ready",
    evidence: { merkleRoot: FIXTURE_ROOT, countryCode: "KR", taxYear: 2027, anchorStatus: "anchored" },
    latest: null,
    ...over,
  };
}

export function fixtureIssuanceOffer(now = Date.now(), ttlMs = 180_000): IssuanceOffer {
  return {
    issuanceId: "issuance-preview-1",
    status: "offer_ready",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    qr: { text: JSON.stringify({ payloadType: "PREVIEW_ONLY", note: "mock 발급 QR" }) },
    pollAfterMs: 2000,
  };
}

export function fixtureIssued(offer: IssuanceOffer, now = Date.now()): IssuanceSettled {
  return {
    issuanceId: offer.issuanceId,
    status: "issued",
    createdAt: offer.createdAt,
    expiresAt: offer.expiresAt,
    issuedAt: new Date(now).toISOString(),
    credentialId: "urn:uuid:preview-credential-1",
    version: 1,
  };
}

export function fixtureVerificationAttempt(disclosure: "basic" | "with_amounts", now = Date.now(), ttlMs = 180_000): VerificationAttempt {
  return {
    verificationId: "verification-preview-1",
    disclosure,
    qr: { text: JSON.stringify({ payloadType: "PREVIEW_ONLY", note: "mock 검증 QR", disclosure }) },
    expiresAt: new Date(now + ttlMs).toISOString(),
    pollAfterMs: 2000,
  };
}

export function fixtureVerificationResult(disclosure: "basic" | "with_amounts", over: Partial<VerificationResult> = {}): VerificationResult {
  return {
    verificationId: "verification-preview-1",
    disclosure,
    status: "verified",
    checkedAt: "2027-05-02T00:00:00.000Z",
    checks: { issuerAndPresentation: "passed", revocation: "active", version: "latest", chainAnchor: "passed" },
    claims: {
      reportId: "report-preview-1",
      version: 1,
      countryCode: "KR",
      taxYear: 2027,
      evidenceRoot: FIXTURE_ROOT,
      issuedAt: "2027-05-01T00:00:10.000Z",
      anchor: { chain: "omnione-stage", txHash: FIXTURE_TX, blockNumber: "1284" },
      totals: disclosure === "with_amounts"
        ? { currency: "KRW", estimatedCharge: "183333.34", taxableGains: "833333.33", incomeTotal: "1200000" }
        : null,
    },
    // mock에는 실제 모바일 신분증 확인 근거가 없다. verified로 두지 않는다.
    accountLink: "not_provided",
    ...over,
  };
}

export function fixtureFileCheck(format: "csv" | "xlsx", hash: string, over: Partial<FileCheckResult> = {}): FileCheckResult {
  return { format, hash, status: "not_included", evidenceRoot: FIXTURE_ROOT, ...over };
}
