import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { decodeResponse } from "@/lib/http/error-codec";
import type { SuccessEnvelope } from "@/lib/http/envelope";

function envelope(meta: unknown): Response {
  return new Response(JSON.stringify({ data: { ok: true }, meta }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const payloadSchema = z.object({ ok: z.boolean() });

// provenance를 "mock" 리터럴로 고정해 두면 BE가 MOCK_MODE=false로 넘어가는 순간
// 모든 응답이 계약 위반으로 거절돼 화면이 통째로 죽는다. 그 전환을 타입·런타임 양쪽에서 막지 않는 것이 이 계약의 목적이다.
describe("success envelope provenance contract", () => {
  it.each(["mock", "live"] as const)("accepts a %s provenance envelope", async (provenance) => {
    const decoded = await decodeResponse(envelope({ provenance, generatedAt: "2026-08-10T00:00:00.000Z" }), payloadSchema);
    expect("meta" in decoded).toBe(true);
    if ("meta" in decoded) expect(decoded.meta.provenance).toBe(provenance);
  });

  it.each([
    ["empty provenance", { provenance: "", generatedAt: "2026-08-10T00:00:00.000Z" }],
    ["uppercase provenance", { provenance: "MOCK", generatedAt: "2026-08-10T00:00:00.000Z" }],
    ["unknown provenance", { provenance: "simulated", generatedAt: "2026-08-10T00:00:00.000Z" }],
    ["numeric provenance", { provenance: 1, generatedAt: "2026-08-10T00:00:00.000Z" }],
    ["missing provenance", { generatedAt: "2026-08-10T00:00:00.000Z" }],
    ["missing generatedAt", { provenance: "mock" }],
    ["missing meta", undefined],
  ])("rejects %s as invalid_response", async (_caseName, meta) => {
    const decoded = await decodeResponse(envelope(meta), payloadSchema);
    expect(decoded).toMatchObject({ error: { code: "invalid_response" } });
  });

  it("keeps the type union assignable for both modes", () => {
    const mock: SuccessEnvelope<{ ok: boolean }> = { data: { ok: true }, meta: { provenance: "mock", generatedAt: "" } };
    const live: SuccessEnvelope<{ ok: boolean }> = { data: { ok: true }, meta: { provenance: "live", generatedAt: "" } };
    expect([mock.meta.provenance, live.meta.provenance]).toEqual(["mock", "live"]);
  });

  it("does not change what the UI renders while MOCK_MODE is the only operating mode", async () => {
    // 배지 문구는 이번 범위에서 바꾸지 않는다. decoder만 넓혔다는 사실을 고정해 둔다.
    const { MockProvenanceChip } = await import("@/components/ui/mock-provenance-chip");
    const { render, screen } = await import("@testing-library/react");
    render(<MockProvenanceChip />);
    expect(screen.getByTestId("mock-provenance")).toHaveTextContent("mock 데이터");
    vi.restoreAllMocks();
  });
});
