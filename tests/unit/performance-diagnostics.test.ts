import { beforeEach, describe, expect, it, vi } from "vitest";
import { installPerformanceDiagnostics, measure, recordTiming, safePath, startInteraction } from "@/lib/diagnostics/performance";
const api = () => (window as unknown as { veraPerformance: { enable(): void; disable(): void; snapshot(): unknown[]; clear(): void } }).veraPerformance;
beforeEach(() => { installPerformanceDiagnostics(); api().disable(); });
describe("local performance diagnostics", () => {
  it("does not retain URL parameters, credentials, addresses or attempt IDs", () => {
    expect(safePath("https://user:secret@host/api/report-vc/wallet/link-attempts/abc123?token=secret#private")).toBe("/api/report-vc/wallet/link-attempts/:id");
    expect(safePath("/api/auth/wallets/0x123")).toBe("/api/auth/wallets/:id");
  });
  it("is opt-in and retains only the last 500 measurements", () => {
    const entry = { kind: "test", name: "fixed", durationMs: 1, atMs: 0 };
    recordTiming(entry); expect(api().snapshot()).toEqual([]);
    api().enable(); for (let i = 0; i < 510; i++) recordTiming({ ...entry, atMs: i });
    expect(api().snapshot()).toHaveLength(500);
    expect(api().snapshot()[0]).toMatchObject({ atMs: 10 });
    api().disable(); expect(api().snapshot()).toEqual([]);
  });
  it("keeps the original success/error behavior without logging result or error payloads", async () => {
    api().enable();
    const work = vi.fn().mockResolvedValue("secret signature");
    expect(await measure("wallet.sign_approval", work)).toBe("secret signature");
    const error = new Error("secret account");
    await expect(measure("wallet.connect_approval", async () => { throw error; })).rejects.toBe(error);
    expect(api().snapshot()).toEqual([expect.objectContaining({ outcome: "ok" }), expect.objectContaining({ outcome: "error" })]);
    expect(JSON.stringify(api().snapshot())).not.toContain("secret");
  });
});

it("records an abandoned CX flow once even if its SDK promise never settles", () => {
  api().enable();
  const finish = startInteraction("cx.interactive_flow");
  finish("stopped"); finish("ok");
  expect(api().snapshot()).toEqual([expect.objectContaining({ name: "cx.interactive_flow", outcome: "stopped" })]);
});
