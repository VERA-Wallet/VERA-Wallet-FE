import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

import { AppNav } from "@/components/ui/app-nav";

function tabLabels() {
  return within(screen.getByTestId("app-nav"))
    .getAllByRole("link")
    .map((link) => link.textContent);
}

describe("하단 탭 내비게이션", () => {
  beforeEach(() => pathname.mockReset());

  it("플랜 화면에서도 탭이 남아 있다 — 결제 화면이 출구 없는 막다른 길이 되면 안 된다", () => {
    pathname.mockReturnValue("/plan");
    render(<AppNav />);

    // 내보내기 잠금 배너를 타고 들어온 사용자가 탭으로 돌아갈 수 있어야 한다.
    expect(screen.getByTestId("app-nav")).toBeInTheDocument();
    // 플랜은 매일 누르는 화면이 아니다 — 탭은 4개 그대로 두고 노출만 허용한다.
    expect(tabLabels()).toEqual(["거래", "룰셋 비교", "지갑", "내보내기"]);
    // 어느 탭도 활성이 아니다. 플랜은 탭이 아니므로 남의 탭에 불을 켜면 현재 위치를 속이는 셈이다.
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("온보딩 경로에서는 탭을 감춘다 — 세션 가드에 막힐 이동을 권하지 않는다", () => {
    pathname.mockReturnValue("/login");
    render(<AppNav />);

    expect(screen.queryByTestId("app-nav")).toBeNull();
  });

  it("탭 경로에서는 해당 탭이 활성으로 표시된다", () => {
    pathname.mockReturnValue("/export");
    render(<AppNav />);

    expect(screen.getByRole("link", { current: "page" })).toHaveTextContent("내보내기");
  });
});
