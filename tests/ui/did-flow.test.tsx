import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DidLoginFlow } from "@/components/did/did-login-flow";
import type { AuthClient, AuthSession } from "@/lib/ports/auth-client";
import type { OacxResult } from "@/lib/omnione/oacx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// 인증 직후 세션 조회 기본값 — 지갑 없음. claimed 상태에 들어가면 이 값을 조회해 목적지를 정한다.
const DEFAULT_SESSION: AuthSession = { didVerified: true, countryCode: null, walletAddress: null };

function stubAuthClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    requestNonce: vi.fn(),
    verify: vi.fn(),
    presentDid: vi.fn(),
    registerWatchWallet: vi.fn(),
    logout: vi.fn(),
    getSession: vi.fn().mockResolvedValue(DEFAULT_SESSION),
    ...overrides,
  };
}

const residencyLine = (label: string) => `거주 국가 ${label} 기준으로 계산할게요`;

describe("DID login flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    push.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.OACX;
  });

  it("moves from country selection through presentation and waiting to a success state", async () => {
    const authClient = stubAuthClient({ presentDid: vi.fn().mockResolvedValue({ countryCode: "US", ruleset: { country: "US", cost_basis: "FIFO", badge_label: "US 규칙" } }) });
    render(<DidLoginFlow authClient={authClient} />);
    // 거주 국가 줄은 접혀 있다 — 실제 화면처럼 열어야 안의 버튼을 쓸 수 있다.
    fireEvent.click(document.querySelector("details summary")!);
    fireEvent.click(screen.getByRole("button", { name: "US" }));
    fireEvent.click(screen.getByRole("button", { name: "QR/딥링크 제시" }));
    expect(screen.getByLabelText("본인 확인 QR 코드")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "제시 완료" }));
    expect(screen.getByText("인증 대기 중...")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(authClient.presentDid).toHaveBeenCalledWith({ country: "US" });
    expect(screen.getByText("본인 확인이 끝났어요")).toBeInTheDocument();
    expect(screen.getByText(residencyLine("미국"))).toBeInTheDocument();
  });

  it("opens the OmniOne CX standard auth window and forwards its token when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.example.test:17543/ent/esign");
    // 배포 모듈은 성공 시 콜백에 JSON "문자열"을 넘긴다 (JSON.stringify(응답)).
    const loadModule = vi.fn((_config: string, _options: Record<string, unknown>, onResult: (result?: OacxResult | string) => void) => onResult(JSON.stringify({ token: "cx-window-token", resultCode: "200" })));
    window.OACX = { LOAD_MODULE: loadModule };
    const authClient = stubAuthClient({ presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }) });

    render(<DidLoginFlow authClient={authClient} />);
    fireEvent.click(screen.getByRole("button", { name: "모바일신분증으로 시작하기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(loadModule).toHaveBeenCalledWith(
      "https://cx.example.test:17543/ent/esign/config/config.mid.json",
      { contentInfo: { signType: "ENT_MID" }, compareCI: false, isBirth: true },
      expect.any(Function),
    );
    expect(authClient.presentDid).toHaveBeenCalledWith({ country: "KR", cxToken: "cx-window-token" });
    expect(screen.getByText("본인 확인이 끝났어요")).toBeInTheDocument();
    expect(screen.getByText(residencyLine("한국"))).toBeInTheDocument();
  });

  it("surfaces a CX auth window failure message with HTML stripped", async () => {
    vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.example.test:17543/ent/esign");
    window.OACX = { LOAD_MODULE: vi.fn((_config, _options, onResult) => onResult({ oacxCode: "OACX_TOKEN_ERROR", clientMessage: "간편인증 화면을 닫고 다시 실행 부탁드립니다.<br/>사유 : 토큰 검증 실패" })) };
    const authClient = stubAuthClient({ presentDid: vi.fn() });

    render(<DidLoginFlow authClient={authClient} />);
    fireEvent.click(screen.getByRole("button", { name: "모바일신분증으로 시작하기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(authClient.presentDid).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert").textContent;
    expect(alert).toContain("토큰 검증 실패");
    expect(alert).not.toContain("<br");
    expect(screen.getByRole("button", { name: "모바일신분증으로 시작하기" })).toBeInTheDocument();
  });

  it("treats an argument-less CX callback as an incomplete attempt and returns to idle", async () => {
    vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.example.test:17543/ent/esign");
    // QR 흐름 실패/만료 시 배포 모듈은 success.qrFinalFn()을 인자 없이 호출한다.
    window.OACX = { LOAD_MODULE: vi.fn((_config, _options, onResult) => onResult()) };
    const authClient = stubAuthClient({ presentDid: vi.fn() });

    render(<DidLoginFlow authClient={authClient} />);
    fireEvent.click(screen.getByRole("button", { name: "모바일신분증으로 시작하기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(authClient.presentDid).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("다시 시도해 주세요");
    expect(screen.getByRole("button", { name: "모바일신분증으로 시작하기" })).toBeInTheDocument();
  });

  it("fakes CX in mock mode (NEXT_PUBLIC_OMNIONE_CX_MOCK) — no auth URL, no OACX SDK, still forwards a token", async () => {
    // "했다 치고" 스위치: 실제 표준인증창을 열지 않고 고정 mock 토큰으로 present까지 진행한다.
    vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_MOCK", "true");
    // 의도적으로 AUTH_URL과 window.OACX를 두지 않는다 — mock 경로는 둘 다 필요 없어야 한다.
    const authClient = stubAuthClient({ presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }) });

    render(<DidLoginFlow authClient={authClient} />);
    fireEvent.click(screen.getByRole("button", { name: "모바일신분증으로 시작하기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(authClient.presentDid).toHaveBeenCalledWith({ country: "KR", cxToken: "mock-cx-token" });
    expect(screen.getByText("본인 확인이 끝났어요")).toBeInTheDocument();
    expect(screen.getByText(residencyLine("한국"))).toBeInTheDocument();
  });

  describe("residency picker visibility", () => {
    it("keeps it collapsed by default and says the current value on the closed row (mock mode)", () => {
      render(<DidLoginFlow authClient={stubAuthClient()} />);
      const details = document.querySelector("details");
      expect(details).not.toBeNull();
      expect(details?.open).toBe(false);
      // 접힌 줄이 지금 값을 말한다 — 열지 않아도 무엇으로 계산될지 안다.
      expect(details?.querySelector("summary")?.textContent).toContain("거주 국가: 한국");
      expect(screen.getByTestId("mock-provenance")).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "거주국 선택" })).toBeInTheDocument();
      fireEvent.click(document.querySelector("details summary")!);
      expect(details?.open).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "US" }));
      expect(details?.querySelector("summary")?.textContent).toContain("거주 국가: 미국");
    });

    it("keeps the picker in real CX auth mode too — residency is declared, not proven by the ID", () => {
      // BE는 실제 인증 토큰이 있어도 요청의 country를 그대로 세션 거주국으로 쓴다. 실제 인증에서 이 줄을 감추면
      // 모든 사용자가 KR로 굳고 해외 거주자는 바꿀 길이 없다(2026-09-18 독립 검증에서 잡힌 회귀).
      vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.example.test:17543/ent/esign");
      // 출처는 서버 페이지가 계산해 내려준다(`identityProvenance`): FE 스위치와 BE 신원 공급자가 모두 실모드일 때만 live다.
      render(<DidLoginFlow authClient={stubAuthClient()} provenance="live" />);
      expect(document.querySelector("details")).not.toBeNull();
      expect(screen.getByRole("group", { name: "거주국 선택" })).toBeInTheDocument();
      // 실제 인증에는 mock 출처 칩을 달지 않는다.
      expect(screen.queryByTestId("mock-provenance")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "모바일신분증으로 시작하기" })).toBeInTheDocument();
    });

    it("sends the chosen residency with the real CX token — a non-KR resident is not pinned to KR", async () => {
      vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.example.test:17543/ent/esign");
      window.OACX = { LOAD_MODULE: vi.fn((_config: string, _options: Record<string, unknown>, onResult: (result?: OacxResult | string) => void) => onResult(JSON.stringify({ token: "cx-window-token", resultCode: "200" }))) };
      const authClient = stubAuthClient({ presentDid: vi.fn().mockResolvedValue({ countryCode: "US", ruleset: { country: "US", cost_basis: "FIFO", badge_label: "US 규칙" } }) });
      render(<DidLoginFlow authClient={authClient} />);
      fireEvent.click(document.querySelector("details summary")!);
      fireEvent.click(screen.getByRole("button", { name: "US" }));
      fireEvent.click(screen.getByRole("button", { name: "모바일신분증으로 시작하기" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(authClient.presentDid).toHaveBeenCalledWith({ country: "US", cxToken: "cx-window-token" });
      expect(screen.getByText(residencyLine("미국"))).toBeInTheDocument();
    });
  });

  it("never renders forbidden DID/claim jargon across any flow state", async () => {
    const authClient = stubAuthClient({ presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }) });
    render(<DidLoginFlow authClient={authClient} />);
    const forbidden = ["DID", "클레임"];
    const assertClean = () => { for (const term of forbidden) expect(document.body.textContent ?? "").not.toContain(term); };

    assertClean();
    fireEvent.click(document.querySelector("details summary")!);
    assertClean();
    fireEvent.click(screen.getByRole("button", { name: "QR/딥링크 제시" }));
    assertClean();
    fireEvent.click(screen.getByRole("button", { name: "제시 완료" }));
    assertClean();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    assertClean();
  });

  describe("auto-advance after successful verification", () => {
    async function reachClaimed(authClient: AuthClient) {
      render(<DidLoginFlow authClient={authClient} />);
      fireEvent.click(screen.getByRole("button", { name: "QR/딥링크 제시" }));
      fireEvent.click(screen.getByRole("button", { name: "제시 완료" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(screen.getByText("본인 확인이 끝났어요")).toBeInTheDocument();
    }

    it("does not navigate before ~1s and navigates right at 1s", async () => {
      const authClient = stubAuthClient({
        presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }),
        getSession: vi.fn().mockResolvedValue({ didVerified: true, countryCode: "KR", walletAddress: "0xabc" }),
      });
      await reachClaimed(authClient);

      await act(async () => { await vi.advanceTimersByTimeAsync(999); });
      expect(push).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(push).toHaveBeenCalledWith("/dashboard");
    });

    it("goes to /dashboard when the post-auth session already has a wallet", async () => {
      const authClient = stubAuthClient({
        presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }),
        getSession: vi.fn().mockResolvedValue({ didVerified: true, countryCode: "KR", walletAddress: "0xabc" }),
      });
      await reachClaimed(authClient);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(push).toHaveBeenCalledWith("/dashboard");
    });

    it("goes to /connect-wallet when the post-auth session has no wallet yet", async () => {
      const authClient = stubAuthClient({
        presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }),
        getSession: vi.fn().mockResolvedValue({ didVerified: true, countryCode: "KR", walletAddress: null }),
      });
      await reachClaimed(authClient);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(push).toHaveBeenCalledWith("/connect-wallet");
    });

    it("falls back to /dashboard when the post-auth session lookup itself fails", async () => {
      const authClient = stubAuthClient({
        presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }),
        getSession: vi.fn().mockRejectedValue(new Error("network down")),
      });
      await reachClaimed(authClient);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(push).toHaveBeenCalledWith("/dashboard");
    });

    it("waits for a session lookup slower than 1s instead of guessing — a wallet-less user still lands on /connect-wallet", async () => {
      const authClient = stubAuthClient({
        presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }),
        getSession: vi.fn(() => new Promise<AuthSession>((resolve) => setTimeout(() => resolve({ didVerified: true, countryCode: "KR", walletAddress: null }), 1500))),
      });
      await reachClaimed(authClient);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      // 1초가 지났어도 지갑 유무를 아직 모른다 — 빈 요약으로 찍어 보내지 않는다.
      expect(push).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(push).toHaveBeenCalledWith("/connect-wallet");
    });

    it("does not trap the user when the session lookup never answers — falls back to /dashboard at the cap", async () => {
      const authClient = stubAuthClient({
        presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }),
        getSession: vi.fn(() => new Promise<AuthSession>(() => {})),
      });
      await reachClaimed(authClient);
      await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
      expect(push).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(push).toHaveBeenCalledWith("/dashboard");
    });

    it("clears its timer on unmount and never navigates", async () => {
      const authClient = stubAuthClient({
        presentDid: vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }),
        getSession: vi.fn().mockResolvedValue({ didVerified: true, countryCode: "KR", walletAddress: "0xabc" }),
      });
      const { unmount } = render(<DidLoginFlow authClient={authClient} />);
      fireEvent.click(screen.getByRole("button", { name: "QR/딥링크 제시" }));
      fireEvent.click(screen.getByRole("button", { name: "제시 완료" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(screen.getByText("본인 확인이 끝났어요")).toBeInTheDocument();
      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(push).not.toHaveBeenCalled();
    });
  });
});
