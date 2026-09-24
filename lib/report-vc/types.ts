import { z } from "zod";

/**
 * Open DID 리포트 VC 계약의 타입과 런타임 스키마.
 *
 * 경로·필드는 `docs/opendid-report-vc-api-contract.md`(BE 담당자와 조율할 제안 계약)를 따른다.
 * BE가 아직 없으므로 여기 스키마가 곧 FE가 기대하는 응답 형태다. 계약이 바뀌면 문서와 이 파일을 함께 고친다.
 *
 * 값은 전부 서버가 확정한 사실이다. FE가 계산한 금액·DID·머클루트를 권위 있는 값으로 되돌려 보내지 않는다.
 */

export const DISCLOSURES = ["basic", "with_amounts"] as const;
export type Disclosure = (typeof DISCLOSURES)[number];

export const FILE_FORMATS = ["csv", "xlsx"] as const;
export type VerifiableFileFormat = (typeof FILE_FORMATS)[number];

const isoDateTime = z.string().datetime({ offset: true });
const pollMs = z.number().int().min(1000).max(60000);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

// ── 기능 지원 여부 ────────────────────────────────────────────────────────────

export const capabilitiesSchema = z.object({
  enabled: z.boolean(),
  walletLink: z.boolean(),
  issuance: z.boolean(),
  verification: z.boolean(),
  disclosures: z.array(z.enum(DISCLOSURES)),
  fileFormats: z.array(z.enum(FILE_FORMATS)),
});
export type ReportVcCapabilities = z.infer<typeof capabilitiesSchema>;

// ── 증명서 지갑 연결 ──────────────────────────────────────────────────────────

const linkedSchema = z.object({
  status: z.literal("linked"),
  did: z.string().min(1),
  linkedAt: isoDateTime,
  walletName: z.string().optional(),
});
export const walletLinkStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unlinked") }),
  linkedSchema,
]);
export type WalletLinkState = z.infer<typeof walletLinkStateSchema>;
export type LinkedWallet = z.infer<typeof linkedSchema>;

export const qrSchema = z.object({ text: z.string().min(1) });

export const linkAttemptSchema = z.object({
  attemptId: z.string().min(1),
  qr: qrSchema,
  expiresAt: isoDateTime,
  pollAfterMs: pollMs,
});
export type LinkAttempt = z.infer<typeof linkAttemptSchema>;

export const pendingSchema = z.object({ status: z.literal("pending"), retryAfterMs: pollMs });
export type Pending = z.infer<typeof pendingSchema>;

export type LinkAttemptStatus = Pending | LinkedWallet;

// ── 발급 ──────────────────────────────────────────────────────────────────────

export const ISSUANCE_STATUSES = ["offer_ready", "issuing", "issued", "expired", "failed", "cancelled"] as const;
export type IssuanceStatusValue = (typeof ISSUANCE_STATUSES)[number];

export const issuanceViewSchema = z.object({
  issuanceId: z.string().min(1),
  status: z.enum(ISSUANCE_STATUSES),
  createdAt: isoDateTime,
  expiresAt: isoDateTime,
  issuedAt: isoDateTime.optional(),
  credentialId: z.string().optional(),
  version: z.number().int().positive().optional(),
  failureCode: z.string().optional(),
});
export type IssuanceView = z.infer<typeof issuanceViewSchema>;

export const ELIGIBILITIES = ["ready", "wallet_unlinked", "anchor_pending", "anchor_failed", "anchor_missing", "disabled"] as const;
export type IssuanceEligibility = (typeof ELIGIBILITIES)[number];

export const evidenceIssuanceStateSchema = z.object({
  evidenceId: z.string().min(1),
  eligibility: z.enum(ELIGIBILITIES),
  evidence: z.object({
    merkleRoot: hex32,
    countryCode: z.string().min(1),
    taxYear: z.number().int(),
    anchorStatus: z.string().min(1),
  }).nullable(),
  latest: issuanceViewSchema.nullable(),
});
export type EvidenceIssuanceState = z.infer<typeof evidenceIssuanceStateSchema>;

export const issuanceOfferSchema = issuanceViewSchema.extend({
  status: z.literal("offer_ready"),
  qr: qrSchema,
  pollAfterMs: pollMs,
});
export type IssuanceOffer = z.infer<typeof issuanceOfferSchema>;

/** 202 대기 응답. `offer_ready`는 폰 제출 대기, `issuing`은 Issuer 처리 중이다. */
export const issuanceWaitingSchema = z.object({
  status: z.enum(["offer_ready", "issuing"]),
  retryAfterMs: pollMs,
});
export type IssuanceWaiting = z.infer<typeof issuanceWaitingSchema>;

