import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { SettingsView } from "@/components/settings/settings-view";
import { savePlan } from "@/lib/plan/use-plan";

function fakeAuthClient(overrides: Partial<{ logout: () => Promise<void> }> = {}) {
  return {
    requestNonce: vi.fn(),
    verify: vi.fn(),
    registerWatchWallet: vi.fn(),
    presentDid: vi.fn(),
    getSession: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// 이 vitest 환경의 window.localStorage는 메서드가 없는 빈 객체다(jsdom이 아니라
// Node의 실험적 웹스토리지가 끼어든 탓 — `--localstorage-file` 경고 참고). usePlan·useHideBalances는
// 둘 다 인자를 생략하면 window.localStorage를 읽으므로, 진짜 동작하는 메모리 스토리지로 교체해야
// 저장→렌더 왕복을 테스트할 수 있다.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("설정 화면", () => {
  beforeEach(() => {
    push.mockReset();
    Object.defineProperty(window, "localStorage", { value: createMemoryStorage(), configurable: true });
  });

  it("현재 플랜이 없으면 무료로 표시하고 플랜 화면으로 이어진다", () => {
    render(<SettingsView authClient={fakeAuthClient()} />);

    expect(screen.getByText("무료")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /현재 플랜/ })).toHaveAttribute("href", "/plan");
  });

  it("활성 플랜이 있으면 그 이름을 보여준다", () => {
    savePlan({ tier: "plus", taxYear: 2026, activatedAt: new Date().toISOString() }, window.localStorage);
    render(<SettingsView authClient={fakeAuthClient()} />);

    expect(screen.getByText("플러스")).toBeInTheDocument();
  });

  it("금액 가리기 토글은 저장된 기본값을 그대로 켜고 끈다 — 대시보드와 같은 저장값을 공유한다", async () => {
    render(<SettingsView authClient={fakeAuthClient()} />);

    const toggle = screen.getByRole("switch", { name: "금액 숨김 설정" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem("vw_hide_balances")).toBe("1");
  });

  it("스팸 거래 보기는 거래 탭으로 이어진다", () => {
    render(<SettingsView authClient={fakeAuthClient()} />);

    expect(screen.getByRole("link", { name: "스팸 거래 보기" })).toHaveAttribute("href", "/transactions?spam=1");
  });

  it("로그아웃은 기존 로그아웃 경로를 부르고 로그인 화면으로 보낸다", async () => {
    const authClient = fakeAuthClient();
    render(<SettingsView authClient={authClient} />);

    await userEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(authClient.logout).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("로그아웃이 실패하면 화면에 남아 실패를 그대로 보여준다", async () => {
    const authClient = fakeAuthClient({ logout: vi.fn().mockRejectedValue(new Error("세션 종료 실패")) });
    render(<SettingsView authClient={authClient} />);

    await userEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(await screen.findByText("세션 종료 실패")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("상단에 요약으로 돌아가는 링크가 있다", () => {
    render(<SettingsView authClient={fakeAuthClient()} />);

    expect(screen.getByRole("link", { name: "← 요약" })).toHaveAttribute("href", "/dashboard");
  });
});
