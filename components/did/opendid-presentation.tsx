"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { OpenDidError, openDidClient, type DidCountry, type DidOffer } from "@/lib/opendid/client";
import type { DidPresentation } from "@/lib/ports/auth-client";
import { serializeOpenDidQr } from "@/lib/opendid/qr";

export function OpenDidPresentation({ offer, country, onVerified, onError, onCancel }: {
  offer: DidOffer; country: DidCountry;
  onVerified: (claim: DidPresentation) => void; onError: (message: string) => void; onCancel: () => void;
}) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const expires = Date.parse(offer.expiresAt);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const fail = (message: string) => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      onError(message);
    };
    const tick = () => {
      setRemaining(Math.max(0, Math.ceil((expires - Date.now()) / 1000)));
      if (Date.now() >= expires) fail("인증 시간이 만료되었습니다. 새 QR로 다시 시도하세요.");
    };
    tick();
    const countdown = setInterval(tick, 1000);
    async function poll() {
      if (stopped) return;
      let delay = offer.pollAfterMs;
      try {
        const result = await openDidClient.present(country, offer.offerId,
          AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]));
        if (stopped) return;
        if (Date.now() >= expires) { tick(); return; }
        if (result.status === "verified") {
          stopped = true;
          clearInterval(countdown);
          onVerified(result.claim);
          return;
        }
        delay = result.retryAfterMs;
      } catch (cause) {
        if (stopped) return;
        if (cause instanceof OpenDidError && (cause.status === 429 || cause.status === 503 || cause.code === "verification_in_progress")) {
          delay = cause.retryAfterMs;
        } else {
          fail(cause instanceof OpenDidError && cause.status === 410
            ? "인증 시간이 만료되었습니다. 새 QR로 다시 시도하세요."
            : "본인 확인을 완료하지 못했습니다. 새 QR로 다시 시도하세요.");
          return;
        }
      }
      if (!stopped) timer = setTimeout(poll, delay);
    }
    if (!stopped) timer = setTimeout(poll, offer.pollAfterMs);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); clearInterval(countdown); };
  }, [offer, country, onVerified, onError]);
  return <div className="space-y-3 text-center">
    <div className="mx-auto w-fit rounded-xl bg-white p-4">
      <QRCodeSVG value={serializeOpenDidQr(offer)} size={240} marginSize={4} title="Open DID 본인 확인 QR 코드" />
    </div>
    <p className="text-sm text-zinc-600">Open DID 지갑 앱으로 QR을 스캔하고 정보 제공을 승인하세요.</p>
    <p role="status" className="text-sm text-zinc-500">인증 대기 중 · 남은 시간 {remaining}초</p>
    <button type="button" className="w-full py-2 text-sm font-medium text-zinc-500" onClick={onCancel}>취소하고 돌아가기</button>
  </div>;
}
