"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; icon: React.ReactNode };

const items: NavItem[] = [
  {
    href: "/dashboard",
    label: "거래",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/tax",
    label: "룰셋 비교",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 4v16M6 9l-3 5h6l-3-5zM18 6l-3 5h6l-3-5z" strokeLinecap="round" strokeLinejoin="round" />
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
    label: "내보내기",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

// 탭이 아니지만 탭을 띄워야 하는 화면. 플랜은 내보내기 잠금 배너로만 들어오는 곁길이라
// 탭 자리를 차지할 이유가 없지만, 여기서 내비를 감추면 돌아갈 길 없는 막다른 길이 된다.
const sideRoutes = ["/plan"];
const navRoutes = [...items.map((item) => item.href), ...sideRoutes];

export function AppNav() {
  const pathname = usePathname();
  // 온보딩(로그인·지갑 연결) 중에는 탭 이동이 세션 가드에 막히므로 노출하지 않는다.
  if (!navRoutes.some((href) => pathname === href || pathname.startsWith(`${href}/`))) return null;

  return (
    <nav aria-label="주요 화면" data-testid="app-nav" className="border-t border-zinc-200 bg-white/95 backdrop-blur">
      <ul className="grid grid-cols-4">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs font-semibold transition-colors ${
                  active ? "text-primary-600" : "text-zinc-400"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
