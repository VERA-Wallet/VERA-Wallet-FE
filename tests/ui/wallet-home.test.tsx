import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioHoldingsDTO } from "@/lib/http/dto";
import type { Provenance } from "@/lib/http/envelope";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const ports = vi.hoisted(() => ({ getHoldings: vi.fn(), getWallets: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/composition-root.client", () => ({
  authClient: { requestNonce: vi.fn(), verify: vi.fn(), presentDid: vi.fn(), logout: vi.fn(), getSession: vi.fn() },
  holdingsProvider: { getHoldings: ports.getHoldings },
  walletsProvider: { getWallets: ports.getWallets },
}));

import { authClient } from "@/lib/composition-root.client";
import { HoldingsFetchError } from "@/lib/adapters/http/holdings-provider.http";
import { MockHoldingsProvider } from "@/lib/mock/holdings";
import { WalletHome } from "@/components/wallet/wallet-home";
import { WalletsView } from "@/components/wallet/wallets-view";

const WALLET = "0x1111111111111111111111111111111111111111";

/** OFF 모드 서버가 돌려주는 것과 같은 데모 지갑. 화면은 API 계약만 본다. */
const demoHoldings = () => new MockHoldingsProvider([WALLET], "siwe", () => new Date("2026-09-11T05:00:00.000Z")).getHoldings();
const registered = () => Promise.resolve({ wallets: [{ walletAddress: WALLET, verificationMethod: "siwe" as const, boundAt: "2026-09-11T00:00:00.000Z" }] });

function renderWithQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
}

/** 보유 자산이 로드된 뒤의 화면. 뒤로가기 링크는 조회 중에도 있으므로, 로드된 포트폴리오에만 있는 주소 복사 버튼을 기다린다. */
async function renderConnected() {
  const result = renderWithQuery(<WalletHome walletAddress={WALLET} />);
  await screen.findByRole("button", { name: "주소 복사" });
  return result;
}

beforeEach(() => {
  nav.push.mockReset();
  vi.mocked(authClient.logout).mockReset();
  ports.getHoldings.mockReset();
  ports.getHoldings.mockImplementation(demoHoldings);
  ports.getWallets.mockReset();
  ports.getWallets.mockImplementation(registered);
});

