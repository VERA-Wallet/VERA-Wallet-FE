import { ReportVcError } from "@/lib/report-vc/types";

/**
 * 오류를 화면 문구로. 서버 메시지를 그대로 보이면 영어·내부 코드가 새므로, 아는 코드는 한국어로 바꾸고
 * 모르는 코드는 서버 메시지를 쓴다. 비밀값·토큰·VC 원문은 메시지에 실리지 않는다는 전제다(계약 §1.1).
 */
const KNOWN: Record<string, string> = {
  cx_verification_required: "모바일 신분증으로 본인인증한 계정에서 이용할 수 있습니다.",
  cx_reauthentication_required: "최근 본인확인 후 15분이 지났습니다. 안전한 증명서 지갑 연결을 위해 본인확인을 다시 진행해 주세요.",
  anchor_mismatch: "저장된 계산 근거와 체인 기록이 일치하지 않습니다.",
  invalid_issuance_receipt: "발급 결과가 요청한 증명서와 일치하지 않습니다.",
  invalid_provider_response: "증명서 서버의 응답을 확인하지 못했습니다.",
  feature_unavailable: "리포트 증명서 기능이 아직 준비되지 않았습니다.",
  unauthorized: "로그인이 만료되었습니다. 다시 로그인하세요.",
  attempt_not_bound: "이 브라우저에서 시작한 시도가 아닙니다. 처음부터 다시 시작하세요.",
  attempt_not_found: "시도를 찾지 못했습니다. 처음부터 다시 시작하세요.",
  attempt_expired: "QR이 만료되었습니다. 새 QR로 다시 시도하세요.",
  attempt_cancelled: "취소된 시도입니다.",
  did_linked_to_other_account: "이 DID는 이미 다른 계정에 연결되어 있습니다. 그 계정에서 연결을 해제한 뒤 다시 시도하세요.",
  presentation_rejected: "지갑이 제출한 증명을 확인하지 못했습니다. 새 QR로 다시 시도하세요.",
  wallet_already_linked: "이미 연결된 증명서 지갑이 있습니다.",
  wallet_unlinked: "증명서 지갑을 먼저 연결하세요.",
  evidence_not_anchored: "계산 근거가 아직 체인에 기록되지 않았습니다.",
  evidence_not_found: "이 계정의 계산 근거를 찾지 못했습니다.",
  issuance_in_progress: "진행 중인 증명서 지갑 연결 또는 발급 요청이 있습니다. 기존 요청을 완료하거나 취소해 주세요.",
  link_in_progress: "진행 중인 지갑 연결 요청이 있습니다. QR을 열었던 브라우저에서 이어서 진행하거나, 요청 만료 후 다시 시도해 주세요.",
  issuance_not_found: "발급 요청을 찾지 못했습니다.",
  verification_not_found: "검증 시도를 찾지 못했습니다.",
  verification_not_completed: "검증이 끝난 뒤에 파일을 확인할 수 있습니다.",
  disclosure_unsupported: "이 공개 범위는 아직 지원하지 않습니다.",
  origin_rejected: "요청 출처를 확인하지 못했습니다. 페이지를 새로 고친 뒤 다시 시도하세요.",
  rate_limited: "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.",
  verifier_unavailable: "검증 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.",
  issuer_unavailable: "발급 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.",
  invalid_response: "서버 응답을 해석하지 못했습니다.",
  poll_exhausted: "시간 안에 결과를 확인하지 못했습니다. 다시 시도하세요.",
};

export function describeError(error: unknown, fallback = "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요."): string {
  // 네트워크 실패(status 0)는 "기능 준비 중"이 아니라 연결 실패다. 그 문구를 그대로 쓴다.
  if (error instanceof ReportVcError && error.status === 0) return error.message || fallback;
  if (error instanceof ReportVcError) return KNOWN[error.code] ?? (error.message || fallback);
  if (error instanceof DOMException && error.name === "AbortError") return fallback;
  return fallback;
}

/** BE가 없거나 기능이 꺼진 상태. 네트워크 실패(status 0)는 여기 들지 않는다. 그건 재시도할 일이다. */
export function isFeatureUnavailable(error: unknown): boolean {
  return error instanceof ReportVcError && error.code === "feature_unavailable" && error.status !== 0;
}

export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ReportVcError && error.status === 0;
}

export function isSessionExpired(error: unknown): boolean {
  return error instanceof ReportVcError && error.sessionExpired;
}

/** 증명서 이름은 한 곳에서만 정한다. 공식 문서나 보증을 뜻하는 표현은 쓰지 않는다. */
export const CREDENTIAL_NAME = "추정 세금 리포트 증명서";
