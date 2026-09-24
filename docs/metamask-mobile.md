# MetaMask mobile signing

The SIWE screen offers **MetaMask로 연결** (MetaMask Connect EVM via Wagmi) and the existing **지갑 연결하기** (injected browser wallets). No WalletConnect project ID is required; this integration uses MetaMask's own relay, not WalletConnect. SDK debug logging is disabled. SDK analytics follow the upstream Wagmi connector defaults (8.0.26 overrides the supplied analytics option). The SDK handles extension discovery, mobile deep links and persisted wallet connections. Wagmi uses the existing public chain transports for read-only requests; no server API key is copied into the client.

Connection approval only exposes the selected address. The user must then press **서명하고 추가** to request the server-issued SIWE challenge and approve its `personal_sign` request. Existing domain/nonce/account validation and CX session cookies remain unchanged. App switching keeps the original browser's session; this is not a link that moves the site into MetaMask's separate in-app browser. No transaction or token approval request is sent by this flow.

On mobile, approve in MetaMask then return to the original browser tab if the OS does not switch back automatically. Do not close/reload that tab while a signature is pending. If it is reloaded, the wallet can reconnect but a fresh server challenge and explicit signature are required; we do not persist pending signatures/nonces in URLs or local storage. Lock-screen push notifications are not a feature implemented by VeraWallet.

Validation: component tests cover no injected provider, pending connection, rejection/retry and late approval after leaving; existing delayed signing, stale account/chain and SIWE error tests remain applicable. Connector tests cover explicit SDK selection, browser fallback and restored MetaMask connection. Real Android Chrome / iOS Safari + MetaMask app approval and return must be checked on devices; browser emulation cannot approve in a native wallet.

Reference: https://docs.metamask.io/metamask-connect/evm/quickstart/wagmi/

Browser smoke: isolated mock session in emulated Pixel 7 Chrome, with no injected provider, dispatched a MetaMask native connect link and remained pending without page errors. No real MetaMask approval was performed. Full unit/UI suite: 1,382 tests passed. Production build passed.
