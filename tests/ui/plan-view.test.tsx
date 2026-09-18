import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PlanView } from "@/components/plan/plan-view";

function planCards() {
  return within(screen.getByRole("list", { name: "플랜" })).getAllByRole("listitem");
}

describe("플랜 화면", () => {
  it("데모 결제는 배지를 켜고 되돌릴 문을 남긴다", async () => {
    render(<PlanView taxYear={2026} />);

    // 배지만 켜고 결제 성격을 말하지 않으면 사용자는 청구가 일어났다고 믿는다.
    expect(screen.getByTestId("mock-provenance")).toBeInTheDocument();
    expect(screen.getByText("결제는 데모입니다. 실제 청구가 발생하지 않습니다.")).toBeInTheDocument();
    expect(screen.getByText("플랜은 계산 결과를 바꾸지 않습니다 — 잠기는 것은 다운로드뿐입니다.")).toBeInTheDocument();

    // 무료는 고를 대상이 아니다 — 결제 버튼이 있으면 결제해야 쓸 수 있다고 읽힌다.
    const [free, plus, pro] = planCards();
    expect(within(free!).queryByRole("button")).toBeNull();

    await userEvent.click(within(plus!).getByRole("button", { name: "데모 결제로 시작 (실제 결제 아님)" }));
    expect(within(plus!).getByText("활성 · 2026년")).toBeInTheDocument();
    // 활성 카드는 해제로 되돌릴 수 있어야 한다. 켜기만 되는 상태는 데모가 아니라 함정이다.
    const release = within(plus!).getByRole("button", { name: "데모 결제 해제" });
    // 이미 결제한 사용자에게 남은 카드는 새 결제가 아니라 변경이다.
    expect(within(pro!).getByRole("button", { name: /데모 결제로 바꾸기/ })).toBeInTheDocument();

    await userEvent.click(release);
    expect(within(plus!).queryByText("활성 · 2026년")).toBeNull();
    expect(within(plus!).getByRole("button", { name: "데모 결제로 시작 (실제 결제 아님)" })).toBeInTheDocument();
  });

  it("과세연도별 결제는 활성 플랜 1행만 실데이터로 보여준다", async () => {
    // 결제 이력의 집은 리포트가 아니라 이 화면이다(2026-09-18 리포트 분리 때 옮겨 왔다).
    const { container } = render(<PlanView taxYear={2026} />);

    // 결제 전에는 이력 자체가 없다 — 빈 표를 세워 놓고 "아직 없음"이라 하지 않는다.
    expect(container.querySelector("[data-surface='plan-payments']")).toBeNull();

    const [, plus] = planCards();
    await userEvent.click(within(plus!).getByRole("button", { name: "데모 결제로 시작 (실제 결제 아님)" }));

    const payments = container.querySelector("[data-surface='plan-payments']") as HTMLElement | null;
    expect(payments).not.toBeNull();
    expect(within(payments!).getByText("과세연도별 결제")).toBeInTheDocument();
    // 연도·플랜명·활성화 날짜는 usePlan의 활성 플랜에서만 파생한다 — 하드코딩이 아니다.
    expect(within(payments!).getByText(/2026년 귀속 · 플러스 플랜 · 활성화/)).toBeInTheDocument();
    expect(
      within(payments!).getByText(/지난 연도 결제 이력과 내보내기 스냅샷 보관은 아직 제공하지 않습니다/),
    ).toBeInTheDocument();
  });
});
