import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const api = vi.hoisted(() => ({ getHoldings: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/composition-root.client", () => ({
  authClient: { requestNonce: vi.fn(), verify: vi.fn(), presentDid: vi.fn(), logout: vi.fn(), getSession: vi.fn() },
  holdingsProvider: { getHoldings: api.getHoldings },
}));

import { authClient } from "@/lib/composition-root.client";
import { WalletHome } from "@/components/wallet/wallet-home";
import { WalletsView } from "@/components/wallet/wallets-view";
import type { HoldingDTO, HoldingsDTO } from "@/lib/http/dto";

const WALLET = "0x1111111111111111111111111111111111111111";

const holding = (over: Partial<HoldingDTO>): HoldingDTO => ({
  key: "1:native",
  chainId: 1,
  contract: null,
  symbol: "ETH",
  name: "Ethereum",
  amount: "0.75",
  priceUsd: "3200.00",
  valueUsd: "2400.00",
  spam: false,
  ...over,
});

function snapshot(over: Partial<HoldingsDTO> = {}): HoldingsDTO {
  return {
    walletAddress: WALLET,
    holdings: [
      holding({}),
      holding({ key: "137:usdt", chainId: 137, contract: "0xusdt", symbol: "USDT", name: "Tether USD", amount: "850", priceUsd: "1.00", valueUsd: "850.00" }),
      holding({ key: "8453:usdc", chainId: 8453, contract: "0xusdc", symbol: "USDC", name: "USD Coin", amount: "500", priceUsd: "1.00", valueUsd: "500.00" }),
    ],
    totalUsd: "3750.00",
    unpricedCount: 0,
    spamCount: 0,
    skippedChainIds: [],
    truncatedChainIds: [],
    ...over,
  };
}

function renderConnected() {
  // retry를 끄지 않으면 실패 경로 테스트가 재시도를 기다리느라 늘어진다.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WalletHome walletAddress={WALLET} />
    </QueryClientProvider>,
  );
}

/** 목록이 들어찰 때까지 기다린다 — 잔액은 비동기로 온다. */
const rowsOf = async (container: HTMLElement, count: number) => {
  await waitFor(() => expect(container.querySelectorAll('[data-surface="holding-row"]')).toHaveLength(count));
  return container.querySelectorAll('[data-surface="holding-row"]');
};

beforeEach(() => {
  nav.push.mockReset();
  vi.mocked(authClient.logout).mockReset();
  api.getHoldings.mockReset();
  api.getHoldings.mockResolvedValue(snapshot());
});

