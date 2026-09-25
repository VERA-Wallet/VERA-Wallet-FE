import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioHoldingsDTO, RegisteredWalletsDTO } from "@/lib/http/dto";
import type { Provenance } from "@/lib/http/envelope";

const ports = vi.hoisted(() => ({ getHoldings: vi.fn(), getWallets: vi.fn() }));
vi.mock("@/lib/composition-root.client", () => ({
  holdingsProvider: { getHoldings: ports.getHoldings },
  walletsProvider: { getWallets: ports.getWallets },
}));

import { WalletsList } from "@/components/wallet/wallets-list";

const A = "0xF8D09e078D3552Ba1a5ae9876D3b24AA10B1EFAD";
const B = "0x8A361b90E7F153eEdEb91ef2b2c7Fa4Dd68ceeee";
const wallets: RegisteredWalletsDTO = { wallets: [
  { walletAddress: A, verificationMethod: "watch_only", boundAt: "2026-09-10T08:49:00.000Z" },
  { walletAddress: B, verificationMethod: "siwe", boundAt: "2026-08-28T06:51:00.000Z" },
] };
const holdings: { data: PortfolioHoldingsDTO; provenance: Provenance } = {
  provenance: "live",
  data: {
    walletAddresses: [A.toLowerCase(), B.toLowerCase()],
    byWallet: [
      { address: A.toLowerCase(), verificationMethod: "watch_only", totalValueKrw: "4050", chainIds: [1, 10, 137, 8453, 42161], holdingsCount: 9, unpricedCount: 0 },
      { address: B.toLowerCase(), verificationMethod: "siwe", totalValueKrw: "0", chainIds: [], holdingsCount: 0, unpricedCount: 0 },
    ],
    holdings: [], skippedChainIds: [], truncatedChainIds: [], unresolvedCount: 0, droppedCount: 0, totalValueKrw: "4050", unpricedCount: 1, asOf: "2026-09-11T06:30:00.000Z", fx: { usdKrw: "1390", day: "2026-09-11" },
  },
};

function renderList() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WalletsList /></QueryClientProvider>);
}

beforeEach(() => {
  ports.getHoldings.mockReset();
  ports.getWallets.mockReset();
  ports.getWallets.mockResolvedValue(wallets);
  ports.getHoldings.mockResolvedValue(holdings);
});

describe("wallets list (지갑 탭)", () => {
  it("lists every registered wallet as amount → address + chain logos → chevron, linking to the detail — no badges, no labels, no network text", async () => {
    const { container } = renderList();
    const rows = await screen.findAllByRole("link", { name: /포트폴리오 열기/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("href", `/wallets/${A.toLowerCase()}`);
    expect(await screen.findByText("₩4,050", { selector: "[data-surface='wallet-row'] [data-layout-value]" })).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("0xF8D09e…B1EFAD");
    expect(screen.getByLabelText("네트워크 Ethereum, Optimism, Polygon, Base, Arbitrum")).toBeInTheDocument();
    for (const gone of ["미검증", "소유 증명됨", "등록한 주소", "브라우저 지갑", "네트워크 ·", "자산 9개", "포트폴리오"]) {
      expect(rows[0].textContent).not.toContain(gone);
    }
    expect(rows[1]).toHaveTextContent("₩0");
    expect(rows[1].querySelector("[aria-label^='네트워크']")).toBeNull();
    const total = container.querySelector('[data-surface="wallets-total"]')!;
    expect(total).toHaveTextContent("전체 평가액");
    expect(total).toHaveTextContent("₩4,050");
    expect(total).toHaveTextContent("지갑 2개 합산");
    expect(total).toHaveTextContent("시세 없는 자산 1개 제외");
    expect(screen.getByRole("tab", { name: "지갑" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "NFT" })).toBeNull();
  });

  it("opens the 지갑 불러오기 sheet from the top action and from the group button, with browser / address entries", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findAllByRole("link", { name: /포트폴리오 열기/ });
    expect(screen.queryByRole("link", { name: /브라우저 지갑 연결/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "지갑 불러오기" }));
    expect(screen.getByRole("link", { name: /브라우저 지갑 연결/ })).toHaveAttribute("href", "/connect-wallet?method=browser");
    expect(screen.getByRole("link", { name: /주소만 등록/ })).toHaveAttribute("href", "/connect-wallet?method=address");
    expect(screen.getByText("거래소 계정")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "지갑 추가하기" }));
    expect(screen.getByRole("link", { name: /브라우저 지갑 연결/ })).toBeInTheDocument();
  });

  it("switches to the 거래소 tab which is a 준비 중 group, not an empty wallet", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findAllByRole("link", { name: /포트폴리오 열기/ });
    await user.click(screen.getByRole("tab", { name: "거래소" }));
    expect(screen.getByText("업비트 · 준비 중")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /포트폴리오 열기/ })).toBeNull();
  });

  it("draws the registered wallets as soon as the list answers, with skeleton amount slots while balances are still loading — never 0", async () => {
    ports.getHoldings.mockImplementation(() => new Promise(() => undefined));
    const { container } = renderList();
    const rows = await screen.findAllByRole("link", { name: /포트폴리오 열기/ });
    expect(rows).toHaveLength(2);
    expect(container.querySelector('[data-surface="wallets-total"]')).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("지갑 2개의 잔액을 확인하는 중입니다");
    expect(screen.queryByText("₩0")).toBeNull();
    expect(rows[0]).toHaveTextContent("0xF8D09e…B1EFAD");
  });

  it("keeps the wallet list when the balance read fails: headline says why, rows say ₩? and 잔액 미확인", async () => {
    const user = userEvent.setup();
    ports.getHoldings.mockRejectedValueOnce(new Error("offline"));
    const { container } = renderList();
    expect(await screen.findByText(/잔액 서버에서 응답을 받지 못했습니다/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /포트폴리오 열기/ })).toHaveLength(2);
    expect(screen.getAllByText("₩?")).toHaveLength(2);
    expect(screen.getAllByText("잔액 미확인")).toHaveLength(2);
    expect(screen.queryByText("₩0")).toBeNull();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("₩4,050", { selector: "[data-surface='wallets-total'] span" })).toBeInTheDocument();
    expect(container.querySelector('[data-surface="wallets-total-error"]')).toBeNull();
  });

  it("shows a list-level error with retry when the wallet list itself cannot be read", async () => {
    ports.getWallets.mockRejectedValueOnce(new Error("401"));
    renderList();
    expect(await screen.findByText("지갑 목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /포트폴리오 열기/ })).toBeNull();
  });
});
