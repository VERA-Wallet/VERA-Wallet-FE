import { describe, it, expect, vi, afterEach } from "vitest";
import { publicDidTarget } from "@/lib/opendid/public-gateway";
import { GET, POST } from "@/app/opendid/[...path]/route";
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("public DID boundary", () => {
  it("allows native wallet protocol routes only", () => {
    expect(publicDidTarget("tas/api/v1/request-register-user".split("/"), "POST", "host.docker.internal")?.port).toBe("8090");
    expect(publicDidTarget("api-gateway/api/v1/did-doc".split("/"), "GET", "host.docker.internal")?.port).toBe("8093");
    for (const path of ["issuer/api/v1/verawallet/report/offers", "issuer/admin/v1/user", "tas/api/v1/test/user/latest", "verifier/api/v1/confirm-verify", "verifier/api/v1/request-offer-qr", "issuer/api/v1/certificate-vc/..", "tas/api/v1/%2e%2e", "tas/api/v1/request-register-user;"]) {
      for (const method of ["GET", "POST"]) expect(publicDidTarget(path.split("/"), method, "host.docker.internal")).toBeNull();
    }
    expect(publicDidTarget("issuer/api/v1/certificate-vc".split("/"), "POST", "host.docker.internal")).toBeNull();
  });
  it("does not forward browser credentials or internal keys", async () => {
    vi.stubEnv("OPENDID_PUBLIC_UPSTREAM_HOST", "host.docker.internal");
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { headers: { "set-cookie": "bad=1" } }));
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(new Request("https://example.org/opendid/issuer/api/v1/certificate-vc", { headers: { cookie: "vw_access_token=secret", authorization: "Bearer secret", "x-verawallet-service-key": "secret" } }), ctx("issuer/api/v1/certificate-vc"));
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1].headers).toEqual({ accept: "application/json", "content-type": "application/json" });
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("rejects unknown routes and oversized bodies without reaching native servers", async () => {
    vi.stubEnv("OPENDID_PUBLIC_UPSTREAM_HOST", "host.docker.internal");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await GET(new Request("https://example.org/"), ctx("issuer/admin/v1/user"))).status).toBe(404);
    expect((await POST(new Request("https://example.org/", { method: "POST", headers: { "content-type": "application/json", "content-length": "3000000" }, body: "{}" }), ctx("tas/api/v1/request-register-user"))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
