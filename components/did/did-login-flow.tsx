"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { authClient as compositionAuthClient } from "@/lib/composition-root.client";
import { closeCxLogin, cxLoginEnabled, openCxLogin, realCxAuthEnabled } from "@/lib/omnione/oacx";
import type { AuthClient, DidPresentation } from "@/lib/ports/auth-client";

type Country = "KR" | "US" | "UK" | "DE";
type FlowState = "idle" | "presenting" | "awaiting" | "claimed" | "done";

const COUNTRY_LABEL: Record<Country, string> = { KR: "한국", US: "미국", UK: "영국", DE: "독일" };

// 목 인증 제공자의 왕복을 흉내내는 최소 지연. 사용자를 세우기 위한 연출이 아니라 상태 전이를 보이게 하는 용도다.
const PRESENTATION_DELAY_MS = 600;
// 본인 확인 성공 표시를 보여주는 시간. 이 뒤에 클릭 없이 목적지로 이동한다(globals.css의 claimed-advance 애니메이션과 값을 맞춘다).
const CLAIMED_AUTO_ADVANCE_MS = 1000;
// 지갑 유무 조회를 기다리는 상한(claimed 진입 기준). 넘기면 조회 실패와 같게 /dashboard로 보낸다.
const SESSION_WAIT_CAP_MS = 3000;

