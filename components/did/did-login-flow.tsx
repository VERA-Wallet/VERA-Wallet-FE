"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { authClient as compositionAuthClient } from "@/lib/composition-root.client";
import type { AuthClient, DidPresentation } from "@/lib/ports/auth-client";

type Country = "KR" | "US" | "UK" | "DE";
type FlowState = "idle" | "presenting" | "awaiting" | "claimed" | "done";

const COUNTRY_LABEL: Record<Country, string> = { KR: "한국", US: "미국", UK: "영국", DE: "독일" };

// 목 인증 제공자의 왕복을 흉내내는 최소 지연. 사용자를 세우기 위한 연출이 아니라 상태 전이를 보이게 하는 용도다.
const PRESENTATION_DELAY_MS = 600;

export function DidLoginFlow({ authClient = compositionAuthClient }: { authClient?: AuthClient }) {
  const router = useRouter();
  const [country, setCountry] = useState<Country>("KR");
  const [state, setState] = useState<FlowState>("idle");
  const [claim, setClaim] = useState<DidPresentation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "awaiting") return;
    const timer = window.setTimeout(async () => {
      try {
        const claim = await authClient.presentDid({ country });
        setClaim(claim);
        setState("claimed");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "DID 인증을 완료하지 못했습니다.");
        setState("idle");
      }
    }, PRESENTATION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [authClient, country, state]);

  function startPresentation() {
    setError(null);
    setClaim(null);
    setState("presenting");
  }

  return (
    <Card className="space-y-4">
      <div data-surface="did-login" className="flex items-center justify-between">
        <p className="font-semibold text-zinc-900">거주국 선택</p>
        <MockProvenanceChip />
      </div>
      <div className="flex gap-2" role="group" aria-label="거주국 선택">
        {(["KR", "US", "UK", "DE"] as const).map((option) => (
          <button
            key={option}
            aria-pressed={country === option}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold disabled:opacity-60 ${country === option ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-700"}`}
            disabled={state !== "idle"}
            onClick={() => setCountry(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      <p className="text-sm text-zinc-500">{COUNTRY_LABEL[country]} 거주 클레임으로 인증합니다.</p>

      {state === "idle" && (
        <button className="w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white" onClick={startPresentation} type="button">
          QR/딥링크 제시
        </button>
      )}

      {state === "presenting" && (
        <div className="space-y-3">
          <div aria-label="DID QR 코드" className="mx-auto grid h-36 w-36 grid-cols-6 gap-1 rounded-xl bg-white p-2 ring-1 ring-zinc-200">
            {Array.from({ length: 36 }, (_, index) => (
              <span className={index % 3 === 0 || index % 7 === 0 ? "bg-zinc-900" : "bg-zinc-100"} key={index} />
            ))}
          </div>
          <p className="text-center text-sm text-zinc-600">인증 앱에서 QR을 스캔해 제시하세요.</p>
          <button className="w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white" onClick={() => setState("awaiting")} type="button">
            제시 완료
          </button>
          <button className="w-full py-2 text-sm font-medium text-zinc-500" onClick={() => setState("idle")} type="button">
            거주국 다시 선택
          </button>
        </div>
      )}

      {state === "awaiting" && (
        <div className="flex items-center justify-center gap-2 py-2">
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-primary-500" />
          <p aria-live="polite" className="text-sm text-zinc-600">인증 대기 중...</p>
        </div>
      )}

      {state === "claimed" && claim && (
        <div className="space-y-3 rounded-xl bg-zinc-50 p-4">
          <p className="font-medium text-zinc-900">{claim.countryCode} 거주국 클레임이 확인되었습니다.</p>
          <span className="inline-flex rounded-full bg-primary-100 px-2.5 py-1 text-sm font-semibold text-primary-700">{claim.ruleset.badge_label}</span>
          <button
            className="block w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white"
            onClick={() => {
              setState("done");
              router.push("/connect-wallet");
            }}
            type="button"
          >
            지갑 연결로 계속
          </button>
        </div>
      )}

      {state === "done" && <p aria-live="polite" className="text-sm text-zinc-500">지갑 연결 화면으로 이동합니다...</p>}

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button className="ml-2 font-semibold underline" onClick={startPresentation} type="button">다시 시도</button>
        </div>
      )}
    </Card>
  );
}
