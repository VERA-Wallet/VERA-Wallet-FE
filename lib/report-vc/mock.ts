import type { ReportVcClient, WithProvenance } from "@/lib/report-vc/client";
import {
  FIXTURE_CAPABILITIES,
  FIXTURE_LINKED,
  fixtureFileCheck,
  fixtureIssuanceOffer,
  fixtureIssuanceState,
  fixtureIssued,
  fixtureLinkAttempt,
  fixtureVerificationAttempt,
  fixtureVerificationResult,
} from "@/lib/report-vc/fixtures";
import {
  ReportVcError,
  type Disclosure,
  type EvidenceIssuanceState,
  type FileCheckRequest,
  type IssuanceOffer,
  type LinkAttempt,
  type ReportVcCapabilities,
  type VerificationAttempt,
  type VerificationResult,
  type WalletLinkState,
} from "@/lib/report-vc/types";

/**
 * 인메모리 mock 어댑터. **테스트와 명시적 로컬 미리보기에서만** 쓴다(`lib/report-vc/composition.ts`).
 *
 * 실서비스 경로에서 HTTP 오류를 이 어댑터로 조용히 대체하지 않는다. 모든 응답은 `provenance: "mock"`이라
 * 화면이 "mock 데이터"를 표시하고, 실제 본인 확인·실제 체인 검증을 완료했다고 말하지 않는다.
 *
 * 상태 전이는 "폰이 제출했다"를 흉내 내는 `settleAfterPolls`로 정한다: 그 횟수만큼 대기(202)를 돌려준 뒤 종결한다.
 */
export type MockReportVcOptions = {
  capabilities?: Partial<ReportVcCapabilities>;
  initialWallet?: WalletLinkState;
  /** 대기 응답을 몇 번 돌려준 뒤 종결할지. 기본 1. */
  settleAfterPolls?: number;
  /** 지갑 연결 종결 결과. 기본 linked. */
  linkOutcome?: "linked" | "did_linked_to_other_account" | "presentation_rejected" | "expired";
  issuanceOutcome?: "issued" | "failed" | "expired";
  verificationResult?: (disclosure: Disclosure) => VerificationResult;
  issuanceState?: (evidenceId: string) => EvidenceIssuanceState;
  /** 파일 해시가 근거에 포함됐다고 답할 해시 목록. 나머지는 not_included. */
  includedHashes?: string[];
  now?: () => number;
};

const mock = <T,>(data: T): WithProvenance<T> => ({ data, provenance: "mock" });

export class MockReportVcClient implements ReportVcClient {
  private wallet: WalletLinkState;
  private readonly polls = new Map<string, number>();
  private readonly cancelled = new Set<string>();
  private readonly issuances = new Map<string, IssuanceOffer>();
  private readonly verifications = new Map<string, VerificationAttempt>();
  private readonly idempotency = new Map<string, IssuanceOffer>();
  readonly calls: string[] = [];

  constructor(private readonly options: MockReportVcOptions = {}) {
    this.wallet = options.initialWallet ?? { status: "unlinked" };
  }

  private now() { return (this.options.now ?? Date.now)(); }
  private settleAfter() { return this.options.settleAfterPolls ?? 1; }
  private countPoll(id: string): number {
    const next = (this.polls.get(id) ?? 0) + 1;
    this.polls.set(id, next);
    return next;
  }

  async capabilities() {
    this.calls.push("capabilities");
    return mock({ ...FIXTURE_CAPABILITIES, ...this.options.capabilities });
  }

  async walletState() {
    this.calls.push("walletState");
    return mock(this.wallet);
  }

  async createLinkAttempt() {
    this.calls.push("createLinkAttempt");
    if (this.wallet.status === "linked") throw new ReportVcError(409, "wallet_already_linked", "이미 연결된 지갑이 있습니다.");
    const attempt: LinkAttempt = { ...fixtureLinkAttempt(this.now()), attemptId: `link-mock-${this.polls.size + 1}` };
    this.polls.set(attempt.attemptId, 0);
    return mock(attempt);
  }

  async linkAttemptStatus(attemptId: string) {
    this.calls.push(`linkAttemptStatus:${attemptId}`);
    if (this.cancelled.has(attemptId)) throw new ReportVcError(409, "attempt_cancelled", "취소된 연결 시도입니다.");
    if (!this.polls.has(attemptId)) throw new ReportVcError(404, "attempt_not_found", "연결 시도를 찾지 못했습니다.");
    if (this.countPoll(attemptId) <= this.settleAfter()) return mock({ status: "pending" as const, retryAfterMs: 2000 });
    switch (this.options.linkOutcome ?? "linked") {
      case "did_linked_to_other_account":
        throw new ReportVcError(409, "did_linked_to_other_account", "이 DID는 다른 계정에 이미 연결되어 있습니다.");
      case "presentation_rejected":
        throw new ReportVcError(409, "presentation_rejected", "지갑이 제출한 증명을 확인하지 못했습니다.");
      case "expired":
        throw new ReportVcError(410, "attempt_expired", "연결 시도가 만료되었습니다.");
      default:
        this.wallet = { ...FIXTURE_LINKED, linkedAt: new Date(this.now()).toISOString() };
        return mock(this.wallet);
    }
  }

