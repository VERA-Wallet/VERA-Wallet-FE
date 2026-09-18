import type { Metadata, Viewport } from "next";
import { AppNav } from "@/components/ui/app-nav";
import { DisclaimerFooter } from "@/components/ui/disclaimer-footer";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "VeraWallet — 온체인 거래 명세",
  description: "VeraWallet 온체인 거래 명세",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fafafa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <Providers>
          {/* 폰 폭 셸은 화면 전용이다. 종이에서 max-w-md를 유지하면 A4 한가운데 좁은 칼럼만 찍힌다. */}
          <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-zinc-50 shadow-[0_0_0_1px_rgb(24_24_27/0.04)] print:min-h-0 print:max-w-none print:bg-white">
            <div className="flex-1">{children}</div>
            {/* 하단 고정 영역: 탭 내비게이션과 면책 문구를 한 블록으로 묶어 서로 겹치지 않게 한다. */}
            <div data-print-hide className="sticky bottom-0 z-20">
              <AppNav />
              <DisclaimerFooter />
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
