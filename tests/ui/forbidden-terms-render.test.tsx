import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DidLoginFlow } from "@/components/did/did-login-flow";
import { ConnectWalletFlow } from "@/components/wallet/connect-wallet-flow";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { ReportPages } from "@/tests/ui/helpers/report-pages";
import { DisclaimerFooter } from "@/components/ui/disclaimer-footer";
import { createNormalizedEventFixtures } from "@/tests/fixtures/generated/normalized-events";
import { TaxEngineService } from "@/lib/tax/tax-engine-service.server";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import type { AuthClient } from "@/lib/ports/auth-client";
import type { WalletPort } from "@/lib/ports/wallet-port";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const forbidden = ["세액", "납부할 세금", "신고서"];
const events = createNormalizedEventFixtures();
const summary = { periodPnl: "-45000.00", computableEventCount: 14, taxableEventCount: 14, pendingReviewCount: 8, currency: "KRW", period: { from: "2025-01-01T00:00:00.000Z", to: "2025-01-25T00:00:00.000Z" } };
// 손익·건수는 세금 화면과 같은 estimate에서 파생하므로 대시보드가 estimate를 실제로 받게 한다.
const engine = new TaxEngineService(() => events);

const ports = vi.hoisted(() => ({
  list: vi.fn(),
  getSummary: vi.fn(),
  reclassify: vi.fn(),
  getById: vi.fn(),
  getProof: vi.fn(),
  listRuleSets: vi.fn(),
  estimate: vi.fn(),
}));
vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list, reclassify: ports.reclassify, getById: ports.getById },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
  taxEngine: { listRuleSets: ports.listRuleSets, estimate: ports.estimate },
  authClient: { requestNonce: vi.fn(), verify: vi.fn(), presentDid: vi.fn(), logout: vi.fn(), getSession: vi.fn() },
}));

function authClient(): AuthClient {
  return {
    requestNonce: vi.fn(),
    verify: vi.fn(),
    presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "per_address", badge_label: "KR 주소별" } }),
    logout: vi.fn(),
    getSession: vi.fn(),
  } as unknown as AuthClient;
}

function walletPort(): WalletPort {
  return {
    connect: vi.fn().mockResolvedValue({ address: "0x1111111111111111111111111111111111111111", chainId: 1 }),
    getAccount: () => null,
    signMessage: vi.fn(),
    subscribeConnection: () => () => undefined,
  };
}

function renderAll() {
  ports.list.mockResolvedValue({ items: events.map((event) => ({ event, version: 1 })), nextCursor: null });
  ports.getSummary.mockResolvedValue(summary);
  ports.getById.mockResolvedValue({ event: events[0], version: 1, override_history: [] });
  ports.listRuleSets.mockImplementation(async () => listRuleSetSummaries());
  ports.estimate.mockImplementation(async (input: Parameters<TaxEngineService["estimate"]>[0]) => engine.estimate(input));
  ports.getProof.mockResolvedValue({ tx_hash: "0xabc", merkle_root: "0xdef", anchored_at: "2025-01-02T00:00:00.000Z", explorer_url: "https://example.test/tx/0xabc" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DidLoginFlow authClient={authClient()} />
      <ConnectWalletFlow walletPort={walletPort()} authClient={authClient()} />
      <DashboardView />
      {/* 리포트가 다섯 화면으로 나뉘었다 — 금지어 검사는 그 전부를 훑어야 한다.
          한 화면만 세우면 나머지 네 화면이 검사 밖으로 빠진다. */}
      <ReportPages />
      <DisclaimerFooter />
    </QueryClientProvider>,
  );
}

/**
 * 거래 화면. 요약과 같은 mock 원장을 쓰지만 표면이 다르다 — 목록·필터·탭·배지 뜻은 여기에만 있다.
 * 요약과 한 페이지에 함께 세우면 같은 거래 행이 두 벌 떠서 `getBy*`가 중복으로 터지므로 따로 세운다.
 */
function renderTransactions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TransactionsView />
    </QueryClientProvider>,
  );
}

describe("forbidden terminology in rendered route surfaces", () => {
  it("keeps prohibited terms out of every mock-backed surface", async () => {
    renderAll();
    // 비동기 표면(리포트 증명 카드 포함)이 전부 채워진 뒤에 검사해야 은폐가 없다.
    for (const surface of ["did-login", "wallet-connect", "dashboard-summary", "anchor-proof"]) {
      await waitFor(() =>
        expect(document.querySelector(`[data-surface="${surface}"] [data-testid="mock-provenance"]`)).not.toBeNull(),
      );
    }
    // 전체 거래 목록이 거래 탭으로 떠나면서 이 화면의 제목은 "거래 요약"이 아니라 "요약"이 됐다.
    await screen.findByRole("heading", { name: "요약", level: 1 });
    // 건수는 이제 estimate에서 파생하므로 요약 mock 값과 일치하지 않을 수 있다 — 표면이 채워졌는지는 라벨로 확인한다.
    await screen.findByText("계산 대상 이벤트");
    await waitFor(() => expect(document.body.textContent ?? "").toContain("탐색기에서 보기"));
    const text = document.body.textContent ?? "";
    for (const term of forbidden) expect(text).not.toContain(term);
    expect(text).toContain("예상 손익");
    // 이 건수는 계산에 들어간 이벤트 수다. 과세 여부는 판정 그룹이 정한다.
    expect(text).toContain("계산 대상 이벤트");
    expect(text).not.toContain("과세 대상 이벤트");
    expect(text).toContain("확인 필요");

    // 이 파일이 지키는 것은 "mock으로 도는 표면 전부"다 — 새 화면이 생기면 여기 들어와야 한다.
    // 요약을 걷어내고 거래 화면을 그 자리에 세운다(같이 세우면 같은 거래 행이 두 벌 뜬다).
    cleanup();
    renderTransactions();
    // 거래 화면에는 mock 출처 칩이 없다 — 원장이 실제로 그려졌다는 증거는 거래 행 자체다.
    await waitFor(() => expect(document.querySelector("[data-event-id]")).not.toBeNull());
    const transactionsText = document.body.textContent ?? "";
    for (const term of forbidden) expect(transactionsText).not.toContain(term);
    // 탭·배지 뜻이 실제로 그려진 화면을 훑었다는 증거. 빈 화면을 훑고 "금지어 없음"이라 말하면 안 된다.
    expect(transactionsText).toContain("확인 필요");
    expect(transactionsText).toContain("배지 뜻");
  });
});