  async cancelLinkAttempt(attemptId: string) {
    this.calls.push(`cancelLinkAttempt:${attemptId}`);
    this.cancelled.add(attemptId);
  }

  async unlinkWallet() {
    this.calls.push("unlinkWallet");
    this.wallet = { status: "unlinked" };
  }

  async evidenceIssuance(evidenceId: string) {
    this.calls.push(`evidenceIssuance:${evidenceId}`);
    if (this.options.issuanceState) return mock(this.options.issuanceState(evidenceId));
    return mock(fixtureIssuanceState({
      evidenceId,
      eligibility: this.wallet.status === "linked" ? "ready" : "wallet_unlinked",
      evidence: { merkleRoot: evidenceId, countryCode: "KR", taxYear: 2027, anchorStatus: "anchored" },
    }));
  }

  async requestIssuance(input: { evidenceId: string; idempotencyKey: string }) {
    this.calls.push(`requestIssuance:${input.evidenceId}:${input.idempotencyKey}`);
    const existing = this.idempotency.get(input.idempotencyKey);
    if (existing) return mock(existing);
    if (this.wallet.status !== "linked") throw new ReportVcError(409, "wallet_unlinked", "증명서 지갑을 먼저 연결하세요.");
    const offer: IssuanceOffer = { ...fixtureIssuanceOffer(this.now()), issuanceId: `issuance-mock-${this.issuances.size + 1}` };
    this.issuances.set(offer.issuanceId, offer);
    this.idempotency.set(input.idempotencyKey, offer);
    this.polls.set(offer.issuanceId, 0);
    return mock(offer);
  }

  async issuanceStatus(issuanceId: string) {
    this.calls.push(`issuanceStatus:${issuanceId}`);
    const offer = this.issuances.get(issuanceId);
    if (!offer) throw new ReportVcError(404, "issuance_not_found", "발급 요청을 찾지 못했습니다.");
    if (this.cancelled.has(issuanceId)) return mock({ ...offer, status: "cancelled" as const });
    if (this.countPoll(issuanceId) <= this.settleAfter()) return mock({ status: "offer_ready" as const, retryAfterMs: 2000 });
    switch (this.options.issuanceOutcome ?? "issued") {
      case "failed":
        return mock({ ...offer, status: "failed" as const, failureCode: "issuer_rejected" });
      case "expired":
        return mock({ ...offer, status: "expired" as const });
      default:
        return mock(fixtureIssued(offer, this.now()));
    }
  }

  async cancelIssuance(issuanceId: string) {
    this.calls.push(`cancelIssuance:${issuanceId}`);
    this.cancelled.add(issuanceId);
  }

  async createVerification(input: { disclosure: Disclosure }) {
    this.calls.push(`createVerification:${input.disclosure}`);
    const supported = this.options.capabilities?.disclosures ?? FIXTURE_CAPABILITIES.disclosures;
    if (!supported.includes(input.disclosure)) throw new ReportVcError(400, "disclosure_unsupported", "지원하지 않는 공개 범위입니다.");
    const attempt: VerificationAttempt = { ...fixtureVerificationAttempt(input.disclosure, this.now()), verificationId: `verification-mock-${this.verifications.size + 1}` };
    this.verifications.set(attempt.verificationId, attempt);
    this.polls.set(attempt.verificationId, 0);
    return mock(attempt);
  }

  async verificationStatus(verificationId: string) {
    this.calls.push(`verificationStatus:${verificationId}`);
    const attempt = this.verifications.get(verificationId);
    if (!attempt) throw new ReportVcError(404, "verification_not_found", "검증 시도를 찾지 못했습니다.");
    if (this.cancelled.has(verificationId)) throw new ReportVcError(409, "attempt_cancelled", "취소된 검증 시도입니다.");
    if (this.countPoll(verificationId) <= this.settleAfter()) return mock({ status: "pending" as const, retryAfterMs: 2000 });
    const result = this.options.verificationResult?.(attempt.disclosure) ?? fixtureVerificationResult(attempt.disclosure);
    return mock({ ...result, verificationId });
  }

  async cancelVerification(verificationId: string) {
    this.calls.push(`cancelVerification:${verificationId}`);
    this.cancelled.add(verificationId);
  }

  async checkFile(verificationId: string, input: FileCheckRequest) {
    this.calls.push(`checkFile:${verificationId}:${input.format}`);
    if (!this.verifications.has(verificationId)) throw new ReportVcError(404, "verification_not_found", "검증 시도를 찾지 못했습니다.");
    const included = (this.options.includedHashes ?? []).map((hash) => hash.toLowerCase()).includes(input.hash.toLowerCase());
    return mock(fixtureFileCheck(input.format, input.hash, included ? { status: "included" } : {}));
  }
}
