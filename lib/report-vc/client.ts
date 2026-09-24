import type { z } from "zod";

import { decodeResponse } from "@/lib/http/error-codec";
import type { Provenance } from "@/lib/http/envelope";
import {
  ReportVcError,
  capabilitiesSchema,
  evidenceIssuanceStateSchema,
  fileCheckResultSchema,
  issuanceOfferSchema,
  issuanceSettledSchema,
  issuanceWaitingSchema,
  linkAttemptSchema,
  pendingSchema,
  verificationAttemptSchema,
  verificationResultSchema,
  walletLinkStateSchema,
  type Disclosure,
  type EvidenceIssuanceState,
  type FileCheckRequest,
  type FileCheckResult,
  type IssuanceOffer,
  type IssuanceStatus,
  type LinkAttempt,
  type LinkAttemptStatus,
  type ReportVcCapabilities,
  type VerificationAttempt,
  type VerificationStatus,
  type WalletLinkState,
} from "@/lib/report-vc/types";

/** 응답 데이터에 출처를 붙인다. mock이면 화면은 실제 검증·발급으로 표시하지 않는다. */
export type WithProvenance<T> = { data: T; provenance: Provenance };

/**
 * 리포트 VC 포트. 화면은 이 인터페이스만 본다.
 * 실구현은 `HttpReportVcClient`(same-origin 프록시), 테스트·명시적 미리보기는 `lib/report-vc/mock.ts`.
 */
export interface ReportVcClient {
  capabilities(signal?: AbortSignal): Promise<WithProvenance<ReportVcCapabilities>>;

  walletState(signal?: AbortSignal): Promise<WithProvenance<WalletLinkState>>;
  createLinkAttempt(signal?: AbortSignal): Promise<WithProvenance<LinkAttempt>>;
  linkAttemptStatus(attemptId: string, signal: AbortSignal): Promise<WithProvenance<LinkAttemptStatus>>;
  cancelLinkAttempt(attemptId: string): Promise<void>;
  unlinkWallet(): Promise<void>;

  evidenceIssuance(evidenceId: string, signal?: AbortSignal): Promise<WithProvenance<EvidenceIssuanceState>>;
  requestIssuance(input: { evidenceId: string; idempotencyKey: string }, signal?: AbortSignal): Promise<WithProvenance<IssuanceOffer>>;
  issuanceStatus(issuanceId: string, signal: AbortSignal): Promise<WithProvenance<IssuanceStatus>>;
  cancelIssuance(issuanceId: string): Promise<void>;

  createVerification(input: { disclosure: Disclosure }, signal?: AbortSignal): Promise<WithProvenance<VerificationAttempt>>;
  verificationStatus(verificationId: string, signal: AbortSignal): Promise<WithProvenance<VerificationStatus>>;
  cancelVerification(verificationId: string): Promise<void>;
  checkFile(verificationId: string, input: FileCheckRequest, signal?: AbortSignal): Promise<WithProvenance<FileCheckResult>>;
}

const BASE = "/api/report-vc";
const REQUEST_TIMEOUT_MS = 35_000;

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 60_000) : 2000;
}

/**
 * 봉투를 풀어 데이터와 출처를 돌려준다. 봉투가 아닌 404·501(BE 미배포, Next 404 HTML)은
 * `feature_unavailable`로 번역한다. 그 외 오류는 코드·메시지를 그대로 실어 던진다.
 */
async function decode<T>(response: Response, schema: z.ZodType<T>): Promise<WithProvenance<T>> {
  const result = await decodeResponse(response, schema);
  if ("error" in result) {
    const invalid = result.error.code === "invalid_response";
    if (invalid && (response.status === 404 || response.status === 501 || response.status === 502 || response.status === 503)) {
      throw new ReportVcError(response.status, "feature_unavailable", "리포트 증명서 기능이 아직 준비되지 않았습니다.", retryAfterMs(response));
    }
    throw new ReportVcError(response.status, result.error.code, result.error.message, retryAfterMs(response), "details" in result.error ? result.error.details : undefined);
  }
  return { data: result.data, provenance: result.meta.provenance };
}

