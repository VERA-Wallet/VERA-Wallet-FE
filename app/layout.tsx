import type { Metadata, Viewport } from "next";
import { AppNav } from "@/components/ui/app-nav";
import { DisclaimerFooter } from "@/components/ui/disclaimer-footer";
import { ImportCompleteToast } from "@/components/wallet/import-complete-toast";
import { ImportStatusChip } from "@/components/wallet/import-status-chip";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "VeraWallet: 온체인 거래 명세",
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
          <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-zinc-50 shadow-[0_0_0_1px_rgb(24_24_27/0.04)]">
            <div className="flex-1">
              {/* 불러오기 상태는 어느 탭에 있든 보여야 한다 — 지갑 등록이 시작시킨 일이지 대시보드만의 사정이 아니다.
                  진행 중이 아니면 아무것도 그리지 않으므로 평소 화면은 지금과 똑같다. */}
              <ImportStatusChip />
              {children}
            </div>
            {/* 하단 고정 영역: 탭 내비게이션과 면책 문구를 한 블록으로 묶어 서로 겹치지 않게 한다. */}
            <div className="sticky bottom-0 z-20">
              <AppNav />
              <DisclaimerFooter />
            </div>
            {/* 완료 알림은 탭 위에 떠서 한 번만 말하고 물러난다. 끝나는 시점을 사용자가 고르지 않기 때문이다. */}
            <ImportCompleteToast />
          </div>
        </Providers>
      </body>
    </html>
  );
}
