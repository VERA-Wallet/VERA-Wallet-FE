"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { authClient as compositionAuthClient } from "@/lib/composition-root.client";
import type { AuthClient } from "@/lib/ports/auth-client";
import { PLANS, usePlan } from "@/lib/plan/use-plan";
import { useHideBalances } from "@/lib/privacy/use-hide-balances";

/**
 * 설정 화면 — 1차 범위는 **이미 있는 화면·상태를 모아 보여주는 것**뿐이다.
 *
 * 거주국·기준통화·원가계산법은 여기 없다: 거주국은 DID 클레임에서 이미 확정되고,
 * 원가계산법은 한국 룰셋 교체(P0)와 얽혀 있어 계약 없이 먼저 손대면 세금 화면과
 * 서로 다른 값을 말하게 된다(계획 `summary-transactions-tab-split.md` 결정 3).
 */
export function SettingsView({ authClient = compositionAuthClient }: { authClient?: AuthClient }) {
  const router = useRouter();
  const { plan } = usePlan();
  const [hideBalances, setHideBalances] = useHideBalances();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  // PLANS 카탈로그에는 "free"도 들어 있다 — 무료 문구를 따로 하드코딩하면 이름이 두 곳에서 갈릴 수 있다.
  const planName = PLANS.find((definition) => definition.id === (plan?.tier ?? "free"))!.name;

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await authClient.logout();
      router.push("/login");
    } catch (error) {
      // 세션 종료 자체가 실패했다면 로그인 화면으로 조용히 보내지 않는다 — 사용자가 다시 시도할 수 있어야 한다.
      setLogoutError(error instanceof Error ? error.message : "로그아웃에 실패했습니다.");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main data-surface="settings" className="min-h-dvh px-5 py-8">
      <div className="-ml-2 flex items-center gap-2">
        <Link href="/dashboard" className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-200">
          <ChevronLeft aria-hidden="true" className="size-[22px]" strokeWidth={1.8} />
          <span className="sr-only">← 요약</span>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">설정</h1>
      </div>

      <section aria-label="플랜" className="mt-8">
        <p className="mb-2 text-sm font-semibold text-zinc-500">플랜</p>
        <div className="divide-y divide-zinc-200 rounded-card border border-zinc-200 bg-zinc-50">
          <Link href="/plan" className="flex min-h-11 items-center justify-between gap-3 px-4">
            <span className="text-sm font-medium text-zinc-900">현재 플랜</span>
            <span className="flex items-center gap-1 text-sm text-zinc-500">
              {planName}
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </span>
          </Link>
        </div>
      </section>

      <section aria-label="화면" className="mt-6">
        <p className="mb-2 text-sm font-semibold text-zinc-500">화면</p>
        <div className="divide-y divide-zinc-200 rounded-card border border-zinc-200 bg-zinc-50">
          <div className="flex min-h-11 items-center justify-between gap-3 px-4">
            <span className="text-sm font-medium text-zinc-900">금액 가리기로 시작</span>
            {/* 이 토글은 대시보드의 "금액 가리기"와 같은 저장값을 공유한다(lib/privacy/use-hide-balances.ts) —
                이미 저장소에 영속되는 값이라 여기서 따로 "기본값"을 복제해 들고 있을 필요가 없다. */}
            <button
              type="button"
              role="switch"
              aria-checked={hideBalances}
              aria-label="금액 가리기로 시작"
              className={`rounded-full px-3 py-1 text-xs font-semibold ${hideBalances ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-600"}`}
              onClick={() => setHideBalances(!hideBalances)}
            >
              {hideBalances ? "켜짐" : "꺼짐"}
            </button>
          </div>
          <Link href="/transactions?spam=1" className="flex min-h-11 items-center justify-between gap-3 px-4">
            <span className="text-sm font-medium text-zinc-900">스팸 거래 보기</span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 text-zinc-400" />
          </Link>
        </div>
      </section>

      <section aria-label="계정" className="mt-6">
        <p className="mb-2 text-sm font-semibold text-zinc-500">계정</p>
        <div className="divide-y divide-zinc-200 rounded-card border border-zinc-200 bg-zinc-50">
          <button
            type="button"
            disabled={loggingOut}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left disabled:opacity-60"
            onClick={() => void handleLogout()}
          >
            <span className="text-sm font-medium text-red-600">{loggingOut ? "로그아웃 중…" : "로그아웃"}</span>
          </button>
        </div>
        {logoutError ? <p className="mt-2 text-sm text-red-600">{logoutError}</p> : null}
      </section>
    </main>
  );
}