type SendInit = Omit<RequestInit, "signal"> & { signal?: AbortSignal };

async function send(path: string, init: SendInit = {}): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
      headers: { accept: "application/json", ...(init.headers ?? {}) },
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ReportVcError(0, "feature_unavailable", "서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
  }
}

function json(body: unknown, extra: Record<string, string> = {}): SendInit {
  return { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) };
}

async function expectNoContent(response: Response): Promise<void> {
  if (response.ok) return;
  // 취소·해제는 멱등이라 이미 끝난 시도에도 204다. 그 외는 봉투 오류로 읽는다.
  await decode(response, pendingSchema);
}

export class HttpReportVcClient implements ReportVcClient {
  async capabilities(signal?: AbortSignal) {
    return decode(await send("/capabilities", { signal }), capabilitiesSchema);
  }

  async walletState(signal?: AbortSignal) {
    return decode(await send("/wallet", { signal }), walletLinkStateSchema);
  }

  async createLinkAttempt(signal?: AbortSignal) {
    return decode(await send("/wallet/link-attempts", { ...json({}), signal }), linkAttemptSchema);
  }

  async linkAttemptStatus(attemptId: string, signal: AbortSignal) {
    const response = await send(`/wallet/link-attempts/${encodeURIComponent(attemptId)}`, { signal });
    if (response.status === 202) return decode(response, pendingSchema);
    const linked = await decode(response, walletLinkStateSchema);
    // 200인데 아직 미연결이라고 하면 계약 위반이다. 대기는 202로만 온다.
    if (linked.data.status !== "linked") throw new ReportVcError(502, "invalid_response", "연결 응답 형태가 계약과 다릅니다.");
    return { data: linked.data, provenance: linked.provenance };
  }

  async cancelLinkAttempt(attemptId: string) {
    await expectNoContent(await send(`/wallet/link-attempts/${encodeURIComponent(attemptId)}/cancel`, json({})));
  }

  async unlinkWallet() {
    await expectNoContent(await send("/wallet", { method: "DELETE" }));
  }

  async evidenceIssuance(evidenceId: string, signal?: AbortSignal) {
    return decode(await send(`/evidence/${encodeURIComponent(evidenceId)}/issuance`, { signal }), evidenceIssuanceStateSchema);
  }

  async requestIssuance(input: { evidenceId: string; idempotencyKey: string }, signal?: AbortSignal) {
    // 식별자만 보낸다. 금액·DID·머클루트는 BE가 저장된 기록과 세션에서 읽는다.
    const response = await send("/issuances", { ...json({ evidenceId: input.evidenceId }, { "idempotency-key": input.idempotencyKey }), signal });
    return decode(response, issuanceOfferSchema);
  }

  async issuanceStatus(issuanceId: string, signal: AbortSignal) {
    const response = await send(`/issuances/${encodeURIComponent(issuanceId)}`, { signal });
    if (response.status === 202) return decode(response, issuanceWaitingSchema);
    return decode(response, issuanceSettledSchema);
  }

  async cancelIssuance(issuanceId: string) {
    await expectNoContent(await send(`/issuances/${encodeURIComponent(issuanceId)}/cancel`, json({})));
  }

  async createVerification(input: { disclosure: Disclosure }, signal?: AbortSignal) {
    return decode(await send("/verifications", { ...json(input), signal }), verificationAttemptSchema);
  }

  async verificationStatus(verificationId: string, signal: AbortSignal) {
    const response = await send(`/verifications/${encodeURIComponent(verificationId)}`, { signal });
    if (response.status === 202) return decode(response, pendingSchema);
    return decode(response, verificationResultSchema);
  }

  async cancelVerification(verificationId: string) {
    await expectNoContent(await send(`/verifications/${encodeURIComponent(verificationId)}/cancel`, json({})));
  }

  async checkFile(verificationId: string, input: FileCheckRequest, signal?: AbortSignal) {
    return decode(await send(`/verifications/${encodeURIComponent(verificationId)}/file-checks`, { ...json(input), signal }), fileCheckResultSchema);
  }
}
