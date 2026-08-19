import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FREE_EXPORT_EVENT_LIMIT, planDefinition, type Plan } from "@/lib/plan/use-plan";

const state = vi.hoisted(() => ({ plan: null as Plan | null }));
const ports = vi.hoisted(() => ({ list: vi.fn(), getSummary: vi.fn(), getProof: vi.fn() }));

vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list },
  summaryProvider: { getSummary: ports.getSummary },
  anchorProofProvider: { getProof: ports.getProof },
}));

// 저장소 읽기만 대신한다 — 한도표와 잠금 판정은 실제 모듈을 그대로 태운다.
// 여기서 `exportEventAllowance`까지 더블로 바꾸면 화면이 아니라 더블을 검증하게 된다.
vi.mock("@/lib/plan/use-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan/use-plan")>();
  return { ...actual, usePlan: () => ({ plan: state.plan, activate: vi.fn(), deactivate: vi.fn() }) };
});

import { ExportView } from "@/components/export/export-view";

function summaryWith(computableEventCount: number) {
  return {
    periodPnl: "0",
    computableEventCount,
    taxableEventCount: computableEventCount,
    pendingReviewCount: 0,
    currency: "KRW",
    period: { from: "2026-01-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" },
  };
}

const plusPlan: Plan = { tier: "plus", taxYear: 2026, activatedAt: "2026-08-19T00:00:00.000Z" };

function renderWith(computableEventCount: number, plan: Plan | null) {
  state.plan = plan;
  ports.list.mockResolvedValue({ items: [], nextCursor: null });
  ports.getProof.mockResolvedValue(null);
  ports.getSummary.mockResolvedValue(summaryWith(computableEventCount));
  return render(<ExportView />);
}

beforeEach(() => {
  ports.list.mockReset();
  ports.getSummary.mockReset();
  ports.getProof.mockReset();
  state.plan = null;
});

describe("내보내기 플랜 잠금", () => {
  it("무료 한도까지는 잠그지 않지만 플랜으로 가는 길은 열어 둔다", async () => {
    renderWith(FREE_EXPORT_EVENT_LIMIT, null);

    const csv = await screen.findByRole("button", { name: /CSV 다운로드/ });
    await waitFor(() => expect(csv).not.toBeDisabled());
    expect(screen.getByRole("button", { name: /XLSX 다운로드/ })).not.toBeDisabled();
    // 플랜은 탭에 없다 — 여기서도 감추면 앱 안에서 도달할 길이 사라진다.
    expect(await screen.findByRole("link", { name: /플랜 보기/ })).toHaveAttribute("href", "/plan");
    // 잠기지 않았는데 "필요합니다"라고 하면 쓰지도 못할 결제를 재촉하는 셈이다.
    expect(screen.getByText("무료 플랜 100건까지 · 현재 100건")).toBeInTheDocument();
    // 파일 행 수와 과금 건수는 다를 수 있다. 캡션은 자기 기준과 자기 수를 함께 말해야 한다.
    expect(screen.getByText(/건수는 계산 대상 이벤트 기준입니다 · 현재 100건/)).toBeInTheDocument();
  });

  it("건수를 아직 모르면 안내도 하지 않는다 — 근거 없는 한도 표기는 하지 않는다", () => {
    state.plan = null;
    ports.list.mockResolvedValue({ items: [], nextCursor: null });
    ports.getProof.mockResolvedValue(null);
    ports.getSummary.mockReturnValue(new Promise(() => {}));
    render(<ExportView />);

    expect(screen.queryByRole("link", { name: /플랜 보기/ })).toBeNull();
  });

  it("한도를 넘고 플랜이 없으면 다운로드만 잠기고 플랜으로 가는 문이 열린다", async () => {
    renderWith(250, null);

    const banner = await screen.findByRole("link", { name: /플랜 보기/ });
    expect(banner).toHaveAttribute("href", "/plan");
    expect(screen.getByText("무료 플랜 100건까지 · 현재 250건 — 플랜이 필요합니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "🔒 CSV 다운로드" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "🔒 XLSX 다운로드" })).toBeDisabled();
    // 미리보기는 잠기지 않는다 — 기간·건수 표기는 그대로 보인다.
    expect(screen.getByText(/건수는 계산 대상 이벤트 기준입니다/)).toBeInTheDocument();
  });

  it("플랜이 활성이면 한도까지 다시 열린다", async () => {
    renderWith(250, plusPlan);

    const csv = await screen.findByRole("button", { name: /CSV 다운로드/ });
    await waitFor(() => expect(csv).not.toBeDisabled());
    expect(csv.textContent).not.toContain("🔒");
    // 결제한 사용자에게도 남은 한도는 알려 준다 — 다만 재촉 문구는 붙지 않는다.
    expect(screen.getByText("플러스 플랜 1,000건까지 · 현재 250건")).toBeInTheDocument();
  });

  it("활성 플랜의 한도마저 넘으면 상위 플랜을 가리킨다", async () => {
    // 카드가 1,000건이라 적어 놓고 무제한으로 열어 주면 광고와 동작이 갈린다.
    renderWith(planDefinition("plus").exportLimit + 1, plusPlan);

    await screen.findByRole("link", { name: /플랜 보기/ });
    expect(screen.getByText(/플러스 플랜 1,000건까지 · 현재 1,001건 — 상위 플랜이 필요합니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "🔒 CSV 다운로드" })).toBeDisabled();
  });
});
