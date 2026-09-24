"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEventSummary } from "@/lib/queries/events";

type NavItem = { href: string; label: string; icon: React.ReactNode };

// 세금 탭은 따로 없다 — 레퍼런스(Koinly·Summ) 모두 세금 전용 화면이 없고, 계산·다운로드가 리포트
// 한 화면에 모여 있다. 예상 부담은 이제 리포트(`/export`)가 말한다.
const items: NavItem[] = [
  {
    href: "/dashboard",
    label: "요약",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 19V10M10 19V5M16 19v-7M21 19H3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/transactions",
    label: "거래",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/wallets",
    label: "지갑",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" strokeLinejoin="round" />
        <path d="M15.5 13.2h.01" strokeLinecap="round" strokeWidth="2.4" />
      </svg>
    ),
  },
  {
    href: "/export",
    label: "리포트",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "설정",
    icon: <Settings aria-hidden="true" className="h-5 w-5" />,
  },
];

// 플랜 화면에서도 주요 화면으로 돌아갈 수 있도록 내비게이션을 유지한다.
const sideRoutes = ["/plan"];
const navRoutes = [...items.map((item) => item.href), ...sideRoutes];

export function AppNav() {
  const pathname = usePathname();
  const visible = navRoutes.some((href) => pathname === href || pathname.startsWith(`${href}/`));
  // 확인 필요 배지는 내비가 실제로 보일 때만 조회한다(useEventSummary의 enabled 가드) —
  // 로그인·온보딩처럼 내비가 없는 화면에서 불필요한 요약 호출을 만들지 않는다.
  const summary = useEventSummary(visible);
  // 로딩 중·조회 실패·지갑 미연결(요약 404)은 모두 summary.data가 없다 — 그 상태에선 배지를 그리지 않는다.
  // 배지는 **있다/없다**만 말하고 숫자는 말하지 않는다. 요약의 pendingReviewCount는 다리(leg) 단위이고
  // 거래 탭의 "확인 필요 N"은 스왑·브릿지를 한 줄로 묶은 행 단위라 두 수가 다르다(실측 5,549 대 3,433) —
  // 숫자를 달면 한 앱이 같은 것을 두 값으로 말하게 된다. 건수는 거래 탭 한 곳이 말한다.
  const hasPendingReview = (summary.data?.pendingReviewCount ?? 0) > 0;

  // 온보딩(로그인·지갑 연결) 중에는 탭 이동이 세션 가드에 막히므로 노출하지 않는다.
  if (!visible) return null;

  return (
    <nav aria-label="주요 화면" data-testid="app-nav" className="border-t border-zinc-200 bg-white/95 backdrop-blur">
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const badge = item.href === "/transactions" && hasPendingReview;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={badge ? `${item.label} · 확인 필요 있음` : undefined}
                className={`flex flex-col items-center gap-1 whitespace-nowrap py-2.5 text-xs font-semibold transition-colors ${
                  active ? "text-primary-600" : "text-zinc-400"
                }`}
              >
                <span className="relative">
                  {item.icon}
                  {badge ? (
                    <span
                      aria-hidden="true"
                      data-badge="pending-review"
                      className="absolute -right-1 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-white"
                    />
                  ) : null}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
