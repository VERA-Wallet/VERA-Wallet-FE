import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ExchangeConnectPanel } from "@/components/wallet/exchange-connect-panel";
import { EXCHANGE_LINKS_STORAGE_KEY, parseExchangeLinks } from "@/lib/exchange/mock-links";
import { memoryStorage } from "@/tests/fixtures/memory-storage";

const API_KEY = "UPBIT-KEY-1234567890";

let storage: Storage;

function panel() {
  return render(<ExchangeConnectPanel linkDelayMs={0} storage={storage} />);
}

function storedLinks() {
  return parseExchangeLinks(storage.getItem(EXCHANGE_LINKS_STORAGE_KEY));
}

function row(name: string) {
  const items = within(screen.getByRole("list", { name: "연동할 거래소" })).getAllByRole("listitem");
  const found = items.find((item) => item.textContent?.includes(name));
  if (!found) throw new Error(`${name} 행을 찾지 못했습니다.`);
  return found;
}

describe("exchange connect panel", () => {
  beforeEach(() => {
    storage = memoryStorage();
  });

  it("labels itself as mock-backed next to the exchange list", () => {
    const { container } = panel();
    expect(container.querySelector('[data-surface="exchange-connect"] [data-testid="mock-provenance"]')).not.toBeNull();
    expect(screen.getByText(/실제 거래소에 접속하지 않고/)).toBeVisible();
    expect(within(screen.getByRole("list", { name: "연동할 거래소" })).getAllByRole("listitem")).toHaveLength(6);
  });

  it("links an API-key exchange and shows only a masked credential", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "업비트 연동하기" }));

    const submit = screen.getByRole("button", { name: "연동하기" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("API 키"), { target: { value: API_KEY } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("시크릿 키"), { target: { value: "secret-value" } });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(await screen.findByRole("button", { name: "업비트 연동 해제" })).toBeVisible();
    expect(within(row("업비트")).getByText(/UPBI••••7890/)).toBeVisible();
    // 시연이라도 원문 키가 화면이나 저장소에 남으면 그건 시연이 아니라 유출이다.
    expect(document.body.textContent).not.toContain(API_KEY);
    expect(storedLinks()).toEqual([
      { exchangeId: "upbit", credentialLabel: "UPBI••••7890", connectedAt: expect.any(String), scope: "read-only" },
    ]);
    expect(storage.getItem(EXCHANGE_LINKS_STORAGE_KEY)).not.toContain("secret-value");
  });

  it("states the requested and refused permissions before any input", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "빗썸 연동하기" }));
    const sheet = screen.getByRole("dialog", { name: "빗썸 연동" });
    expect(within(sheet).getByText("거래 내역 조회")).toBeVisible();
    expect(within(sheet).getByText("출금·이체")).toBeVisible();
    expect(within(sheet).getByText(/입력값은 어디로도 전송되지 않으며/)).toBeVisible();
  });

  it("requires the passphrase only where the exchange asks for one", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "OKX 연동하기" }));
    fireEvent.change(screen.getByLabelText("API 키"), { target: { value: "OKX-KEY-0987654321" } });
    fireEvent.change(screen.getByLabelText("시크릿 키"), { target: { value: "secret-value" } });
    expect(screen.getByRole("button", { name: "연동하기" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("패스프레이즈"), { target: { value: "phrase" } });
    expect(screen.getByRole("button", { name: "연동하기" })).toBeEnabled();
  });

  it("approves an OAuth exchange without asking for keys", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "코인베이스 연동하기" }));
    expect(screen.queryByLabelText("API 키")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "코인베이스 로그인 후 승인" }));
    expect(await screen.findByRole("button", { name: "코인베이스 연동 해제" })).toBeVisible();
    expect(storedLinks()[0].credentialLabel).toBe("OAuth 조회 권한");
  });

  it("restores links saved in this browser and removes them on disconnect", () => {
    storage = memoryStorage({
      [EXCHANGE_LINKS_STORAGE_KEY]: JSON.stringify([
        { exchangeId: "binance", credentialLabel: "BNBN••••4321", connectedAt: "2026-08-01T00:00:00.000Z", scope: "read-only" },
      ]),
    });
    panel();
    expect(within(row("바이낸스")).getByText(/연동됨/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "바이낸스 연동 해제" }));
    expect(screen.getByRole("button", { name: "바이낸스 연동하기" })).toBeVisible();
    expect(storedLinks()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("바이낸스 연동을 해제했습니다.");
  });
});
