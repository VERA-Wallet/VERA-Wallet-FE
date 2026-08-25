import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthClient } from "@/lib/ports/auth-client";

const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/composition-root.client", () => ({
  authClient: { requestNonce: vi.fn(), verify: vi.fn(), presentDid: vi.fn(), logout: vi.fn(), getSession: vi.fn() },
}));

import { WalletHome } from "@/components/wallet/wallet-home";
import { WalletsView } from "@/components/wallet/wallets-view";

const WALLET = "0x1111111111111111111111111111111111111111";

function renderConnected(authClient?: AuthClient) {
  return render(<WalletHome walletAddress={WALLET} chainId={1} authClient={authClient} />);
}

beforeEach(() => {
  nav.push.mockReset();
});

describe("wallet home (portfolio + account)", () => {
  it("renders ETH/USDT/USDC with price, amount, and value, sorted by value descending", () => {
    const { container } = renderConnected();

    const rows = container.querySelectorAll('[data-surface="holding-row"]');
    expect(rows).toHaveLength(3);
    // Sorted by USD value descending: ETH (2,400) > USDT (850) > USDC (500).
    expect(rows[0]).toHaveTextContent("ETH");
    expect(rows[0]).toHaveTextContent("US$3,200.00"); // unit price
    expect(rows[0]).toHaveTextContent("US$2,400.00"); // value
    expect(rows[0]).toHaveTextContent("0.75 ETH"); // amount
    expect(rows[1]).toHaveTextContent("USDT");
    expect(rows[2]).toHaveTextContent("USDC");
    // Each token renders its inlined logo mark.
    expect(container.querySelector('[data-token-icon="ETH"]')).not.toBeNull();
    expect(container.querySelector('[data-token-icon="USDT"]')).not.toBeNull();
    expect(container.querySelector('[data-token-icon="USDC"]')).not.toBeNull();
    // Portfolio total.
    expect(screen.getByText("US$28,050.00")).toBeInTheDocument();
    // No 검증됨 badge anywhere.
    expect(screen.queryByText("검증됨")).toBeNull();
  });

  it("shows per-holding gain/return with brand receive/dispose tones", () => {
    const { container } = renderConnected();
    const rows = container.querySelectorAll('[data-surface="holding-row"]');

    // ETH: 2,400 − 1,800 cost = +US$600.00 (+33.33%), a gain → brand receive (green).
    expect(rows[0]).toHaveTextContent("+US$600.00");
    expect(rows[0]).toHaveTextContent("+33.33%");
    expect(rows[0].querySelector(".text-receive")).not.toBeNull();
    // USDT: 850 − 900 cost = -US$50.00 (-5.56%), a loss → brand dispose (red).
    expect(rows[1]).toHaveTextContent("-US$50.00");
    expect(rows[1]).toHaveTextContent("-5.56%");
    expect(rows[1].querySelector(".text-dispose")).not.toBeNull();
  });

  it("summarizes the token holdings value, gain, and return at the top of the token tab", () => {
    const { container } = renderConnected();
    const summary = container.querySelector('[data-surface="wallet-holdings-summary"]')!;
    expect(summary).not.toBeNull();
    // value 3,750 − cost 3,180 = +US$570.00 (+17.92%).
    expect(summary).toHaveTextContent("US$3,750.00");
    expect(summary).toHaveTextContent("평가손익");
    expect(summary).toHaveTextContent("+US$570.00");
    expect(summary).toHaveTextContent("+17.92%");
    expect(summary.querySelector(".text-receive")).not.toBeNull();
  });

  it("copies the wallet address to the clipboard", async () => {
    const user = userEvent.setup();
    renderConnected();

    await user.click(screen.getByRole("button", { name: "주소 복사" }));
    expect(await screen.findByText("복사됨")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(WALLET);
  });

  it("shows the NFT portfolio grid under the NFT tab", async () => {
    const user = userEvent.setup();
    const { container } = renderConnected();

    await user.click(screen.getByRole("tab", { name: "NFT" }));
    const cards = container.querySelectorAll('[data-surface="nft-card"]');
    expect(cards).toHaveLength(4);
    // Sorted by floor value desc: BAYC > Pudgy > Azuki > Doodles.
    expect(cards[0]).toHaveTextContent("BAYC");
    expect(cards[0]).toHaveTextContent("Bored Ape Yacht Club");
    expect(cards[0]).toHaveTextContent("US$8,000.00");
    // Token rows are gone on the NFT tab.
    expect(container.querySelectorAll('[data-surface="holding-row"]')).toHaveLength(0);
  });

  it("shows DeFi positions under the 디파이 tab", async () => {
    const user = userEvent.setup();
    const { container } = renderConnected();

    await user.click(screen.getByRole("tab", { name: "디파이" }));
    const rows = container.querySelectorAll('[data-surface="defi-row"]');
    expect(rows).toHaveLength(3);
    // Sorted by value desc: Uniswap v3 > Lido > Aave v3.
    expect(rows[0]).toHaveTextContent("Uniswap v3");
    expect(rows[0]).toHaveTextContent("US$3,200.00");
    expect(rows[1]).toHaveTextContent("스테이킹");
    expect(rows[1]).toHaveTextContent("APY 3.2%");
  });

  it("filters holdings by network", async () => {
    const user = userEvent.setup();
    const { container } = renderConnected();
    expect(container.querySelectorAll('[data-surface="holding-row"]')).toHaveLength(3);

    // 137 = Polygon, which only holds USDT in the demo set.
    await user.selectOptions(screen.getByRole("combobox"), "137");
    const rows = container.querySelectorAll('[data-surface="holding-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("USDT");
  });

  it("opens the 계정 screen from the account button, then returns via 뒤로", async () => {
    const user = userEvent.setup();
    renderConnected();

    await user.click(screen.getByRole("button", { name: /계정 열기/ }));
    expect(screen.getByRole("heading", { name: "계정" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "뒤로" })).toBeInTheDocument();
    expect(screen.getByText(/다시 인증/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다른 지갑 연결하기" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "뒤로" }));
    expect(screen.getByRole("button", { name: /계정 열기/ })).toBeInTheDocument();
  });

  it("connecting another wallet ends the session and routes to /login", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderConnected({ logout } as unknown as AuthClient);

    await user.click(screen.getByRole("button", { name: /계정 열기/ }));
    await user.click(screen.getByRole("button", { name: "다른 지갑 연결하기" }));

    expect(logout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/login"));
  });

  it("keeps the connect CTA when no wallet is bound", () => {
    render(<WalletsView walletAddress={null} chainId={null} />);
    expect(screen.getByText("아직 연결된 지갑이 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "지갑 연결하기" })).toBeInTheDocument();
  });
});
