import "client-only";

import { createConfig, http, injected } from "wagmi";
import { arbitrum, base, mainnet, optimism, polygon } from "wagmi/chains";

export const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum, optimism, polygon],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
  },
});