describe("wallet home (portfolio + account)", () => {
  it("renders the wallet's own balances with price, amount, and value", async () => {
    const { container } = renderConnected();
    const rows = await rowsOf(container, 3);

    expect(rows[0]).toHaveTextContent("ETH");
    expect(rows[0]).toHaveTextContent("US$3,200.00"); // 단가
    expect(rows[0]).toHaveTextContent("US$2,400.00"); // 평가액
    expect(rows[0]).toHaveTextContent("0.75 ETH"); // 수량
    expect(rows[1]).toHaveTextContent("USDT");
    expect(rows[2]).toHaveTextContent("USDC");
    expect(container.querySelector('[data-token-icon="ETH"]')).not.toBeNull();
    expect(screen.getByText("US$3,750.00")).toBeInTheDocument();
    // 조회한 지갑이 세션 지갑이어야 한다 — 남의 주소를 물으면 BE가 404를 준다.
    expect(api.getHoldings).toHaveBeenCalledWith({ wallet: WALLET });
  });

  // 데모 상수 시절엔 지갑을 바꿔도 US$28,050이 그대로였다. 주소가 조회 키에 들어가는지 못박는다.
  it("asks for the address it was given, not a fixed demo set", async () => {
    const other = "0x2222222222222222222222222222222222222222";
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.getHoldings.mockResolvedValue(snapshot({ walletAddress: other, holdings: [], totalUsd: "0" }));
    render(
      <QueryClientProvider client={client}>
        <WalletHome walletAddress={other} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.getHoldings).toHaveBeenCalledWith({ wallet: other }));
    expect(await screen.findByText("보유한 토큰이 없습니다.")).toBeInTheDocument();
  });

  // 온체인 잔액에는 취득원가가 없다. 0으로 뭉개 "전액 이익"을 그리면 안 된다.
  it("omits gain/return while cost basis is unknown", async () => {
    const { container } = renderConnected();
    const rows = await rowsOf(container, 3);
    expect(rows[0].querySelector(".text-receive")).toBeNull();
    expect(rows[0].querySelector(".text-dispose")).toBeNull();

    expect(container.querySelector('[data-surface="wallet-cost-basis-note"]')).toHaveTextContent("평가손익은 취득원가가 있어야 계산됩니다");
    expect(container.textContent).not.toContain("+US$");
  });

  // 접은 건 지운 게 아니다 — 몇 건인지 화면이 말해야 "내 토큰이 없어졌다"가 안 된다.
  it("says how many holdings were folded away and which chains failed", async () => {
    // 카운트는 화면이 목록에서 접은 실제 항목에서 나온다 — BE 상단 카운트를 그대로 믿지 않는다.
    const base = snapshot();
    api.getHoldings.mockResolvedValue({
      ...base,
      holdings: [
        ...base.holdings,
        holding({ key: "1:idos", contract: "0xidos", symbol: "IDOS", priceUsd: null, valueUsd: null }),
        holding({ key: "1:spam", contract: "0xspam", symbol: "www.bairdrop.co ✅", spam: true }),
      ],
      skippedChainIds: [10],
      truncatedChainIds: [8453],
    });
    const { container } = renderConnected();
    // 접힌 둘은 행으로 그리지 않는다.
    await rowsOf(container, 3);

    const element = container.querySelector('[data-surface="wallet-holdings-notes"]')!;
    expect(element).toHaveTextContent("시세를 확인하지 못한 1종");
    expect(element).toHaveTextContent("에어드랍 스팸으로 판정한 1종");
    expect(element).toHaveTextContent("잔액은 읽지 못했습니다");
    expect(element).toHaveTextContent("일부만 읽었습니다");
  });

  it("surfaces a balance read failure instead of drawing an empty wallet", async () => {
    api.getHoldings.mockRejectedValue(new Error("upstream down"));
    renderConnected();
    expect(await screen.findByRole("alert")).toHaveTextContent("잔액을 불러오지 못했습니다");
    expect(screen.queryByText("보유한 토큰이 없습니다.")).toBeNull();
  });

  it("copies the wallet address to the clipboard", async () => {
    const user = userEvent.setup();
    renderConnected();

    await user.click(screen.getByRole("button", { name: "주소 복사" }));
    expect(await screen.findByText("복사됨")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(WALLET);
  });

  it("filters holdings by network", async () => {
    const user = userEvent.setup();
    const { container } = renderConnected();
    await rowsOf(container, 3);

    // 137 = Polygon, 이 묶음에서는 USDT만 있다.
    await user.selectOptions(screen.getByRole("combobox"), "137");
    const rows = await rowsOf(container, 1);
    expect(rows[0]).toHaveTextContent("USDT");
  });

  it("opens the 계정 screen from the account button, then returns via 뒤로", async () => {
    const user = userEvent.setup();
    renderConnected();

    await user.click(screen.getByRole("button", { name: /계정 열기/ }));
    expect(screen.getByRole("heading", { name: "계정" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "뒤로" })).toBeInTheDocument();
    expect(screen.getByText(/로그인은 유지/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지갑 추가하기" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "뒤로" }));
    expect(screen.getByRole("button", { name: /계정 열기/ })).toBeInTheDocument();
  });

  // 지갑 추가는 로그인과 별개다. DID 세션은 살아 있어야 하고 이미 등록한 지갑도 남아야 하므로,
  // 여기서 로그아웃하거나 /login으로 보내면 요구사항이 깨진 것이다. 두 조건을 함께 못박는다.
  it("adding a wallet routes to /connect-wallet without ending the session", async () => {
    const user = userEvent.setup();
    renderConnected();

    await user.click(screen.getByRole("button", { name: /계정 열기/ }));
    await user.click(screen.getByRole("button", { name: "지갑 추가하기" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/connect-wallet"));
    expect(authClient.logout).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalledWith("/login");
  });

  it("keeps the connect CTA when no wallet is bound", () => {
    render(<WalletsView walletAddress={null} />);
    expect(screen.getByText("아직 연결된 지갑이 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "지갑 연결하기" })).toBeInTheDocument();
  });
});
