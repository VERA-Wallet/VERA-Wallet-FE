import "client-only";

import { createConfig, http, injected } from "wagmi";
import { metaMask } from "wagmi/connectors";
import { arbitrum, base, mainnet, optimism, polygon } from "wagmi/chains";

export const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum, optimism, polygon],
  connectors: [injected(), metaMask({ dapp: { name: "VeraWallet" }, mobile: { useDeeplink: true }, debug: false })],
  ssr: true,
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
  },
});
