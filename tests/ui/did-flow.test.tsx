import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DidLoginFlow } from "@/components/did/did-login-flow";
import type { AuthClient } from "@/lib/ports/auth-client";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("DID login flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    push.mockReset();
  });

  it("moves from country selection through presentation and waiting to a ruleset badge", async () => {
    const authClient: AuthClient = {
      requestNonce: vi.fn(),
      verify: vi.fn(),
      presentDid: vi.fn().mockResolvedValue({ countryCode: "US", ruleset: { country: "US", cost_basis: "FIFO", badge_label: "US 규칙" } }),
      logout: vi.fn(),
      getSession: vi.fn(),
    };
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
});
