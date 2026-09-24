import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startPolling } from "@/lib/report-vc/poll";
import { ReportVcError } from "@/lib/report-vc/types";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };

describe("startPolling", () => {
  it("stops at expiry without asking the server again", async () => {
    const request = vi.fn().mockResolvedValue({ done: false, retryAfterMs: 2000 });
    const onExpired = vi.fn();
    startPolling({ expiresAt: new Date(Date.now() + 5000).toISOString(), initialDelayMs: 2000, request, onDone: vi.fn(), onExpired, onError: vi.fn() });
    await tick(2000);
    expect(request).toHaveBeenCalledTimes(1);
    await tick(2000);
    expect(request).toHaveBeenCalledTimes(2);
    await tick(2000);
    // 6초 시점: 만료(5초)가 지났으므로 요청 없이 끝난다.
    expect(request).toHaveBeenCalledTimes(2);
    expect(onExpired).toHaveBeenCalledTimes(1);
    await tick(20000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After on transient errors and ends on a terminal error", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new ReportVcError(429, "rate_limited", "slow", 5000))
      .mockRejectedValueOnce(new ReportVcError(410, "attempt_expired", "gone"));
    const onError = vi.fn();
    startPolling({ expiresAt: new Date(Date.now() + 60000).toISOString(), initialDelayMs: 1000, request, onDone: vi.fn(), onExpired: vi.fn(), onError });
    await tick(1000);
    expect(request).toHaveBeenCalledTimes(1);
    await tick(4000);
    expect(request).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "attempt_expired" }));
    await tick(10000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("never overlaps requests and drops a late answer after stop()", async () => {
    let resolve!: (value: { done: true; value: string }) => void;
    const request = vi.fn().mockImplementation(() => new Promise((r) => { resolve = r; }));
    const onDone = vi.fn();
    const stop = startPolling({ expiresAt: new Date(Date.now() + 60000).toISOString(), initialDelayMs: 1000, request, onDone, onExpired: vi.fn(), onError: vi.fn() });
    await tick(10000);
    expect(request).toHaveBeenCalledTimes(1);
    stop();
    resolve({ done: true, value: "late" });
    await tick(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("gives up after the request cap instead of polling forever", async () => {
    const request = vi.fn().mockResolvedValue({ done: false, retryAfterMs: 1000 });
    const onError = vi.fn();
    startPolling({ expiresAt: new Date(Date.now() + 3_600_000).toISOString(), initialDelayMs: 1000, request, onDone: vi.fn(), onExpired: vi.fn(), onError, maxRequests: 3 });
    await tick(10000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "poll_exhausted" }));
  });

  it("delivers the terminal value once and then stays quiet", async () => {
    const request = vi.fn().mockResolvedValueOnce({ done: false, retryAfterMs: 1000 }).mockResolvedValue({ done: true, value: 42 });
    const onDone = vi.fn();
    startPolling({ expiresAt: new Date(Date.now() + 60000).toISOString(), initialDelayMs: 1000, request, onDone, onExpired: vi.fn(), onError: vi.fn() });
    await tick(5000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(42);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
