"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wallet/wagmi-config";
import { WalletSessionWatcher } from "@/components/wallet/wallet-session-watcher";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}><WalletSessionWatcher />{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
