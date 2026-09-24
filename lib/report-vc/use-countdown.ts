"use client";

import { useEffect, useState } from "react";

/**
 * 만료 시각까지 남은 초. 1초마다 갱신하고 0 아래로 내려가지 않는다. `expiresAt`이 null이면 0.
 * 효과 안에서 남은 초를 직접 set하지 않고 "지금" 시각만 갱신해 남은 값은 렌더에서 계산한다.
 */
export function useCountdown(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (expiresAt === null) return 0;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

/** 요청 한 번을 대표하는 키. 재시도(네트워크 실패)에는 같은 키를, 새 시도에는 새 키를 쓴다. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