/** 200 종결 응답. `issued`만 성공이다. */
export const issuanceSettledSchema = issuanceViewSchema.extend({
  status: z.enum(["issued", "expired", "failed", "cancelled"]),
});
export type IssuanceSettled = z.infer<typeof issuanceSettledSchema>;

export type IssuanceStatus = IssuanceWaiting | IssuanceSettled;

// ── 공개 검증 ─────────────────────────────────────────────────────────────────

export const verificationAttemptSchema = z.object({
  verificationId: z.string().min(1),
  disclosure: z.enum(DISCLOSURES),
  qr: qrSchema,
  expiresAt: isoDateTime,
  pollAfterMs: pollMs,
});
export type VerificationAttempt = z.infer<typeof verificationAttemptSchema>;

export const checkOutcomeSchema = z.enum(["passed", "failed", "unknown", "unsupported"]);
export type CheckOutcome = z.infer<typeof checkOutcomeSchema>;

export const revocationOutcomeSchema = z.enum(["active", "revoked", "unknown", "unsupported"]);
export type RevocationOutcome = z.infer<typeof revocationOutcomeSchema>;

export const versionOutcomeSchema = z.enum(["latest", "superseded", "unknown", "unsupported"]);
export type VersionOutcome = z.infer<typeof versionOutcomeSchema>;

export const verificationResultSchema = z.object({
  verificationId: z.string().min(1),
  disclosure: z.enum(DISCLOSURES),
  status: z.enum(["verified", "rejected"]),
  checkedAt: isoDateTime,
  checks: z.object({
    issuerAndPresentation: checkOutcomeSchema,
    revocation: revocationOutcomeSchema,
    version: versionOutcomeSchema,
    chainAnchor: checkOutcomeSchema,
  }),
  claims: z.object({
    reportId: z.string().min(1),
    version: z.number().int().positive(),
    countryCode: z.string().min(1),
    taxYear: z.number().int(),
    evidenceRoot: hex32,
    issuedAt: isoDateTime,
    anchor: z.object({ chain: z.string(), txHash: z.string().nullable(), blockNumber: z.string().nullable() }).nullable(),
    totals: z.object({
      currency: z.literal("KRW"),
      estimatedCharge: z.string(),
      taxableGains: z.string(),
      incomeTotal: z.string(),
    }).nullable(),
  }).nullable(),
  accountLink: z.enum(["verified", "not_provided", "unsupported"]),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export type VerificationStatus = Pending | VerificationResult;

export const proofStepSchema = z.object({ side: z.enum(["left", "right"]), hash: hex32 });

export const fileCheckResultSchema = z.object({
  format: z.enum(FILE_FORMATS),
  hash: hex32,
  status: z.enum(["included", "not_included", "unsupported", "unavailable"]),
  leaf: z.object({
    kind: z.literal("file"),
    file: z.enum(FILE_FORMATS),
    algorithm: z.literal("keccak256"),
    hash: hex32,
    byteLength: z.number().int().nonnegative(),
  }).optional(),
  proof: z.array(proofStepSchema).optional(),
  evidenceRoot: hex32,
});
export type FileCheckResult = z.infer<typeof fileCheckResultSchema>;

export type FileCheckRequest = {
  format: VerifiableFileFormat;
  algorithm: "keccak256";
  hash: string;
  byteLength: number;
};

// ── 오류 ─────────────────────────────────────────────────────────────────────

/**
 * 계약의 오류 코드 중 FE가 분기하는 것. 나머지는 메시지만 보인다.
 * `feature_unavailable`은 FE 번역이다: 봉투가 아닌 404/501, 네트워크 실패.
 */
export type ReportVcErrorCode =
  | "unauthorized"
  | "feature_unavailable"
  | "attempt_not_bound"
  | "attempt_expired"
  | "attempt_cancelled"
  | "did_linked_to_other_account"
  | "presentation_rejected"
  | "wallet_already_linked"
  | "wallet_unlinked"
  | "evidence_not_anchored"
  | "issuance_in_progress"
  | "verification_not_completed"
  | "disclosure_unsupported"
  | "rate_limited"
  | "verifier_unavailable"
  | "issuer_unavailable"
  | "invalid_response"
  | (string & {});

export class ReportVcError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ReportVcErrorCode,
    message: string,
    /** 429·503에서 `Retry-After`를 밀리초로. 그 외에는 기본 2초. */
    public readonly retryAfterMs = 2000,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ReportVcError";
  }

  /** 세션이 끝났다. 폴링을 멈추고 재로그인을 안내한다. */
  get sessionExpired(): boolean {
    return this.status === 401 || this.code === "unauthorized";
  }

  /** 잠시 뒤 같은 요청을 다시 보내도 되는 오류인가(폴링에서만 쓴다). */
  get transient(): boolean {
    return this.status === 429 || this.status === 503;
  }
}
