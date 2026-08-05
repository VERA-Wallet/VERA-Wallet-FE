import { describe, expect, it, vi } from "vitest";
import { HttpAnchorProofProvider } from "@/lib/adapters/http/anchor-proof-provider.http";

const proof = { tx_hash: "0xabc", merkle_root: "0xdef", anchored_at: "2025-01-01T00:00:00.000Z", explorer_url: "https://etherscan.io/tx/0xabc" };
const meta = { provenance: "mock", generatedAt: "2025-01-01T00:00:00.000Z" };

describe("HTTP anchor proof provider", () => {
  it("uses the single anchor-proof endpoint and decodes success", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: proof, meta }));
    await expect(new HttpAnchorProofProvider(fetcher).getProof("event / one")).resolves.toEqual(proof);
    expect(fetcher).toHaveBeenCalledWith("/api/anchor-proof?eventId=event%20%2F%20one");
  });

  it("decodes a 404 as no proof", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: "not_found", message: "missing" } }, { status: 404 }));
    await expect(new HttpAnchorProofProvider(fetcher).getProof("missing")).resolves.toBeNull();
  });
});
