import type { SessionWalletVerification } from "@/lib/ports/session-snapshot";

/**
 * 등록 방식에 따른 지갑 이름. 주소만 받은 지갑은 브라우저에 꽂혀 있지 않다 — 출처를 그대로 말한다.
 * 등록 방식 배지(미검증·소유 증명됨)는 어느 화면에도 두지 않는다(2026-09-11 결정): 이름이 출처를 말하고, 증빙 여부는 화면이 주장하지 않는다.
 */
export function walletLabel(verification: SessionWalletVerification | string | null): string {
  return verification === "watch_only" ? "등록한 주소" : "브라우저 지갑";
}
