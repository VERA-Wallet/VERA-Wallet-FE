import { ReportVcError } from "@/lib/report-vc/types";

/**
 * 오류를 화면 문구로. 서버 메시지를 그대로 보이면 영어·내부 코드가 새므로, 아는 코드는 한국어로 바꾸고
 * 모르는 코드는 서버 메시지를 쓴다. 비밀값·토큰·VC 원문은 메시지에 실리지 않는다는 전제다(계약 §1.1).
 */
const KNOWN: Record<string, string> = {
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
  issuance_in_progress: "같은 근거로 진행 중인 발급이 있습니다.",
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
