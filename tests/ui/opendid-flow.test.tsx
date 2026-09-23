import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DidLoginFlow } from "@/components/did/did-login-flow";
import { OpenDidError, openDidClient } from "@/lib/opendid/client";
import type { AuthClient } from "@/lib/ports/auth-client";
vi.mock("@/lib/opendid/client", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/opendid/client")>();
  return { ...original, openDidClient: { offer: vi.fn(), present: vi.fn() } };
});
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const claim = { countryCode: "KR" as const, ruleset: { country: "KR", cost_basis: "FIFO", badge_label: "KR" } };
const authClient = { getSession: vi.fn().mockResolvedValue({ didVerified: true, walletAddress: null }), presentDid: vi.fn() } as unknown as AuthClient;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.test");
  vi.mocked(openDidClient.offer).mockResolvedValue({ offerId: "offer-1", qrPayload: { type: "VerifyOffer", offerId: "offer-1", endpoints: ["https://verifier.test/verifier"], validUntil: new Date(Date.now() + 10000).toISOString() }, expiresAt: new Date(Date.now() + 10000).toISOString(), pollAfterMs: 2000 });
  vi.mocked(openDidClient.present).mockResolvedValue({ status: "pending", retryAfterMs: 2000 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function start() {
  render(<DidLoginFlow authClient={authClient} provider="opendid" provenance="live" />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open DID 지갑으로 시작하기" })); });
}
it("renders a real QR, waits for verification, then navigates to wallet linking", async () => {
  await start();
  expect(screen.getByTitle("Open DID 본인 확인 QR 코드").closest("svg")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "제시 완료" })).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(push).not.toHaveBeenCalled();
  vi.mocked(openDidClient.present).mockResolvedValue({ status: "verified", claim });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(authClient.presentDid).not.toHaveBeenCalled();
  expect(push).toHaveBeenCalledWith("/connect-wallet");
});
it("cancels polling and ignores a late success", async () => {
  let finish!: (value: { status: "verified"; claim: typeof claim }) => void;
  vi.mocked(openDidClient.present).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await start();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  fireEvent.click(screen.getByRole("button", { name: "취소하고 돌아가기" }));
  await act(async () => { finish({ status: "verified", claim }); await vi.advanceTimersByTimeAsync(12000); });
  expect(push).not.toHaveBeenCalled();
  expect(openDidClient.present).toHaveBeenCalledTimes(1);
});
it("expires the QR locally and stops polling", async () => {
  await start();
  await act(async () => { await vi.advanceTimersByTimeAsync(11000); });
  expect(screen.getByRole("alert")).toHaveTextContent("만료");
  const calls = vi.mocked(openDidClient.present).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(openDidClient.present).toHaveBeenCalledTimes(calls);
});
it("honors Retry-After but treats a consumed offer as terminal", async () => {
  vi.mocked(openDidClient.present).mockRejectedValueOnce(new OpenDidError(429, "verification_rate_limited", "limited", 5000))
    .mockRejectedValueOnce(new OpenDidError(409, "verification_consumed", "consumed"));
  await start();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(openDidClient.present).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByRole("alert")).toHaveTextContent("새 QR");
});
it("does not overlap polling requests while a response is pending", async () => {
  vi.mocked(openDidClient.present).mockImplementation(() => new Promise(() => {}));
  await start();
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(openDidClient.present).toHaveBeenCalledTimes(1);
});