export function DidLoginFlow({ authClient = compositionAuthClient }: { authClient?: AuthClient }) {
  const router = useRouter();
  const [country, setCountry] = useState<Country>("KR");
  const [state, setState] = useState<FlowState>("idle");
  const [claim, setClaim] = useState<DidPresentation | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 취소 뒤 뒤늦게 도착한 표준인증창 콜백이 상태를 되살리지 못하게 시도 세대를 센다.
  const attemptRef = useRef(0);
  // OmniOne CX 표준인증창(가이드북 p.19-25): 설정 시 mock QR 대신 CX 로그인 모달을 연다.
  const cxEnabled = cxLoginEnabled();
  // 거주 국가는 **사용자가 신고하는 값**이다. 신분증은 본인 확인만 한다 — BE는 실제 인증 토큰이 있어도
  // 요청의 `country`를 그대로 세션 거주국으로 쓴다(VERA-Wallet-BE `frontend-auth.controller.ts`).
  // 그래서 이 선택은 어떤 인증 모드에서도 남아 있어야 한다. 실제 인증에서 감추면 모든 사용자가 KR로 굳고
  // 해외 거주자는 바꿀 길이 없다(2026-09-18 독립 검증에서 잡힌 회귀). mock 여부는 출처 칩을 달지만 가른다.
  const mockAuth = !realCxAuthEnabled();

  useEffect(() => {
    // mock 전용 대기 전이. CX 모드에서는 openCxLogin → presentDid가 직접 상태를 밀고 간다.
    if (state !== "awaiting" || cxEnabled) return;
    const timer = window.setTimeout(async () => {
      try {
        const claim = await authClient.presentDid({ country });
        setClaim(claim);
        setState("claimed");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "본인 확인을 완료하지 못했습니다.");
        setState("idle");
      }
    }, PRESENTATION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [authClient, country, cxEnabled, state]);

  useEffect(() => {
    // CX 모달은 presenting 진입 후 마운트 지점(#oacxDiv)이 DOM에 생긴 다음 열어야 한다.
    if (!cxEnabled || state !== "presenting") return;
    const attempt = ++attemptRef.current;
    void (async () => {
      try {
        const cxToken = await openCxLogin();
        if (attemptRef.current !== attempt) return;
        setState("awaiting");
        const claim = await authClient.presentDid({ country, cxToken });
        if (attemptRef.current !== attempt) return;
        setClaim(claim);
        setState("claimed");
      } catch (cause) {
        if (attemptRef.current !== attempt) return;
        setError(cause instanceof Error ? cause.message : "모바일신분증 인증을 완료하지 못했습니다.");
        setState("idle");
      }
    })();
    // presenting을 벗어나거나(취소·성공 전이) 언마운트되면 오버레이 iframe을 걷어낸다.
    return () => closeCxLogin();
  }, [authClient, country, cxEnabled, state]);

  useEffect(() => {
    // 본인 확인 성공 뒤 클릭 없이 목적지로 이동한다. 지갑 유무는 claimed 진입과 동시에 바로 조회를 시작해
    // 1초 대기와 네트워크 왕복을 겹치게 한다. 세션 조회가 실패해도 로그인 자체는 끝난 상태이므로
    // 빈 요약을 보여주는 /dashboard로 보낸다(그 화면이 지갑 없는 세션을 빈 요약으로 처리한다).
    // 조회가 1초보다 늦으면 **기다린다** — 지갑 없는 첫 사용자를 빈 요약에 잘못 떨어뜨리는 것보다 몇백 ms 더
    // 머무는 편이 낫다. 다만 끝없이 기다리지는 않는다: 상한을 넘기면 /dashboard로 보낸다(실패와 같은 폴백).
    // 상한이 없으면 응답이 오지 않는 조회 하나가 사용자를 성공 화면에 가둔다.
    if (state !== "claimed" || !claim) return;
    let cancelled = false;
    let capTimer = 0;
    const session = authClient
      .getSession()
      .then((result) => (result.walletAddress ? "/dashboard" : "/connect-wallet"))
      .catch(() => "/dashboard");
    const cap = new Promise<string>((resolve) => {
      capTimer = window.setTimeout(() => resolve("/dashboard"), SESSION_WAIT_CAP_MS);
    });
    const destination = Promise.race([session, cap]);
    const timer = window.setTimeout(() => {
      void destination.then((path) => {
        if (cancelled) return;
        setState("done");
        router.push(path);
      });
    }, CLAIMED_AUTO_ADVANCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(capTimer);
    };
  }, [authClient, claim, router, state]);

  function startPresentation() {
    setError(null);
    setClaim(null);
    setState("presenting");
  }

  function cancelPresentation() {
    attemptRef.current += 1;
    closeCxLogin();
    setState("idle");
  }

  return (
    <Card className="space-y-4">
      <div data-surface="did-login" className="space-y-4">
        {state === "idle" && (
          <button className="w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white" onClick={startPresentation} type="button">
            {cxEnabled ? "모바일신분증으로 시작하기" : "QR/딥링크 제시"}
          </button>
        )}

        {state === "presenting" && cxEnabled && (
          <div className="space-y-3">
            {/* CX 표준인증창은 전면 오버레이 iframe(oacx.ts)에 격리 렌더된다 — 여기엔 안내/취소만 둔다. */}
            <p aria-live="polite" className="text-center text-sm text-zinc-600">
              OmniOne CX 인증창에서 모바일신분증을 제출하세요. 데스크톱은 QR 스캔, 모바일은 앱 이동으로 진행됩니다.
            </p>
            <button className="w-full py-2 text-sm font-medium text-zinc-500" onClick={cancelPresentation} type="button">
              취소하고 돌아가기
            </button>
          </div>
        )}

        {state === "presenting" && !cxEnabled && (
          <div className="space-y-3">
            <div aria-label="본인 확인 QR 코드" className="mx-auto grid h-36 w-36 grid-cols-6 gap-1 rounded-xl bg-white p-2 ring-1 ring-zinc-200">
              {Array.from({ length: 36 }, (_, index) => (
                <span className={index % 3 === 0 || index % 7 === 0 ? "bg-zinc-900" : "bg-zinc-100"} key={index} />
              ))}
            </div>
            <p className="text-center text-sm text-zinc-600">인증 앱에서 QR을 스캔해 제시하세요.</p>
            <button className="w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white" onClick={() => setState("awaiting")} type="button">
              제시 완료
            </button>
            <button className="w-full py-2 text-sm font-medium text-zinc-500" onClick={cancelPresentation} type="button">
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
          <div role="status" aria-live="polite" className="space-y-3 rounded-xl bg-zinc-50 p-4">
            <div className="flex items-center gap-2">
              <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-primary-500" />
              <p className="font-medium text-zinc-900">본인 확인이 끝났어요</p>
            </div>
            <p className="text-sm text-zinc-600">거주 국가 {COUNTRY_LABEL[claim.countryCode]} 기준으로 계산할게요</p>
            {/* 진행률이 아니라 "곧 넘어간다"는 사실만 말한다. 실제 대기 시간은 위 useEffect의 setTimeout이 정한다. */}
            <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-zinc-200">
              <div className="h-full w-full origin-left scale-x-0 rounded-full bg-primary-500 animate-claimed-advance motion-reduce:scale-x-100 motion-reduce:animate-none" />
            </div>
          </div>
        )}

        {state === "done" && <p aria-live="polite" className="text-sm text-zinc-500">이동하고 있어요...</p>}

        {error && (
          <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
            <button className="ml-2 font-semibold underline" onClick={startPresentation} type="button">다시 시도</button>
          </div>
        )}

        {/* 거주 국가 줄은 주 버튼 **아래**, 작게, 접힌 채로. 대부분은 기본값(한국) 그대로 지나가므로 첫 입력으로
            세우지 않는다 — 다만 고를 길은 늘 있어야 한다. 접힌 줄이 지금 값을 말해 주므로 열지 않아도 무엇으로
            계산될지 안다. */}
        <details className="text-xs text-zinc-500">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2">
              <span>
                거주 국가: <span className="font-semibold text-zinc-700">{COUNTRY_LABEL[country]}</span> · 바꾸기
              </span>
              {mockAuth ? <MockProvenanceChip /> : null}
            </summary>
            <div className="mt-2 space-y-2">
              <div className="flex gap-2" role="group" aria-label="거주국 선택">
                {(["KR", "US", "UK", "DE"] as const).map((option) => (
                  <button
                    key={option}
                    aria-pressed={country === option}
                    className={`min-h-11 flex-1 rounded-full px-3 py-2 text-sm font-semibold disabled:opacity-60 ${country === option ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-700"}`}
                    disabled={state !== "idle"}
                    onClick={() => setCountry(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-500">{COUNTRY_LABEL[country]} 규칙으로 계산해요. 모바일신분증은 본인 확인에만 쓰고, 거주 국가는 여기서 고른 값을 따라요.</p>
            </div>
        </details>
      </div>
    </Card>
  );
}
