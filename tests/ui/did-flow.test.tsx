import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DidLoginFlow } from "@/components/did/did-login-flow";
import type { AuthClient } from "@/lib/ports/auth-client";
import type { OacxResult } from "@/lib/omnione/oacx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function stubAuthClient(presentDid: AuthClient["presentDid"]): AuthClient {
  return { requestNonce: vi.fn(), verify: vi.fn(), presentDid, logout: vi.fn(), getSession: vi.fn() };
}

describe("DID login flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    push.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete window.OACX;
  });

  it("moves from country selection through presentation and waiting to a ruleset badge", async () => {
    const authClient = stubAuthClient(vi.fn().mockResolvedValue({ countryCode: "US", ruleset: { country: "US", cost_basis: "FIFO", badge_label: "US 규칙" } }));
    render(<DidLoginFlow authClient={authClient} />);
    fireEvent.click(screen.getByRole("button", { name: "US" }));
    fireEvent.click(screen.getByRole("button", { name: "QR/딥링크 제시" }));
    expect(screen.getByLabelText("DID QR 코드")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "제시 완료" }));
    expect(screen.getByText("인증 대기 중...")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(authClient.presentDid).toHaveBeenCalledWith({ country: "US" });
    expect(screen.getByText("US 규칙")).toBeInTheDocument();
  });

  it("opens the OmniOne CX standard auth window and forwards its token when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.example.test:17543/ent/esign");
    // 배포 모듈은 성공 시 콜백에 JSON "문자열"을 넘긴다 (JSON.stringify(응답)).
    const loadModule = vi.fn((_config: string, _options: Record<string, unknown>, onResult: (result?: OacxResult | string) => void) => onResult(JSON.stringify({ token: "cx-window-token", resultCode: "200" })));
    window.OACX = { LOAD_MODULE: loadModule };
    const authClient = stubAuthClient(vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }));

    render(<DidLoginFlow authClient={authClient} />);
    fireEvent.click(screen.getByRole("button", { name: "모바일신분증으로 인증" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(loadModule).toHaveBeenCalledWith(
      "https://cx.example.test:17543/ent/esign/config/config.mid.json",
      { contentInfo: { signType: "ENT_MID" }, compareCI: false, isBirth: true },
      expect.any(Function),
    );
    expect(authClient.presentDid).toHaveBeenCalledWith({ country: "KR", cxToken: "cx-window-token" });
    expect(screen.getByText("대한민국")).toBeInTheDocument();
  });

  it("surfaces a CX auth window failure message with HTML stripped", async () => {
    vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.example.test:17543/ent/esign");
    window.OACX = { LOAD_MODULE: vi.fn((_config, _options, onResult) => onResult({ oacxCode: "OACX_TOKEN_ERROR", clientMessage: "간편인증 화면을 닫고 다시 실행 부탁드립니다.<br/>사유 : 토큰 검증 실패" })) };
    const authClient = stubAuthClient(vi.fn());

    render(<DidLoginFlow authClient={authClient} />);
    fireEvent.click(screen.getByRole("button", { name: "모바일신분증으로 인증" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(authClient.presentDid).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert").textContent;
    expect(alert).toContain("토큰 검증 실패");
    expect(alert).not.toContain("<br");
    expect(screen.getByRole("button", { name: "모바일신분증으로 인증" })).toBeInTheDocument();
  });

  it("treats an argument-less CX callback as an incomplete attempt and returns to idle", async () => {
    vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.example.test:17543/ent/esign");
    // QR 흐름 실패/만료 시 배포 모듈은 success.qrFinalFn()을 인자 없이 호출한다.
    window.OACX = { LOAD_MODULE: vi.fn((_config, _options, onResult) => onResult()) };
    const authClient = stubAuthClient(vi.fn());

    render(<DidLoginFlow authClient={authClient} />);
    fireEvent.click(screen.getByRole("button", { name: "모바일신분증으로 인증" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(authClient.presentDid).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("다시 시도해 주세요");
    expect(screen.getByRole("button", { name: "모바일신분증으로 인증" })).toBeInTheDocument();
  });

  it("fakes CX in mock mode (NEXT_PUBLIC_OMNIONE_CX_MOCK) — no auth URL, no OACX SDK, still forwards a token", async () => {
    // "했다 치고" 스위치: 실제 표준인증창을 열지 않고 고정 mock 토큰으로 present까지 진행한다.
    vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_MOCK", "true");
    // 의도적으로 AUTH_URL과 window.OACX를 두지 않는다 — mock 경로는 둘 다 필요 없어야 한다.
    const authClient = stubAuthClient(vi.fn().mockResolvedValue({ countryCode: "KR", ruleset: { country: "KR", cost_basis: "이동평균법", badge_label: "대한민국" } }));

    render(<DidLoginFlow authClient={authClient} />);
    fireEvent.click(screen.getByRole("button", { name: "모바일신분증으로 인증" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(authClient.presentDid).toHaveBeenCalledWith({ country: "KR", cxToken: "mock-cx-token" });
    expect(screen.getByText("대한민국")).toBeInTheDocument();
  });
});
