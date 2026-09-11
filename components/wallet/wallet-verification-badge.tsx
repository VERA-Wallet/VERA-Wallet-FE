import type { SessionWalletVerification } from "@/lib/ports/session-snapshot";

/**
 * 등록 방식 배지. 주소만 받은 지갑에 소유가 확인된 것처럼 도장을 찍으면 사용자는 증빙이 되는 줄 알고 그 자료를 쓰게 된다.
 * 체크 표시는 확인됐다는 뜻이라 미검증에는 붙이지 않는다.
 */
export function WalletVerificationBadge({ verification }: { verification: SessionWalletVerification | string | null }) {
  const badge = verification === "watch_only"
    ? { label: "미검증", className: "bg-amber-100 text-amber-700", check: false }
    : verification === "siwe"
      ? { label: "소유 증명됨", className: "bg-emerald-100 text-emerald-700", check: true }
      : { label: "연결됨", className: "bg-emerald-100 text-emerald-700", check: true };
  return (
    <span data-surface="wallet-verification" className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
      {badge.check ? (
        <svg aria-hidden="true" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      {badge.label}
    </span>
  );
}

/** 등록 방식에 따른 지갑 이름. 주소만 받은 지갑은 브라우저에 꽂혀 있지 않다 — 출처를 그대로 말한다. */
export function walletLabel(verification: SessionWalletVerification | string | null): string {
  return verification === "watch_only" ? "등록한 주소" : "브라우저 지갑";
}
