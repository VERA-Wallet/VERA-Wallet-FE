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
    href: "/export",
    label: "내보내기",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const hrefs = items.map((item) => item.href);

export function AppNav() {
  const pathname = usePathname();
  // 온보딩(로그인·지갑 연결) 중에는 탭 이동이 세션 가드에 막히므로 노출하지 않는다.
  if (!hrefs.some((href) => pathname === href || pathname.startsWith(`${href}/`))) return null;

  return (
    <nav aria-label="주요 화면" data-testid="app-nav" className="border-t border-zinc-200 bg-white/95 backdrop-blur">
      <ul className="grid grid-cols-3">
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
