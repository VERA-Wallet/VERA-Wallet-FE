import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

const ports = vi.hoisted(() => ({ getSummary: vi.fn() }));
vi.mock("@/lib/composition-root.client", () => ({
  summaryProvider: { getSummary: ports.getSummary },
}));

import { AppNav } from "@/components/ui/app-nav";

function renderNav() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppNav />
    </QueryClientProvider>,
  );
}

function tabLabels() {
  return within(screen.getByTestId("app-nav"))
    .getAllByRole("link")
    .map((link) => link.textContent);
}

describe("하단 탭 내비게이션", () => {
  beforeEach(() => {
    pathname.mockReset();
    ports.getSummary.mockReset();
    // 배지 테스트가 아닌 곳에서는 0건으로 고정해 라벨 문자열이 숫자로 오염되지 않게 한다.
    ports.getSummary.mockResolvedValue({ periodPnl: "0", computableEventCount: 0, taxableEventCount: 0, pendingReviewCount: 0, currency: "KRW", period: null });
  });

  it("플랜 화면에서도 탭이 남아 있다 — 결제 화면이 출구 없는 막다른 길이 되면 안 된다", () => {
    pathname.mockReturnValue("/plan");
    renderNav();

    // 리포트 잠금 배너를 타고 들어온 사용자가 탭으로 돌아갈 수 있어야 한다.
    expect(screen.getByTestId("app-nav")).toBeInTheDocument();
    // 플랜은 매일 누르는 화면이 아니다 — 탭은 4개 그대로 두고 노출만 허용한다.
    // 세금 탭은 없다: 리포트(/export)가 계산·다운로드를 한 화면에서 말한다.
    expect(tabLabels()).toEqual(["요약", "거래", "지갑", "리포트"]);
    // 어느 탭도 활성이 아니다. 플랜은 탭이 아니므로 남의 탭에 불을 켜면 현재 위치를 속이는 셈이다.
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("설정 화면에서도 탭이 남아 있다 — 설정도 탭이 아닌 곁길이다", () => {
    pathname.mockReturnValue("/settings");
    renderNav();

    expect(screen.getByTestId("app-nav")).toBeInTheDocument();
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("온보딩 경로에서는 탭을 감춘다 — 세션 가드에 막힐 이동을 권하지 않는다", () => {
    pathname.mockReturnValue("/login");
    renderNav();

    expect(screen.queryByTestId("app-nav")).toBeNull();
    // 내비가 없는 화면에서는 배지 조회도 나가지 않는다 — enabled 가드가 걸려 있어야 한다.
    expect(ports.getSummary).not.toHaveBeenCalled();
  });

  it("탭 경로에서는 해당 탭이 활성으로 표시된다", () => {
    pathname.mockReturnValue("/export");
    renderNav();

    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent("리포트");
  });

  it("세금 탭은 더 이상 없다 — /tax로 가는 링크를 그리지 않는다", () => {
    pathname.mockReturnValue("/dashboard");
    renderNav();

    expect(screen.queryByRole("link", { name: "세금" })).toBeNull();
    expect(document.querySelector('a[href="/tax"]')).toBeNull();
  });

  it("확인 필요 건수가 있으면 거래 탭에 배지가 붙는다", async () => {
    ports.getSummary.mockResolvedValue({ periodPnl: "0", computableEventCount: 0, taxableEventCount: 0, pendingReviewCount: 3, currency: "KRW", period: null });
    pathname.mockReturnValue("/dashboard");
    renderNav();

    // 배지는 점이다 — 요약의 건수(다리 단위)와 거래 탭의 건수(행 단위)가 달라 숫자를 달면 두 값이 된다.
    const transactionsLink = await screen.findByRole("link", { name: "거래 · 확인 필요 있음" });
    expect(transactionsLink.querySelector('[data-badge="pending-review"]')).not.toBeNull();
    expect(transactionsLink).toHaveTextContent(/^거래$/);
  });

  it("확인 필요 0건이면 배지를 그리지 않는다", async () => {
    pathname.mockReturnValue("/dashboard");
    renderNav();

    // 요약 조회가 끝날 때까지 기다린 뒤에도 배지 숫자가 없어야 한다.
    await screen.findByTestId("app-nav");
    expect(ports.getSummary).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "거래" })).toBeInTheDocument();
  });

  it("요약 조회가 실패해도 배지를 그리지 않는다 — 재시도로 화면을 막지 않는다", async () => {
    ports.getSummary.mockRejectedValue(new Error("요약 조회 실패"));
    pathname.mockReturnValue("/dashboard");
    renderNav();

    await screen.findByTestId("app-nav");
    expect(await screen.findByRole("link", { name: "거래" })).toBeInTheDocument();
  });
});