describe("wallet home (portfolio of one registered wallet)", () => {
  it("renders ETH/USDT/USDC with price, amount, and value, sorted by value descending", async () => {
    const { container } = await renderConnected();

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

  it("shows per-holding gain/return with brand receive/dispose tones", async () => {
    const { container } = await renderConnected();
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

  it("summarizes the token holdings value, gain, and return at the top of the token tab", async () => {
    const { container } = await renderConnected();
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
    await renderConnected();

    await user.click(screen.getByRole("button", { name: "주소 복사" }));
    expect(await screen.findByText("복사됨")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(WALLET);
  });

  it("shows the NFT portfolio grid under the NFT tab", async () => {
    const user = userEvent.setup();
    const { container } = await renderConnected();

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
    const { container } = await renderConnected();

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
    const { container } = await renderConnected();
    expect(container.querySelectorAll('[data-surface="holding-row"]')).toHaveLength(3);

    // 137 = Polygon, which only holds USDT in the demo set.
    await user.selectOptions(screen.getByRole("combobox"), "137");
    const rows = container.querySelectorAll('[data-surface="holding-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("USDT");
  });

  it("heads with a back link to the wallet list and the wallet's registration badge from the list source", async () => {
    await renderConnected();
    expect(screen.getByRole("link", { name: "지갑 목록으로" })).toHaveAttribute("href", "/wallets");
    expect(screen.getByText("브라우저 지갑")).toBeInTheDocument();
    expect(screen.getByText("소유 증명됨")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /계정 열기/ })).toBeNull();
    expect(authClient.logout).not.toHaveBeenCalled();
  });

  it("shows the 404 view for an address the account has not registered, without calling it an empty wallet", async () => {
    const other = "0x2222222222222222222222222222222222222222";
    renderWithQuery(<WalletHome walletAddress={other} />);
    expect(await screen.findByText("등록하지 않은 지갑입니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "지갑 목록" })).toHaveAttribute("href", "/wallets");
    expect(screen.queryByText(/보유한 토큰/)).toBeNull();
  });

  it("labels the token section as demo data with the mock chip when the provenance is mock", async () => {
    await renderConnected();
    expect(screen.getByTestId("mock-provenance")).toBeInTheDocument();
    expect(screen.getByText(/데모 예시 데이터\(USD\) 기준/)).toBeInTheDocument();
  });

  it("shows a loading state first, then the portfolio — never an empty wallet while the read is pending", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof demoHoldings>>) => void;
    ports.getHoldings.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { container } = renderWithQuery(<WalletHome walletAddress={WALLET} />);
    expect(container.querySelector('[data-surface="wallet-portfolio-loading"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-surface="holding-row"]')).toHaveLength(0);
    resolve(await demoHoldings());
    expect(await screen.findByRole("button", { name: "주소 복사" })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-surface="holding-row"]')).toHaveLength(3);
  });

  it("shows the failure with its reason and a retry, instead of an empty portfolio", async () => {
    const user = userEvent.setup();
    ports.getHoldings.mockRejectedValueOnce(new Error("잔액 서버에서 정상적인 응답을 받지 못했습니다."));
    const { container } = renderWithQuery(<WalletHome walletAddress={WALLET} />);
    expect(await screen.findByText("보유 자산을 불러오지 못했습니다")).toBeInTheDocument();
    // 서버의 영어 원문은 화면에 싣지 않는다 — 코드 없는 실패는 일반 문구.
    expect(screen.queryByText("잔액 서버에서 정상적인 응답을 받지 못했습니다.")).toBeNull();
    expect(screen.getByText("잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-surface="holding-row"]')).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("button", { name: "주소 복사" })).toBeInTheDocument();
  });

  it("maps a 401 to a re-login path instead of an endless retry, and a 404 to '지갑 없음'", async () => {
    ports.getHoldings.mockRejectedValueOnce(new HoldingsFetchError("unauthorized", "Unauthorized"));
    const { unmount } = renderWithQuery(<WalletHome walletAddress={WALLET} />);
    expect(await screen.findByText(/로그인이 만료되었습니다/)).toBeInTheDocument();
    expect(screen.queryByText("Unauthorized")).toBeNull();
    expect(screen.getByRole("link", { name: "다시 로그인" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
    unmount();

    ports.getHoldings.mockRejectedValueOnce(new HoldingsFetchError("not_found", "A bound wallet is required before reading holdings."));
    const second = renderWithQuery(<WalletHome walletAddress={WALLET} />);
    expect(await screen.findByText(/이 지갑의 등록을 찾지 못했습니다/)).toBeInTheDocument();
    second.unmount();

    // 예전 BE(엔드포인트 없음)는 "지갑을 등록하라"가 아니라 배포 확인을 안내한다.
    ports.getHoldings.mockRejectedValueOnce(new HoldingsFetchError("backend_endpoint_missing", "missing"));
    renderWithQuery(<WalletHome walletAddress={WALLET} />);
    expect(await screen.findByText(/서버 배포 버전을 확인해 주세요/)).toBeInTheDocument();
  });

  it("keeps the last portfolio on a background refetch failure and says it is stale, instead of blanking it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WalletHome walletAddress={WALLET} /></QueryClientProvider>);
    await screen.findByRole("button", { name: "주소 복사" });
    ports.getHoldings.mockRejectedValueOnce(new Error("offline"));
    await client.refetchQueries();
    expect(await screen.findByText("최근 조회에 실패해 이전 결과를 보여주고 있습니다.")).toBeInTheDocument();
    expect(screen.getAllByText(/ETH/).length).toBeGreaterThan(0);
  });

  it("ON 모드(live): says what is real, what is demo, and what is missing — and never draws a missing price or cost as 0", async () => {
    const live: { data: PortfolioHoldingsDTO; provenance: Provenance } = {
      provenance: "live",
      data: {
        walletAddresses: [WALLET],
        holdings: [
          { chainId: 1, assetType: "NATIVE", contract: null, symbol: "ETH", name: "ETH", decimals: 18, amount: "0.75", priceUsd: "3200", valueUsd: "2400", priceStatus: "priced", costUsd: "2160", costStatus: "ready", trackedAmount: "0.75" },
          { chainId: 8453, assetType: "ERC20", contract: "0xusdc", symbol: "USDC", name: "USD Coin", decimals: 6, amount: "500", priceUsd: "1", valueUsd: "500", priceStatus: "priced", costUsd: "240", costStatus: "partial", trackedAmount: "250" },
          { chainId: 137, assetType: "ERC20", contract: "0xghost", symbol: "GHOST", name: "Ghost", decimals: 18, amount: "12", priceUsd: null, valueUsd: null, priceStatus: "unknown", costUsd: null, costStatus: "unknown", trackedAmount: null },
          { chainId: 10, assetType: "NATIVE", contract: null, symbol: "ETH", name: "ETH", decimals: 18, amount: "0.1", priceUsd: "3200", valueUsd: "320", priceStatus: "priced", costUsd: null, costStatus: "fx_unavailable", trackedAmount: "0.1" },
        ],
        byWallet: [{ address: WALLET, verificationMethod: "watch_only", totalValueUsd: "3220", chainIds: [1, 10, 137, 8453], holdingsCount: 4, unpricedCount: 1 }],
        skippedChainIds: [42161],
        truncatedChainIds: [],
        unresolvedCount: 2,
        droppedCount: 1,
        totalValueUsd: "3220",
        unpricedCount: 1,
        asOf: "2026-09-11T05:00:00.000Z",
      },
    };
    ports.getHoldings.mockResolvedValue(live);
    const { container } = await renderConnected();

    expect(screen.queryByTestId("mock-provenance")).toBeNull();
    // 상단 총액은 토큰뿐이다(2,400 + 500 + 320). 데모 NFT·디파이 24,300달러가 섞이면 안 된다.
    expect(container.querySelector('[data-surface="wallet-total"]')).toHaveTextContent("US$3,220.00");
    expect(screen.queryByText("US$27,520.00")).toBeNull();
    const note = container.querySelector('[data-surface="wallet-total-note"]')!;
    expect(note).toHaveTextContent("온체인 잔액과 DexScreener 시세");
    expect(note).toHaveTextContent("취득원가는 오늘 환율로 USD 환산");
    expect(note).toHaveTextContent("NFT·디파이는 아직 조회하지 않습니다");
    expect(note).toHaveTextContent("시세 없는 자산 1개는 총액에서 뺐습니다");
    const coverage = container.querySelector('[data-surface="wallet-coverage"]')!;
    expect(coverage).toHaveTextContent("Arbitrum 잔액을 읽지 못했습니다");
    expect(coverage).toHaveTextContent("토큰 2개의 정보를 조회하지 못해");
    expect(coverage).toHaveTextContent("형식이 맞지 않아 자산 1개를 표시하지 못했습니다");
    // 체인 칩도 토큰이 실제로 놓인 체인만(1·8453·137·10) — 데모 NFT의 체인이 끼지 않는다.
    expect(screen.getByLabelText("네트워크 Ethereum, Optimism, Polygon, Base")).toBeInTheDocument(); // 자산 수 동률 → chainId 오름차순

    const rows = container.querySelectorAll('[data-surface="holding-row"]');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("+US$240.00"); // ETH 2,400 − 2,160
    expect(rows[1]).toHaveTextContent("원가 일부만 확인"); // partial: no gain figure
    expect(rows[1]).not.toHaveTextContent("US$260.00");
    expect(rows[2]).toHaveTextContent("환율 조회 실패"); // OP ETH: value shown, cost not
    expect(rows[2]).toHaveTextContent("US$320.00");
    expect(rows[3]).toHaveTextContent("GHOST");
    expect(rows[3]).toHaveTextContent("시세 미확인");
    expect(rows[3]).not.toHaveTextContent("US$0.00");

    // 손익 요약은 원가·시세가 다 있는 ETH 한 줄만 더하고, 3줄이 빠졌다고 말한다.
    const summary = container.querySelector('[data-surface="wallet-holdings-summary"]')!;
    expect(summary).toHaveTextContent("+US$240.00");
    expect(summary).toHaveTextContent("3개 제외");

    // NFT·디파이 탭은 "없다"가 아니라 "아직 조회하지 않는다"고 말한다.
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "NFT" }));
    expect(screen.getByText("NFT 보유 조회는 준비 중입니다.")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-surface="nft-card"]')).toHaveLength(0);
    await user.click(screen.getByRole("tab", { name: "디파이" }));
    expect(screen.getByText("디파이 포지션 조회는 준비 중입니다.")).toBeInTheDocument();
  });

  it("keeps the connect CTA when no wallet is bound", () => {
    render(<WalletsView walletAddress={null} />);
    expect(screen.getByText("아직 연결된 지갑이 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "지갑 연결하기" })).toBeInTheDocument();
  });
});
