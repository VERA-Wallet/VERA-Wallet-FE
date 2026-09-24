"use client";

import { Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useCountdown } from "@/lib/report-vc/use-countdown";

/**
 * 리포트 VC 화면들이 공유하는 작은 조각. 기존 디자인(`components/ui/*`, 로그인 흐름)의 색·간격을 따른다.
 */

const TONE = {
  info: "border-zinc-200 bg-zinc-50 text-zinc-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-800",
} as const;

/** 상태·오류 한 덩어리. 오류는 `alert`, 나머지는 `status`로 읽힌다. */
export function Notice({ tone, surface, children }: { tone: keyof typeof TONE; surface?: string; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-surface={surface}
      className={`rounded-card border p-3 text-sm leading-6 wrap-anywhere ${TONE[tone]}`}
    >
      {children}
    </div>
  );
}

export const PRIMARY_BUTTON = "flex min-h-11 w-full items-center justify-center rounded-xl bg-primary-500 px-4 py-3 font-semibold text-white disabled:opacity-50";
export const SECONDARY_BUTTON = "flex min-h-11 w-full items-center justify-center rounded-xl border border-zinc-300 px-4 py-3 font-semibold text-zinc-700 disabled:opacity-50";
export const QUIET_BUTTON = "flex min-h-11 w-full items-center justify-center py-2 text-sm font-medium text-zinc-500";

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-primary-500" />
      <p aria-live="polite" role="status" className="text-sm text-zinc-600">{label}</p>
    </div>
  );
}

/**
 * QR 하나와 남은 시간, 취소. 만료 판정은 여기서 하지 않는다(폴링이 멈추고 호출부가 상태를 바꾼다).
 * 폭은 부모를 넘지 않는다: SVG는 고정 픽셀 대신 너비 100%로 그려 좁은 화면에서 잘리지 않는다.
 */
export function QrPanel({ text, title, hint, expiresAt, onCancel, cancelLabel = "취소하고 돌아가기" }: {
  text: string;
  title: string;
  hint: string;
  expiresAt: string;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const remaining = useCountdown(expiresAt);
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto w-full max-w-[240px] rounded-xl bg-white p-3 ring-1 ring-zinc-200">
        <QRCodeSVG value={text} size={216} marginSize={2} title={title} style={{ width: "100%", height: "auto" }} />
      </div>
      <p className="text-sm text-zinc-600">{hint}</p>
      <p role="status" aria-live="polite" className="text-sm text-zinc-500">폰 제출 대기 중 · 남은 시간 {remaining}초</p>
      <button type="button" className={QUIET_BUTTON} onClick={onCancel}>{cancelLabel}</button>
    </div>
  );
}

/** `did:omn:abcd…wxyz`. 긴 DID가 한 줄을 넘기지 않게 앞뒤만 남긴다. */
export function shortDid(did: string): string {
  const separator = did.lastIndexOf(":");
  const prefix = separator === -1 ? "" : did.slice(0, separator + 1);
  const id = separator === -1 ? did : did.slice(separator + 1);
  if (id.length <= 14) return did;
  return `${prefix}${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

/**
 * 값 하나를 축약해 보이고 전문을 복사한다. 클립보드가 없는 환경에서는 전문을 그대로 보인다(줄바꿈 허용).
 * 서버 스냅샷은 "복사 불가"로 두어 hydration이 갈리지 않게 한다(`components/report/downloads.tsx#CopyRow`와 같은 이유).
 */
export function CopyValue({ label, value, display = shortHash }: { label: string; value: string; display?: (value: string) => string }) {
  const [copied, setCopied] = useState(false);
  const canCopy = useSyncExternalStore(() => () => {}, () => typeof navigator.clipboard?.writeText === "function", () => false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-sm text-zinc-500">{label}</span>
      {canCopy ? (
        <button
          type="button"
          aria-label={`${label} 복사`}
          title={value}
          className="inline-flex min-h-11 max-w-full items-center gap-1.5 truncate font-mono text-xs text-primary-600 underline"
          onClick={() => { void navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => {}); }}
        >
          <span className="truncate">{copied ? "복사됨" : display(value)}</span>
          <Copy aria-hidden className="size-3.5 shrink-0" strokeWidth={2.2} />
        </button>
      ) : (
        <span className="min-w-0 break-all text-right font-mono text-xs text-zinc-800">{value}</span>
      )}
    </div>
  );
}

/** 세션이 끝났을 때의 안내. 이 기능은 새 로그인 토큰을 만들지 않으므로 기존 로그인 화면으로 보낸다. */
export function SessionExpiredNotice({ surface }: { surface?: string }) {
  return (
    <Notice tone="error" surface={surface}>
      로그인이 만료되어 진행을 멈췄습니다.{" "}
      <a href="/login" className="font-semibold underline">다시 로그인</a>한 뒤 이어서 진행하세요.
    </Notice>
  );
}
