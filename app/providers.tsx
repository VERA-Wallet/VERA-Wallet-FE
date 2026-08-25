"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wallet/wagmi-config";
import { WalletSessionWatcher } from "@/components/wallet/wallet-session-watcher";
import { TaxYearProvider } from "@/lib/tax/tax-year-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      {/* 귀속연도는 화면을 옮겨도 유지돼야 한다 — 껍데기에 얹어 세금·대시보드·플랜이 한 소스를 구독한다. */}
      <QueryClientProvider client={queryClient}><WalletSessionWatcher /><TaxYearProvider>{children}</TaxYearProvider></QueryClientProvider>
    </WagmiProvider>
  );
}
